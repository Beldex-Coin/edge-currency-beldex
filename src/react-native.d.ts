declare module 'react-native' {
  import type { NativeBeldexCore } from 'react-native-beldex-core'
  declare const NativeModules: {
    BeldexCore: NativeBeldexCore
  }
}
