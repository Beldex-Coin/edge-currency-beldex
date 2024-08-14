
import { NativeModules } from 'react-native'
import type { NativeBeldexCore } from 'react-native-beldex-core'

export default function makeCustomIo(): NativeBeldexCore {
  return NativeModules.BeldexCore
}
