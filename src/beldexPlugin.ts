/**
 * Created by paul on 8/8/17.
 */

import type {
  EdgeCorePluginOptions,
  EdgeCurrencyPlugin
} from 'edge-core-js/types'

import { makeCurrencyEngine } from './BeldexEngine'
import { currencyInfo } from './beldexInfo'
import { BeldexTools } from './BeldexTools'

export function makeBeldexPlugin(
  env: EdgeCorePluginOptions
): EdgeCurrencyPlugin {
  const tools = new BeldexTools(env)

  return {
    currencyInfo,

    async makeCurrencyEngine(walletInfo, opts) {
      return await makeCurrencyEngine(env, tools, walletInfo, opts)
    },

    async makeCurrencyTools() {
      return tools
    }
  }
}
