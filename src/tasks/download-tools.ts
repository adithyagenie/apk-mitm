import Listr from 'listr'

import createToolDownloadTask from '../utils/download-tool.js'
import { TaskOptions } from '../cli.js'

export default function downloadTools({ apktool, uberApkSigner }: TaskOptions) {
  return new Listr(
    [createToolDownloadTask(apktool), createToolDownloadTask(uberApkSigner)],
    { concurrent: true },
  )
}
