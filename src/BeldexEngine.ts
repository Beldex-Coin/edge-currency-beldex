/**
 * Created by paul on 7/7/17.
 */

import { div, eq, gte, lt, sub } from 'biggystring'
import type { Disklet } from 'disklet'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyCodeOptions,
  EdgeCurrencyEngine,
  EdgeCurrencyEngineCallbacks,
  EdgeCurrencyEngineOptions,
  EdgeCurrencyInfo,
  EdgeDataDump,
  EdgeEnginePrivateKeyOptions,
  EdgeFreshAddress,
  EdgeGetReceiveAddressOptions,
  EdgeIo,
  EdgeLog,
  EdgeMemo,
  EdgeMetaToken,
  EdgeSpendInfo,
  EdgeToken,
  EdgeTransaction,
  EdgeWalletInfo,
  InsufficientFundsError,
  JsonObject,
  NoAmountSpecifiedError,
  PendingFundsError
} from 'edge-core-js/types'
import type { CreatedTransaction, Priority } from 'react-native-beldex-core'

import { currencyInfo } from './beldexInfo'
import { DATA_STORE_FILE, BeldexLocalData } from './BeldexLocalData'
import { BeldexTools } from './BeldexTools'
import {
  asBeldexInitOptions,
  asBeldexUserSettings,
  asPrivateKeys,
  asSafeWalletInfo,
  makeSafeWalletInfo,
  BeldexUserSettings,
  PrivateKeys,
  SafeWalletInfo
} from './beldexTypes'
import {
  CreateTransactionOptions,
  BeldexApi,
  ParsedTransaction
} from './BeldexApi'
import { cleanTxLogs, normalizeAddress } from './utils'

const SYNC_INTERVAL_MILLISECONDS = 5000
const SAVE_DATASTORE_MILLISECONDS = 10000
// const ADDRESS_QUERY_LOOKBACK_BLOCKS = '8' // ~ 2 minutes
// const ADDRESS_QUERY_LOOKBACK_BLOCKS = (4 * 60 * 24 * 7) // ~ one week

const PRIMARY_CURRENCY = currencyInfo.currencyCode

export class BeldexEngine implements EdgeCurrencyEngine {
  apiKey: string
  walletInfo: SafeWalletInfo
  edgeTxLibCallbacks: EdgeCurrencyEngineCallbacks
  walletLocalDisklet: Disklet
  engineOn: boolean
  loggedIn: boolean
  addressesChecked: boolean
  walletLocalData!: BeldexLocalData
  walletLocalDataDirty: boolean
  transactionsChangedArray: EdgeTransaction[]
  currencyInfo: EdgeCurrencyInfo
  allTokens: EdgeMetaToken[]
  BeldexApi: BeldexApi
  currentSettings: BeldexUserSettings
  timers: any
  walletId: string
  io: EdgeIo
  log: EdgeLog
  currencyTools: BeldexTools

  constructor(
    env: EdgeCorePluginOptions,
    tools: BeldexTools,
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ) {
    const { callbacks, userSettings = {}, walletLocalDisklet } = opts
    const initOptions = asBeldexInitOptions(env.initOptions ?? {})
    const { networkInfo } = tools

    this.apiKey = initOptions.apiKey
    this.io = env.io
    this.log = opts.log
    this.engineOn = false
    this.loggedIn = false
    this.addressesChecked = false
    this.walletLocalDataDirty = false
    this.transactionsChangedArray = []
    this.walletInfo = walletInfo as any // We derive the public keys at init
    this.walletId = walletInfo.id
    this.currencyInfo = currencyInfo
    this.currencyTools = tools
    this.BeldexApi = new BeldexApi(tools.cppBridge, {
      apiKey: initOptions.apiKey,
      apiServer: networkInfo.defaultServer,
      fetch: env.io.fetch,
      nettype: networkInfo.nettype
    })

    this.allTokens = currencyInfo.metaTokens.slice(0)
    // this.customTokens = []
    this.timers = {}

    this.currentSettings = {
      ...currencyInfo.defaultSettings,
      ...asBeldexUserSettings(userSettings)
    }
    if (
      this.currentSettings.enableCustomServers &&
      this.currentSettings.beldexLightwalletServer != null
    ) {
      this.BeldexApi.changeServer(
        this.currentSettings.beldexLightwalletServer,
        ''
      )
    }

    // Hard coded for testing
    // this.walletInfo.keys.moneroKey = '389b07b3466eed587d6bdae09a3613611de9add2635432d6cd1521af7bbc3757'
    // this.walletInfo.keys.beldexAddress = '0x9fa817e5A48DD1adcA7BEc59aa6E3B1F5C4BeA9a'
    this.edgeTxLibCallbacks = callbacks
    this.walletLocalDisklet = walletLocalDisklet

    this.log(
      `Created Wallet Type ${this.walletInfo.type} for Currency Plugin ${this.currencyInfo.pluginId} `
    )
  }

  async init(): Promise<void> {
    const safeWalletInfo = await makeSafeWalletInfo(
      this.currencyTools,
      this.walletInfo
    )
    this.walletInfo.keys = {
      ...this.walletInfo.keys,
      ...safeWalletInfo.keys
    }
  }

  updateOnAddressesChecked(numTx: number, totalTxs: number): void {
    if (this.addressesChecked) {
      return
    }
    if (numTx !== totalTxs) {
      const progress = numTx / totalTxs
      this.edgeTxLibCallbacks.onAddressesChecked(progress)
    } else {
      this.addressesChecked = true
      this.edgeTxLibCallbacks.onAddressesChecked(1)
      this.walletLocalData.lastAddressQueryHeight =
        this.walletLocalData.blockHeight
    }
  }

  // **********************************************
  // Login to mymonero.com server
  // **********************************************
  async loginIfNewAddress(privateKeys: PrivateKeys): Promise<void> {
    try {
      const result = await this.BeldexApi.login({
        address: this.walletInfo.keys.beldexAddress,
        privateViewKey: this.walletInfo.keys.beldexViewKeyPrivate,
        privateSpendKey: privateKeys.beldexSpendKeyPrivate,
        publicSpendKey: privateKeys.beldexSpendKeyPublic
      })
      if ('new_address' in result && !this.loggedIn) {
        this.loggedIn = true
        this.walletLocalData.hasLoggedIn = true
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.addToLoop('saveWalletLoop', SAVE_DATASTORE_MILLISECONDS)
      }
    } catch (e) {
      this.log.error('Error logging into beldex', e)
    }
  }

  // ***************************************************
  // Check address for updated block height and balance
  // ***************************************************
  async checkAddressInnerLoop(privateKeys: PrivateKeys): Promise<void> {
    try {
      const addrResult = await this.BeldexApi.getAddressInfo({
        address: this.walletInfo.keys.beldexAddress,
        privateViewKey: this.walletInfo.keys.beldexViewKeyPrivate,
        privateSpendKey: privateKeys.beldexSpendKeyPrivate,
        publicSpendKey: privateKeys.beldexSpendKeyPublic
      })

      if (this.walletLocalData.blockHeight !== addrResult.blockHeight) {
        this.walletLocalData.blockHeight = addrResult.blockHeight // Convert to decimal
        this.walletLocalDataDirty = true
        this.edgeTxLibCallbacks.onBlockHeightChanged(
          this.walletLocalData.blockHeight
        )
      }

      const nativeBalance = sub(addrResult.totalReceived, addrResult.totalSent)

      if (this.walletLocalData.totalBalances.BDX !== nativeBalance) {
        this.walletLocalData.totalBalances.BDX = nativeBalance
        this.edgeTxLibCallbacks.onBalanceChanged('BDX', nativeBalance)
      }
      this.walletLocalData.lockedBdxBalance = addrResult.lockedBalance
    } catch (e) {
      this.log.error(
        `Error fetching address info: ${
          this.walletInfo.keys.beldexAddress
        } ${String(e)}`
      )
    }
  }

  processBeldexTransaction(tx: ParsedTransaction): void {
    const ourReceiveAddresses: string[] = []

    const nativeNetworkFee: string = tx.fee != null ? tx.fee : '0'

    const netNativeAmount: string = sub(tx.total_received, tx.total_sent)

    if (netNativeAmount.slice(0, 1) !== '-') {
      ourReceiveAddresses.push(this.walletInfo.keys.beldexAddress.toLowerCase())
    }

    let blockHeight = tx.height
    if (tx.mempool) {
      blockHeight = 0
    }

    const date = Date.parse(tx.timestamp) / 1000

    // Expose legacy payment ID's to the GUI. This only applies
    // to really old transactions, before integrated addresses:
    const memos: EdgeMemo[] = []
    if (tx.payment_id != null) {
      memos.push({
        memoName: 'payment id',
        type: 'hex',
        value: tx.payment_id
      })
    }

    let edgeTransaction: EdgeTransaction = {
      blockHeight,
      currencyCode: 'BDX',
      date,
      isSend: lt(netNativeAmount, '0'),
      memos,
      nativeAmount: netNativeAmount,
      networkFee: nativeNetworkFee,
      otherParams: {},
      ourReceiveAddresses,
      signedTx: '',
      tokenId: null,
      txid: tx.hash,
      walletId: this.walletId
    }

    const idx = this.findTransaction(PRIMARY_CURRENCY, tx.hash)
    if (idx === -1) {
      this.log(`New transaction: ${tx.hash}`)

      // New transaction not in database
      this.addTransaction(PRIMARY_CURRENCY, edgeTransaction)

      this.edgeTxLibCallbacks.onTransactionsChanged(
        this.transactionsChangedArray
      )
      this.transactionsChangedArray = []
    } else {
      // Already have this tx in the database. See if anything changed
      const transactionsArray: EdgeTransaction[] =
        this.walletLocalData.transactionsObj[PRIMARY_CURRENCY]
      const edgeTx = transactionsArray[idx]

      if (edgeTx.blockHeight !== edgeTransaction.blockHeight) {
        // The native amounts returned from the API take some time before they're accurate. We can trust the amounts we saved instead.
        edgeTransaction = {
          ...edgeTransaction,
          nativeAmount: edgeTx.nativeAmount
        }

        this.log(`Update transaction: ${tx.hash} height:${tx.height}`)
        this.updateTransaction(PRIMARY_CURRENCY, edgeTransaction, idx)
        this.edgeTxLibCallbacks.onTransactionsChanged(
          this.transactionsChangedArray
        )
        this.transactionsChangedArray = []
      }
    }
  }

  async checkTransactionsInnerLoop(privateKeys: PrivateKeys): Promise<void> {
    // TODO: support partial query by block height once API supports it
    // const endBlock:number = 999999999
    // let startBlock:number = 0
    // if (this.walletLocalData.lastAddressQueryHeight > ADDRESS_QUERY_LOOKBACK_BLOCKS) {
    //   // Only query for transactions as far back as ADDRESS_QUERY_LOOKBACK_BLOCKS from the last time we queried transactions
    //   startBlock = this.walletLocalData.lastAddressQueryHeight - ADDRESS_QUERY_LOOKBACK_BLOCKS
    // }

    try {
      const transactions = await this.BeldexApi.getTransactions({
        address: this.walletInfo.keys.beldexAddress,
        privateViewKey: this.walletInfo.keys.beldexViewKeyPrivate,
        privateSpendKey: privateKeys.beldexSpendKeyPrivate,
        publicSpendKey: privateKeys.beldexSpendKeyPublic
      })

      this.log(`Fetched transactions count: ${transactions.length}`)

      // Get transactions
      // Iterate over transactions in address
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i]
        this.processBeldexTransaction(tx)
        if (i % 10 === 0) {
          this.updateOnAddressesChecked(i, transactions.length)
        }
      }
      this.updateOnAddressesChecked(transactions.length, transactions.length)
    } catch (e) {
      this.log.error('checkTransactionsInnerLoop', e)
    }
  }

  findTransaction(currencyCode: string, txid: string): any {
    if (
      typeof this.walletLocalData.transactionsObj[currencyCode] === 'undefined'
    ) {
      return -1
    }

    const currency = this.walletLocalData.transactionsObj[currencyCode]
    return currency.findIndex(element => {
      return normalizeAddress(element.txid) === normalizeAddress(txid)
    })
  }

  sortTxByDate(a: EdgeTransaction, b: EdgeTransaction): number {
    return b.date - a.date
  }

  addTransaction(currencyCode: string, edgeTransaction: EdgeTransaction): void {
    // Add or update tx in transactionsObj
    const idx = this.findTransaction(currencyCode, edgeTransaction.txid)

    if (idx === -1) {
      this.log.warn(
        'addTransaction: adding and sorting:' +
          edgeTransaction.txid +
          edgeTransaction.nativeAmount
      )
      if (
        typeof this.walletLocalData.transactionsObj[currencyCode] ===
        'undefined'
      ) {
        this.walletLocalData.transactionsObj[currencyCode] = []
      }
      this.walletLocalData.transactionsObj[currencyCode].push(edgeTransaction)

      // Sort
      this.walletLocalData.transactionsObj[currencyCode].sort(this.sortTxByDate)
      this.walletLocalDataDirty = true
      this.transactionsChangedArray.push(edgeTransaction)
    } else {
      this.updateTransaction(currencyCode, edgeTransaction, idx)
    }
  }

  updateTransaction(
    currencyCode: string,
    edgeTransaction: EdgeTransaction,
    idx: number
  ): void {
    // Update the transaction
    this.walletLocalData.transactionsObj[currencyCode][idx] = edgeTransaction
    this.walletLocalDataDirty = true
    this.transactionsChangedArray.push(edgeTransaction)
    this.log.warn(
      'updateTransaction' + edgeTransaction.txid + edgeTransaction.nativeAmount
    )
  }

  // *************************************
  // Save the wallet data store
  // *************************************
  async saveWalletLoop(): Promise<void> {
    if (this.walletLocalDataDirty) {
      try {
        this.log('walletLocalDataDirty. Saving...')
        const walletJson = JSON.stringify(this.walletLocalData)
        await this.walletLocalDisklet.setText(DATA_STORE_FILE, walletJson)
        this.walletLocalDataDirty = false
      } catch (err) {
        this.log.error('saveWalletLoop', err)
      }
    }
  }

  doInitialCallbacks(): void {
    for (const currencyCode of this.walletLocalData.enabledTokens) {
      try {
        this.edgeTxLibCallbacks.onBalanceChanged(
          currencyCode,
          this.walletLocalData.totalBalances[currencyCode]
        )
      } catch (e) {
        this.log.error('Error for currencyCode', currencyCode, e)
      }
    }
  }

  async addToLoop(func: string, timer: number): Promise<void> {
    try {
      // @ts-expect-error
      await this[func]()
    } catch (e) {
      this.log.error('Error in Loop:', func, e)
    }
    if (this.engineOn) {
      this.timers[func] = setTimeout(() => {
        if (this.engineOn) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.addToLoop(func, timer)
        }
      }, timer)
    }
  }

  // *************************************
  // Public methods
  // *************************************

  async changeUserSettings(userSettings: JsonObject): Promise<void> {
    this.currentSettings = {
      ...this.currencyInfo.defaultSettings,
      ...asBeldexUserSettings(userSettings)
    }
    if (
      this.currentSettings.enableCustomServers &&
      this.currentSettings.beldexLightwalletServer != null
    ) {
      this.BeldexApi.changeServer(
        this.currentSettings.beldexLightwalletServer,
        ''
      )
    } else {
      this.BeldexApi.changeServer(
        this.currencyTools.networkInfo.defaultServer,
        this.apiKey
      )
    }
  }

  async startEngine(): Promise<void> {
    this.engineOn = true
    this.doInitialCallbacks()
  }

  async killEngine(): Promise<void> {
    // Set status flag to false
    this.engineOn = false
    this.loggedIn = false
    // Clear Inner loops timers
    for (const timer in this.timers) {
      clearTimeout(this.timers[timer])
    }
    this.timers = {}
  }

  async resyncBlockchain(): Promise<void> {
    await this.killEngine()
    this.BeldexApi.keyImageCache = {}
    const temp = JSON.stringify({
      enabledTokens: this.walletLocalData.enabledTokens,
      // networkFees: this.walletLocalData.networkFees,
      beldexAddress: this.walletInfo.keys.beldexAddress,
      beldexViewKeyPrivate: this.walletInfo.keys.beldexViewKeyPrivate
    })
    this.walletLocalData = new BeldexLocalData(temp)
    this.walletLocalDataDirty = true
    this.addressesChecked = false
    await this.saveWalletLoop()
    await this.startEngine()
  }

  async syncNetwork(opts: EdgeEnginePrivateKeyOptions): Promise<number> {
    const bdxPrivateKeys = asPrivateKeys(opts.privateKeys)

    // Login only if not logged in
    if (!this.loggedIn) {
      await this.loginIfNewAddress(bdxPrivateKeys)
    }

    // Always check address
    await this.checkAddressInnerLoop(bdxPrivateKeys)
    // Always check transactions
    await this.checkTransactionsInnerLoop(bdxPrivateKeys)

    return SYNC_INTERVAL_MILLISECONDS
  }

  getBlockHeight(): number {
    return this.walletLocalData.blockHeight
  }

  async enableTokens(tokens: string[]): Promise<void> {}

  async disableTokens(tokens: string[]): Promise<void> {}

  async getEnabledTokens(): Promise<string[]> {
    return []
  }

  async addCustomToken(tokenObj: EdgeToken): Promise<void> {}

  getTokenStatus(token: string): boolean {
    return false
  }

  getBalance(options: EdgeCurrencyCodeOptions = {}): string {
    const { currencyCode = PRIMARY_CURRENCY } = options

    if (
      typeof this.walletLocalData.totalBalances[currencyCode] === 'undefined'
    ) {
      return '0'
    } else {
      const nativeBalance = this.walletLocalData.totalBalances[currencyCode]
      return nativeBalance
    }
  }

  getNumTransactions(options: EdgeCurrencyCodeOptions = {}): number {
    const { currencyCode = PRIMARY_CURRENCY } = options

    if (
      typeof this.walletLocalData.transactionsObj[currencyCode] === 'undefined'
    ) {
      return 0
    } else {
      return this.walletLocalData.transactionsObj[currencyCode].length
    }
  }

  async getTransactions(
    options: EdgeCurrencyCodeOptions = {}
  ): Promise<EdgeTransaction[]> {
    const { currencyCode = PRIMARY_CURRENCY } = options

    if (this.walletLocalData.transactionsObj[currencyCode] == null) {
      return []
    }

    return this.walletLocalData.transactionsObj[currencyCode].slice(0)
  }

  async getFreshAddress(
    options: EdgeGetReceiveAddressOptions
  ): Promise<EdgeFreshAddress> {
    return { publicAddress: this.walletInfo.keys.beldexAddress }
  }

  async addGapLimitAddresses(addresses: string[]): Promise<void> {}

  async isAddressUsed(address: string): Promise<boolean> {
    return false
  }

  async getMaxSpendable(
    edgeSpendInfo: EdgeSpendInfo,
    opts?: EdgeEnginePrivateKeyOptions
  ): Promise<string> {
    const privateKeys = asPrivateKeys(opts?.privateKeys)
    const [spendTarget] = edgeSpendInfo.spendTargets
    const { publicAddress } = spendTarget
    if (publicAddress == null) {
      throw new TypeError('Missing destination address')
    }

    const options = {
      amount: '0',
      isSweepTx: true,
      priority: translateFee(edgeSpendInfo.networkFeeOption),
      targetAddress: publicAddress
    }

    const result = await this.createBeldexTransaction(options, privateKeys)
    return result.final_total_wo_fee
  }

  async createBeldexTransaction(
    options: CreateTransactionOptions,
    privateKeys: PrivateKeys
  ): Promise<CreatedTransaction> {
    try {
      return await this.BeldexApi.createTransaction(
        {
          address: this.walletInfo.keys.beldexAddress,
          privateViewKey: this.walletInfo.keys.beldexViewKeyPrivate,
          privateSpendKey: privateKeys.beldexSpendKeyPrivate,
          publicSpendKey: privateKeys.beldexSpendKeyPublic
        },
        options
      )
    } catch (e: any) {
      // This error is specific to mymonero-core-js: github.com/mymonero/mymonero-core-cpp/blob/a53e57f2a376b05bb0f4d851713321c749e5d8d9/src/monero_transfer_utils.hpp#L112-L162
      this.log.error(e.message)
      const regex = / Have (\d*\.?\d+) BDX; need (\d*\.?\d+) BDX./gm
      const subst = `\nHave: $1 BDX.\nNeed: $2 BDX.`
      const msgFormatted = e.message.replace(regex, subst)
      throw new Error(msgFormatted)
    }
  }

  async makeSpend(
    edgeSpendInfo: EdgeSpendInfo,
    opts?: EdgeEnginePrivateKeyOptions
  ): Promise<EdgeTransaction> {
    const { memos = [] } = edgeSpendInfo
    const privateKeys = asPrivateKeys(opts?.privateKeys)

    // Beldex can only have one output
    // TODO: The new SDK fixes this!
    if (edgeSpendInfo.spendTargets.length !== 1) {
      throw new Error('Error: only one output allowed')
    }

    const [spendTarget] = edgeSpendInfo.spendTargets
    const { publicAddress, nativeAmount } = spendTarget
    if (publicAddress == null) {
      throw new TypeError('Missing destination address')
    }
    if (nativeAmount == null || eq(nativeAmount, '0')) {
      throw new NoAmountSpecifiedError()
    }

    if (gte(nativeAmount, this.walletLocalData.totalBalances.BDX)) {
      if (gte(this.walletLocalData.lockedBdxBalance, nativeAmount)) {
        throw new PendingFundsError()
      } else {
        throw new InsufficientFundsError()
      }
    }

    const options: CreateTransactionOptions = {
      amount: div(nativeAmount, '100000000', 9),
      isSweepTx: false,
      priority: translateFee(edgeSpendInfo.networkFeeOption),
      targetAddress: publicAddress
    }
    this.log(`Creating transaction: ${JSON.stringify(options, null, 1)}`)

    const result: CreatedTransaction = await this.createBeldexTransaction(
      options,
      privateKeys
    )

    const date = Date.now() / 1000

    this.log(`Total sent: ${result.total_sent}, Fee: ${result.used_fee}`)
    const edgeTransaction: EdgeTransaction = {
      blockHeight: 0, // blockHeight
      currencyCode: 'BDX', // currencyCode
      date,
      isSend: true,
      memos,
      nativeAmount: '-' + result.total_sent,
      networkFee: result.used_fee,
      ourReceiveAddresses: [], // ourReceiveAddresses
      signedTx: result.serialized_signed_tx,
      tokenId: null,
      txid: result.tx_hash,
      txSecret: result.tx_key,
      walletId: this.walletId
    }
    this.log.warn(`makeSpend edgeTransaction ${cleanTxLogs(edgeTransaction)}`)
    return edgeTransaction
  }

  async signTx(
    edgeTransaction: EdgeTransaction,
    privateKeys: JsonObject
  ): Promise<EdgeTransaction> {
    return edgeTransaction
  }

  async broadcastTx(
    edgeTransaction: EdgeTransaction
  ): Promise<EdgeTransaction> {
    try {
      await this.BeldexApi.broadcastTransaction(edgeTransaction.signedTx)
      this.log.warn(`broadcastTx success ${cleanTxLogs(edgeTransaction)}`)
      return edgeTransaction
    } catch (e) {
      this.log.error(
        `broadcastTx failed: ${String(e)} ${cleanTxLogs(edgeTransaction)}`
      )
      if (e instanceof Error && e.message.includes(' 422 ')) {
        throw new Error(
          'The Beldex network rejected this transaction. You may need to wait for more confirmations'
        )
      } else {
        throw e
      }
    }
  }

  async saveTx(edgeTransaction: EdgeTransaction): Promise<void> {
    await this.addTransaction(edgeTransaction.currencyCode, edgeTransaction)

    this.edgeTxLibCallbacks.onTransactionsChanged([edgeTransaction])
  }

  getDisplayPrivateSeed(privateKeys: JsonObject): string {
    const bdxPrivateKeys = asPrivateKeys(privateKeys)
    return bdxPrivateKeys.beldexKey
  }

  getDisplayPublicSeed(): string {
    if (this.walletInfo.keys?.beldexViewKeyPrivate != null) {
      return this.walletInfo.keys.beldexViewKeyPrivate
    }
    return ''
  }

  async dumpData(): Promise<EdgeDataDump> {
    const dataDump: EdgeDataDump = {
      walletId: this.walletId,
      walletType: this.walletInfo.type,
      // @ts-expect-error
      pluginType: this.currencyInfo.pluginId,
      data: {
        walletLocalData: this.walletLocalData
      }
    }
    return dataDump
  }
}

function translateFee(fee?: string): Priority {
  if (fee === 'NORMAL') return 1
  if (fee === 'FLASH') return 5
  return 5
}

export async function makeCurrencyEngine(
  env: EdgeCorePluginOptions,
  tools: BeldexTools,
  walletInfo: EdgeWalletInfo,
  opts: EdgeCurrencyEngineOptions
): Promise<EdgeCurrencyEngine> {
  const safeWalletInfo = asSafeWalletInfo(walletInfo)

  const engine = new BeldexEngine(env, tools, safeWalletInfo, opts)
  await engine.init()
  try {
    const result = await engine.walletLocalDisklet.getText(DATA_STORE_FILE)
    engine.walletLocalData = new BeldexLocalData(result)
  } catch (err) {
    try {
      opts.log(err)
      opts.log('No walletLocalData setup yet: Failure is ok')
      engine.walletLocalData = new BeldexLocalData(null)
      await engine.walletLocalDisklet.setText(
        DATA_STORE_FILE,
        JSON.stringify(engine.walletLocalData)
      )
    } catch (e) {
      opts.log.error(
        `Error writing to localDataStore. Engine not started: ${String(e)}`
      )
    }
  }

  return engine
}
