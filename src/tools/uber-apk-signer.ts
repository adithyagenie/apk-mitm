import { executeJar } from '../utils/execute-jar.js'
import observeProcess from '../utils/observe-process.js'
import Tool from './tool.js'

export default class UberApkSigner extends Tool {
  sign(inputPaths: string[], { zipalign = false } = {}) {
    const pathArgs = []
    for (const path of inputPaths) {
      pathArgs.push('--apks', path)
    }

    return observeProcess(
      executeJar(this.jarPath, [
        '--allowResign',
        '--overwrite',
        ...(zipalign ? [] : ['--skipZipAlign']),
        ...pathArgs,
      ]),
      'signing',
    )
  }

  name = 'uber-apk-signer'
  get version() {
    const versionNumber = '1.3.0'

    return {
      name: `v${versionNumber}`,
      downloadUrl:
        'https://github.com/patrickfav/uber-apk-signer/releases/download' +
        `/v${versionNumber}/uber-apk-signer-${versionNumber}.jar`,
    }
  }
}
