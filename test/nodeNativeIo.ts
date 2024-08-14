import makeBridge from '@bdxi/beldex-client'
import type { EdgeNativeIo } from 'edge-core-js/types'
import type { NativeBeldexCore } from 'react-native-beldex-core'

const bridgePromise: Promise<any> = makeBridge()

/**
 * We are emulating the `react-native-beldex-core` API
 * using the `@bdxi/beldex-client` WASM module.
 */
const bridge: NativeBeldexCore = {
  async callBeldex(name, jsonArguments) {
    const bridge = await bridgePromise
    return bridge.Module[name](...jsonArguments)
  },

  methodNames: [
    'addressAndKeysFromSeed',
    'compareMnemonics',
    'createAndSignTx',
    'decodeAddress',
    'estimateTxFee',
    'generateKeyImage',
    'generatePaymentId',
    'generateWallet',
    'isIntegratedAddress',
    'isSubaddress',
    'isValidKeys',
    'mnemonicFromSeed',
    'newIntegratedAddress',
    'prepareTx',
    'seedAndKeysFromMnemonic'
  ]
}

export const nativeIo: EdgeNativeIo = {
  'edge-currency-beldex': bridge
}
