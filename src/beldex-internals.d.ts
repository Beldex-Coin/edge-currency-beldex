declare module '@bdxi/beldex-client' {
  declare function makeBridge(): Promise<any>
  export default makeBridge
}

// We are reaching inside the module to grab stuff,
// so hack in some type definitions:
declare module 'react-native-beldex-core/src/CppBridge' {
  import type {
    NativeBeldexCore,
    CppBridge
  } from 'react-native-beldex-core'

  type CppBridgeConstructor = new (
    nativeModule: NativeBeldexCore
  ) => CppBridge

  declare const Constructor: CppBridgeConstructor
  export default Constructor
}
