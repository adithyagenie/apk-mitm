import { globbyStream } from 'globby'
import { type ListrTaskWrapper } from 'listr'

import observeAsync from '../utils/observe-async.js'
import processSmaliFile from './smali/process-file.js'
import buildGlob from '../utils/build-glob.js'

export default async function disableCertificatePinning(
  directoryPath: string,
  task: ListrTaskWrapper,
) {
  return observeAsync(async log => {
    const smaliGlob = buildGlob(directoryPath, 'smali*/**/*.smali')

    let pinningFound = false

    log('Scanning Smali files...')
    for await (const filePathChunk of globbyStream(smaliGlob)) {
      // Required because Node.js streams are not typed as generics
      const filePath = filePathChunk as string

      const hadPinning = await processSmaliFile(filePath, log)
      if (hadPinning) pinningFound = true
    }

    if (!pinningFound) task.skip('No certificate pinning logic found.')
  })
}
