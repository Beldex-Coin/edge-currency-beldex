import { div, mul, toFixed } from 'biggystring'
import type {
  EdgeCorePluginOptions,
  EdgeDenomination,
  EdgeEncodeUri,
  EdgeIo,
  EdgeLog,
  EdgeParsedUri,
  EdgeWalletInfo
} from 'edge-core-js/types'
import type {
  CppBridge as CppBridgeType,
  NativeBeldexCore
} from 'react-native-beldex-core'
import CppBridge from 'react-native-beldex-core/src/CppBridge'
import { parse, serialize } from 'uri-js'

import { currencyInfo } from './beldexInfo'
import type { BeldexNetworkInfo, PrivateKeys, PublicKeys } from './beldexTypes'

function getDenomInfo(denom: string): EdgeDenomination | undefined {
  return currencyInfo.denominations.find(element => {
    return element.name === denom
  })
}

function getParameterByName(param: string, url: string): string | undefined {
  const name = param.replace(/[[\]]/g, '\\$&')
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)')
  const results = regex.exec(url)
  if (results == null || results[2] == null) return
  return decodeURIComponent(results[2].replace(/\+/g, ' '))
}

export class BeldexTools {
  cppBridge: CppBridgeType
  io: EdgeIo
  log: EdgeLog
  networkInfo: BeldexNetworkInfo = {
    defaultServer: 'https://lwsapi.beldex.io',
    nettype: 'MAINNET'
  }

  constructor(env: EdgeCorePluginOptions) {
    const { io, log, nativeIo } = env

    // Grab the raw C++ API and wrap it in argument parsing:
    const cppModule = nativeIo['edge-currency-beldex'] as NativeBeldexCore
    this.cppBridge = new CppBridge(cppModule)

    this.io = io
    this.log = log
  }

  async createPrivateKey(walletType: string): Promise<PrivateKeys> {
    if (walletType !== 'wallet:beldex') {
      throw new Error('InvalidWalletType')
    }

    const result = await this.cppBridge.generateWallet(
      'english',
      this.networkInfo.nettype
    )
    const privateKeys: PrivateKeys = {
      beldexKey: result.mnemonic,
      beldexSpendKeyPrivate: result.privateSpendKey,
      beldexSpendKeyPublic: result.publicSpendKey
    }
    return privateKeys
  }

  async derivePublicKey(walletInfo: EdgeWalletInfo): Promise<PublicKeys> {
    if (walletInfo.type !== 'wallet:beldex') {
      throw new Error('InvalidWalletType')
    }

    const result = await this.cppBridge.seedAndKeysFromMnemonic(
      walletInfo.keys.beldexKey,
      this.networkInfo.nettype
    )
    const publicKeys: PublicKeys = {
      beldexAddress: result.address,
      beldexViewKeyPrivate: result.privateViewKey,
      beldexViewKeyPublic: result.publicViewKey,
      beldexSpendKeyPublic: result.publicSpendKey
    }
    return publicKeys
  }

  async parseUri(uri: string): Promise<EdgeParsedUri> {
    const parsedUri = parse(uri)
    let address: string
    let nativeAmount: string | undefined
    let currencyCode: string | undefined

    if (
      typeof parsedUri.scheme !== 'undefined' &&
      parsedUri.scheme !== 'beldex'
    ) {
      throw new Error('InvalidUriError') // possibly scanning wrong crypto type
    }
    if (typeof parsedUri.host !== 'undefined') {
      address = parsedUri.host
    } else if (typeof parsedUri.path !== 'undefined') {
      address = parsedUri.path
    } else {
      throw new Error('InvalidUriError')
    }
    address = address.replace('/', '') // Remove any slashes

    try {
      // verify address is decodable for currency
      await this.cppBridge.decodeAddress(address, this.networkInfo.nettype)
    } catch (e) {
      throw new Error('InvalidPublicAddressError')
    }

    const amountStr = getParameterByName('amount', uri)
    if (amountStr != null) {
      const denom = getDenomInfo('BDX')
      if (denom == null) {
        throw new Error('InternalErrorInvalidCurrencyCode')
      }
      nativeAmount = mul(amountStr, denom.multiplier)
      nativeAmount = toFixed(nativeAmount, 0, 0)
      currencyCode = 'BDX'
    }
    const uniqueIdentifier = getParameterByName('tx_payment_id', uri)
    const label = getParameterByName('label', uri)
    const message = getParameterByName('message', uri)
    const category = getParameterByName('category', uri)

    const edgeParsedUri: EdgeParsedUri = {
      publicAddress: address
    }
    if (nativeAmount != null) {
      edgeParsedUri.nativeAmount = nativeAmount
    }
    if (currencyCode != null) {
      edgeParsedUri.currencyCode = currencyCode
    }
    if (uniqueIdentifier != null) {
      edgeParsedUri.uniqueIdentifier = uniqueIdentifier
    }
    if (label != null || message != null || category != null) {
      edgeParsedUri.metadata = {}
      if (label != null) {
        edgeParsedUri.metadata.name = label
      }
      if (message != null) {
        edgeParsedUri.metadata.notes = message
      }
      if (category != null) {
        edgeParsedUri.metadata.category = category
      }
    }

    return edgeParsedUri
  }

  async encodeUri(obj: EdgeEncodeUri): Promise<string> {
    if (obj.publicAddress == null) {
      throw new Error('InvalidPublicAddressError')
    }
    try {
      await this.cppBridge.decodeAddress(
        obj.publicAddress,
        this.networkInfo.nettype
      )
    } catch (e) {
      throw new Error('InvalidPublicAddressError')
    }
    if (obj.nativeAmount == null && obj.label == null && obj.message == null) {
      return obj.publicAddress
    } else {
      let queryString: string = ''

      if (typeof obj.nativeAmount === 'string') {
        const currencyCode: string = 'BDX'
        const nativeAmount: string = obj.nativeAmount
        const denom = getDenomInfo(currencyCode)
        if (denom == null) {
          throw new Error('InternalErrorInvalidCurrencyCode')
        }
        const amount = div(nativeAmount, denom.multiplier, 9)

        queryString += 'amount=' + amount + '&'
      }
      if (typeof obj.label === 'string') {
        queryString += 'label=' + obj.label + '&'
      }
      if (typeof obj.message === 'string') {
        queryString += 'message=' + obj.message + '&'
      }
      queryString = queryString.substr(0, queryString.length - 1)

      const serializeObj = {
        scheme: 'beldex',
        path: obj.publicAddress,
        query: queryString
      }
      const url = serialize(serializeObj)
      return url
    }
  }
}
