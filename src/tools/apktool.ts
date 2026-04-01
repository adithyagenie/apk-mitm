import { map } from 'rxjs/operators/index.js'
import chalk from 'chalk'

import { executeJar } from '../utils/execute-jar.js'
import observeProcess from '../utils/observe-process.js'
import Tool from './tool.js'

interface ApktoolOptions {
  frameworkPath: string
  customPath?: string
}

export default class Apktool extends Tool {
  constructor(private options: ApktoolOptions) {
    super()
  }

  decode(inputPath: string, outputPath: string) {
    return this.run(
      [
        'decode',
        inputPath,
        '--output',
        outputPath,
        '--frame-path',
        this.options.frameworkPath,
      ],
      'decoding',
    )
  }

  encode(inputPath: string, outputPath: string) {
    return this.run(
      [
        'build',
        inputPath,
        '--output',
        outputPath,
        '--frame-path',
        this.options.frameworkPath,
      ],
      'encoding',
    )
  }

  private run(args: string[], logName: string) {
    return map((line: string) => line.replace(/I: /g, ''))(
      observeProcess(executeJar(this.path, args), logName),
    )
  }

  private get path() {
    return this.options.customPath || this.jarPath
  }

  name = 'apktool'
  get version() {
    if (this.options.customPath) return { name: chalk.italic('custom version') }

    const versionNumber = '3.0.1'

    return {
      name: `v${versionNumber}`,
      downloadUrl:
        'https://github.com/iBotPeaches/Apktool/releases/download' +
        `/v${versionNumber}/apktool_${versionNumber}.jar`,
    }
  }
}
