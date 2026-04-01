import * as path from 'path'
import Listr from 'listr'

import modifyManifest from './modify-manifest.js'
import createNetworkSecurityConfig from './create-netsec-config.js'
import disableCertificatePinning from './disable-certificate-pinning.js'
import copyCertificateFile from './copy-certificate-file.js'

export default function applyPatches(
  decodeDir: string,
  {
    debuggable = false,
    certificatePath,
    mapsApiKey,
  }: {
    debuggable?: boolean
    certificatePath?: string
    mapsApiKey?: string
  } = {},
) {
  return new Listr([
    {
      title: 'Modifying app manifest',
      task: async (context: { usesAppBundle: boolean }) => {
        const result = await modifyManifest(
          path.join(decodeDir, 'AndroidManifest.xml'),
          debuggable,
          mapsApiKey,
        )

        context.usesAppBundle = result.usesAppBundle
      },
    },
    {
      title: 'Copying certificate file',
      skip: () =>
        certificatePath ? false : '--certificate flag not specified.',
      task: () => copyCertificateFile(decodeDir, certificatePath!),
    },
    {
      title: 'Replacing network security config',
      task: () =>
        createNetworkSecurityConfig(
          path.join(decodeDir, `res/xml/nsc_mitm.xml`),
          { certificatePath },
        ),
    },
    {
      title: 'Disabling certificate pinning',
      task: (_, task) => disableCertificatePinning(decodeDir, task),
    },
  ])
}
