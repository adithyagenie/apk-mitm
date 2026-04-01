import { unzip, zip } from '@tybys/cross-zip'
import * as fs from './utils/fs.js'
import * as path from 'path'
import * as os from 'os'
import { globby } from 'globby'
import Listr from 'listr'
import { execa } from 'execa'

import patchApk from './patch-apk.js'
import type { TaskOptions } from './cli.js'
import observeAsync from './utils/observe-async.js'
import buildGlob from './utils/build-glob.js'

export function patchXapkBundle(options: TaskOptions) {
  return patchAppBundle(options, { isXapk: true })
}

export function patchApksBundle(options: TaskOptions) {
  return patchAppBundle(options, { isXapk: false })
}

function patchAppBundle(options: TaskOptions, { isXapk }: { isXapk: boolean }) {
  const { inputPath, outputPath, tmpDir, uberApkSigner } = options

  const bundleDir = path.join(tmpDir, 'bundle')
  let baseApkPath = path.join(bundleDir, 'base.apk')

  return new Listr([
    {
      title: 'Extracting APKs',
      task: async () => {
        await unzip(inputPath, bundleDir)

        if (os.type() !== 'Windows_NT') {
          // Under Unix: Make sure the user has read and write permissions to
          // the extracted files (which is sometimes not the case by default)
          await execa('chmod', ['-R', 'u+rw', bundleDir])
        }
      },
    },
    ...(isXapk
      ? [
          {
            title: 'Finding base APK path',
            task: async () => {
              const manifestPath = path.join(bundleDir, 'manifest.json')
              const manifestContent = await fs.readFile(manifestPath, 'utf-8')
              const manifest = JSON.parse(manifestContent)

              baseApkPath = path.join(bundleDir, getXapkBaseName(manifest))
            },
          },
        ]
      : []),
    {
      title: 'Patching base APK',
      task: () =>
        patchApk({
          ...options,
          inputPath: baseApkPath,
          outputPath: baseApkPath,
          tmpDir: path.join(tmpDir, 'base-apk'),
        }),
    },
    {
      title: 'Signing APKs',
      task: () =>
        observeAsync(async log => {
          const apkFiles = await globby(buildGlob(bundleDir, '**/*.apk'))

          await uberApkSigner
            .sign(apkFiles, { zipalign: false })
            .forEach(line => log(line))
        }),
    },
    {
      title: 'Compressing APKs',
      task: () => zip(bundleDir, outputPath),
    },
  ])
}

function getXapkBaseName(manifest: any) {
  if (manifest.split_apks) {
    return manifest.split_apks.filter((apk: any) => apk.id === 'base')[0].file
  }

  return `${manifest.package_name}.apk`
}
