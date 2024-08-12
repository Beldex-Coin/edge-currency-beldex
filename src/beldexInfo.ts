import type { EdgeCurrencyInfo } from 'edge-core-js/types'

import type { BeldexUserSettings } from './beldexTypes.js'

const defaultSettings: BeldexUserSettings = {
  enableCustomServers: false,
  beldexLightwalletServer: 'https://lwsapi.beldex.io'
}

export const currencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'BDX',
  displayName: 'Beldex',
  pluginId: 'beldex',
  requiredConfirmations: 10,
  walletType: 'wallet:beldex',

  defaultSettings,

  // addressExplorer: 'https://xmrchain.net/search?value=%s',
  addressExplorer: 'https://explorer.beldex.io/',// Currently given beldex explorer

  // transactionExplorer:
  //   'https://blockchair.com/monero/transaction/%s?from=edgeapp',
  transactionExplorer:
    'https://explorer.beldex.io/',// Currently given beldex explorer
  denominations: [
    // An array of Objects of the possible denominations for this currency
    {
      name: 'BDX',
      multiplier: '1000000000',
      symbol: 'ɱ'
    }
  ],
  metaTokens: [],

  unsafeMakeSpend: true,
  unsafeSyncNetwork: true
}
