# Edge Beldex Currency Plugin


Implements Beldex send/receive functionality per the spec for crypto currency plugins for [edge-core-js](https://github.com/EdgeApp/edge-core-js)

## Installing

    yarn add edge-currency-beldex react-native-beldex-core

```
import { beldexCurrencyPluginFactory } from `edge-currency-beldex`
```

Now you can pass `beldexCurrencyPluginFactory` to `edge-core-js`.

```
const context = makeEdgeContext({
  apiKey: YOUR_API_KEY,
  plugins: [ beldexCurrencyPluginFactory ]
})
```

## Contributing

You'll need to install Yarn 1.3.2 globally on your machine

To run a local version of this repo inside the full Edge Wallet app, clone this repo at the same level as `edge-react-gui`

    git clone git@github.com:Beldex-Coin/edge-currency-beldex.git`
    cd edge-currency-beldex
    yarn

Run `npm run test` to run the unit tests.

To use the local cloned version of this repo, `cd edge-react-gui` and run

    npm run updot edge-currency-beldex
    npm run prepare

This will copy the necessary files from `edge-currency-beldex` into the `edge-react-gui/node_modules/edge-currency-beldex` replacing the npm installed version. This needs to be done after any modifications to `edge-currency-beldex`

## License
BSD 3

[npm-image]: https://badge.fury.io/js/edge-currency-ethereum.svg
[npm-url]: https://npmjs.org/package/edge-currency-ethereum
[travis-image]: https://travis-ci.org/Airbitz/edge-currency-ethereum.svg?branch=master
[travis-url]: https://travis-ci.org/Airbitz/edge-currency-ethereum
[daviddm-image]: https://david-dm.org/Airbitz/edge-currency-ethereum.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/Airbitz/edge-currency-ethereum
