import * as path from 'path'
import { createRequire } from 'module'
import * as fs from './utils/fs.js'
import parseArgs from 'yargs-parser'
import chalk from 'chalk'
import Listr from 'listr'
import { temporaryDirectory } from 'tempy'

import patchApk, { showAppBundleWarning } from './patch-apk.js'
import { patchXapkBundle, patchApksBundle } from './patch-app-bundle.js'

import Apktool from './tools/apktool.js'
import UberApkSigner from './tools/uber-apk-signer.js'
import type Tool from './tools/tool.js'
import UserError from './utils/user-error.js'

export type TaskOptions = {
  inputPath: string
  outputPath: string
  skipPatches: boolean
  certificatePath?: string
  mapsApiKey?: string
  apktool: Apktool
  uberApkSigner: UberApkSigner
  tmpDir: string
  wait: boolean
  isAppBundle: boolean
  debuggable: boolean
  skipDecode: boolean
}

interface PatchingError extends Error {
  /**
   * Interleaved stdout and stderr output on execa errors
   * @see https://github.com/sindresorhus/execa#all-1
   */
  all?: string
}

const require = createRequire(import.meta.url)
const { version } = require('../package.json')

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    configuration: {
      'camel-case-expansion': false,
    },
    string: ['apktool', 'certificate', 'tmp-dir', 'maps-api-key'],
    boolean: ['help', 'skip-patches', 'wait', 'debuggable', 'keep-tmp-dir'],
  })

  if (args.help) {
    showHelp()
    process.exit()
  }

  const [input] = args._
  if (!input) {
    showHelp()
    process.exit(1)
  }
  const inputPath = path.resolve(input.toString())

  const { taskFunction, skipDecode, isAppBundle, outputName } =
    await determineTask(inputPath)
  const outputPath = path.resolve(path.dirname(inputPath), outputName)

  // Initialize and validate certificate path
  let certificatePath: string | undefined
  const mapsApiKey = args['maps-api-key'] as string | undefined
  if (args.certificate) {
    certificatePath = path.resolve(args.certificate as string)
    let certificateExtension = path.extname(certificatePath)

    if (certificateExtension !== '.pem' && certificateExtension !== '.der')
      showSupportedCertificateExtensions()
  }

  let tmpDir = args['tmp-dir']
    ? path.resolve(args['tmp-dir'] as string)
    : temporaryDirectory({ prefix: 'apk-mitm-' })
  await fs.mkdir(tmpDir, { recursive: true })

  const apktool = new Apktool({
    frameworkPath: path.join(tmpDir, 'framework'),
    customPath: args.apktool ? path.resolve(args.apktool as string) : undefined,
  })
  const uberApkSigner = new UberApkSigner()

  showVersions({ apktool, uberApkSigner })
  if (skipDecode) {
    console.log(
      chalk.dim(`  Patching from decoded apktool directory:\n  ${inputPath}\n`),
    )
  } else {
    console.log(chalk.dim(`  Using temporary directory:\n  ${tmpDir}\n`))
  }

  taskFunction({
    inputPath,
    outputPath,
    certificatePath,
    mapsApiKey,
    tmpDir,
    apktool,
    uberApkSigner,
    wait: args.wait as boolean,
    skipPatches: args['skip-patches'] as boolean,
    isAppBundle,
    debuggable: args.debuggable as boolean,
    skipDecode,
  })
    .run()
    .then(async context => {
      if (taskFunction === patchApk && context.usesAppBundle) {
        showAppBundleWarning()
      }

      console.log(
        `\n  ${chalk.green.inverse('  Done! ')} Patched file: ${chalk.bold(`./${outputName}`)}\n`,
      )

      if (!args['keep-tmp-dir']) {
        try {
          await fs.rm(tmpDir, { recursive: true, force: true })
        } catch (error: any) {
          // No idea why Windows gives us an `EBUSY: resource busy or locked`
          // error here, but deleting the temporary directory isn't the most
          // important thing in the world, so let's just ignore it
          const ignoreError =
            process.platform === 'win32' && error.code === 'EBUSY'

          if (!ignoreError) throw error
        }
      }
    })
    .catch((error: PatchingError) => {
      const message = getErrorMessage(error, { tmpDir })

      console.error(
        [
          '',
          `${chalk.red.inverse.bold('  Failed! ')} An error occurred:`,
          '',
          message,
          '',
          `  The full logs of all commands are available here:`,
          `  ${path.join(tmpDir, 'logs')}`,
          '',
        ].join('\n'),
      )
      if (process.arch.startsWith('arm')) showArmWarning()

      process.exit(1)
    })
}

/**
 * Determines the correct "task" (e.g. "patch APK" or "patch XAPK") depending on
 * the input path's type (file or directory) and extension (e.g. ".apk").
 */
async function determineTask(inputPath: string) {
  const fileStats = await fs.stat(inputPath)

  let outputFileExtension = '.apk'

  let skipDecode = false
  let isAppBundle = false
  let taskFunction: (options: TaskOptions) => Listr

  if (fileStats.isDirectory()) {
    taskFunction = patchApk
    skipDecode = true

    const apktoolYamlPath = path.join(inputPath, 'apktool.yml')
    if (!(await fs.exists(apktoolYamlPath))) {
      throw new UserError(
        'No "apktool.yml" file found inside the input directory!' +
          ' Make sure to specify a directory created by "apktool decode".',
      )
    }
  } else {
    const inputFileExtension = path.extname(inputPath)

    switch (inputFileExtension) {
      case '.apk':
        taskFunction = patchApk
        break
      case '.xapk':
        isAppBundle = true
        taskFunction = patchXapkBundle
        break
      case '.apks':
      case '.zip':
        isAppBundle = true
        taskFunction = patchApksBundle
        break
      default:
        showSupportedExtensions()
    }

    outputFileExtension = inputFileExtension
  }

  const baseName = path.basename(inputPath, outputFileExtension)
  const outputName = `${baseName}-patched${outputFileExtension}`

  return { skipDecode, taskFunction, isAppBundle, outputName }
}

function getErrorMessage(error: PatchingError, { tmpDir }: { tmpDir: string }) {
  // User errors can be shown without a stack trace
  if (error instanceof UserError) return error.message

  // Errors from commands can also be shown without a stack trace
  if (error.all) return formatCommandError(error.all, { tmpDir })

  return error.stack
}

function formatCommandError(error: string, { tmpDir }: { tmpDir: string }) {
  return (
    error
      // Replace mentions of the (sometimes very long) temporary directory path
      .replace(new RegExp(tmpDir, 'g'), chalk.bold('<tmp_dir>'))
      // Highlight (usually relevant) warning lines in Apktool output
      .replace(/^W: .+$/gm, line => chalk.yellow(line))
      // De-emphasize Apktool info lines
      .replace(/^I: .+$/gm, line => chalk.dim(line))
      // De-emphasize (not very helpful) Apktool "could not exec" error message
      .replace(
        /^.+brut\.common\.BrutException: could not exec.+$/gm,
        line => chalk.dim(line),
      )
  )
}

function showHelp() {
  console.log(`
  $ ${chalk.bold('apk-mitm')} <path-to-apk/xapk/apks/decoded-directory>

  ${chalk.blue(chalk.dim.bold('*') + ' Optional flags:')}
  ${chalk.dim(`${chalk.bold('--wait')} Wait for manual changes before re-encoding`)}
  ${chalk.dim(`${chalk.bold('--tmp-dir <path>')} Where temporary files will be stored`)}
  ${chalk.dim(`${chalk.bold('--keep-tmp-dir')} Don't delete the temporary directory after patching`)}
  ${chalk.dim(`${chalk.bold('--debuggable')} Make the patched app debuggable`)}
  ${chalk.dim(`${chalk.bold('--skip-patches')} Don't apply any patches (for troubleshooting)`)}
  ${chalk.dim(`${chalk.bold('--apktool <path-to-jar>')} Use custom version of Apktool`)}
  ${chalk.dim(`${chalk.bold('--certificate <path-to-pem/der>')} Add specific certificate to network security config`)}
  ${chalk.dim(`${chalk.bold('--maps-api-key <api-key>')} Add custom Google Maps API key to be replaced while patching apk`)}
  `)
}

/**
 * Error that is shown when the file provided through the positional argument
 * has an unsupported extension. Exits with status 1 after showing the message.
 */
function showSupportedExtensions(): never {
  console.log(chalk.yellow(`
  It looks like you tried running ${chalk.bold('apk-mitm')} with an unsupported file type!

  Only the following file extensions are supported: ${chalk.bold('.apk')}, ${chalk.bold('.xapk')}, and ${chalk.bold('.apks')} (or ${chalk.bold('.zip')})
  `))

  process.exit(1)
}

/**
 * Error that is shown when the file provided through the `--certificate` flag
 * has an unsupported extension. Exits with status 1 after showing the message.
 */
function showSupportedCertificateExtensions(): never {
  console.log(chalk.yellow(`
  It looks like the certificate file you provided is unsupported!

  Only ${chalk.bold('.pem')} and ${chalk.bold('.der')} certificate files are supported.
  `))

  process.exit(1)
}

function showVersions({
  apktool,
  uberApkSigner,
}: {
  apktool: Tool
  uberApkSigner: Tool
}) {
  console.log(`
  ${chalk.dim('╭')} ${chalk.blue(`${chalk.bold('apk-mitm')} v${version}`)}
  ${chalk.dim(`├ ${chalk.bold('apktool')} ${apktool.version.name}`)}
  ${chalk.dim(`╰ ${chalk.bold('uber-apk-signer')} ${uberApkSigner.version.name}`)}
  `)
}

export function showArmWarning() {
  console.log(chalk.yellow(`
  ${chalk.inverse.bold('  NOTE ')}

  ${chalk.bold('apk-mitm')} doesn't officially support ARM-based devices (like Raspberry Pi's)
  at the moment, so the error above might be a result of that. Please try
  patching this APK on a device with a more common CPU architecture like x64
  before reporting an issue.
  `))
}

main()
