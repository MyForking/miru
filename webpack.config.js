const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
module.exports = {
  entry: './app/js/main.js',
  externals: {
    halfmoon: 'halfmoon',
    anitomyscript: 'anitomyscript'
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'app/js'),
    sourceMapFilename: 'bundle.js.map'
  },
  mode: 'development',
  devtool: 'source-map',
  plugins: [
    new NodePolyfillPlugin()
  ]
}
