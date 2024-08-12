/**
 * Created by paul on 8/26/17.
 */

import { asBoolean, asMaybe, asObject, asOptional, asString } from 'cleaners'
import type { EdgeCurrencyTools, EdgeWalletInfo } from 'edge-core-js'
import type { Nettype } from 'react-native-beldex-core'

export const asBeldexInitOptions = asObject({
  apiKey: asOptional(asString, '')
})

export interface BeldexNetworkInfo {
  defaultServer: string
  nettype: Nettype
}

export const asBeldexUserSettings = asObject({
  enableCustomServers: asMaybe(asBoolean, false),
  beldexLightwalletServer: asMaybe(asString)
})
export type BeldexUserSettings = ReturnType<typeof asBeldexUserSettings>

export const asPrivateKeys = asObject({
  beldexKey: asString,
  beldexSpendKeyPrivate: asString,
  beldexSpendKeyPublic: asString
})
export type PrivateKeys = ReturnType<typeof asPrivateKeys>

export const asPublicKeys = asObject({
  beldexAddress: asString,
  beldexViewKeyPrivate: asString,
  beldexViewKeyPublic: asString,
  beldexSpendKeyPublic: asString
})
export type PublicKeys = ReturnType<typeof asPublicKeys>

export const asSafeWalletInfo = asObject({
  id: asString,
  type: asString,
  keys: asPublicKeys
})
export type SafeWalletInfo = ReturnType<typeof asSafeWalletInfo>

export const makeSafeWalletInfo = async (
  tools: EdgeCurrencyTools,
  walletInfo: EdgeWalletInfo
): Promise<SafeWalletInfo> => {
  // @ts-expect-error
  const safeWalletInfo: SafeWalletInfo = {}
  if (
    typeof walletInfo.keys.beldexAddress !== 'string' ||
    typeof walletInfo.keys.beldexViewKeyPrivate !== 'string' ||
    typeof walletInfo.keys.beldexViewKeyPublic !== 'string' ||
    typeof walletInfo.keys.beldexSpendKeyPublic !== 'string'
  ) {
    const pubKeys = await tools.derivePublicKey(walletInfo)
    return {
      id: walletInfo.id,
      type: walletInfo.type,
      keys: {
        beldexAddress: pubKeys.beldexAddress,
        beldexViewKeyPrivate: pubKeys.beldexViewKeyPrivate,
        beldexViewKeyPublic: pubKeys.beldexViewKeyPublic,
        beldexSpendKeyPublic: pubKeys.beldexSpendKeyPublic
      }
    }
  }

  return safeWalletInfo
}
