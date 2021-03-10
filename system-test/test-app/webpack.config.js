'use strict'

const path = require('path')

const entryFile = path.resolve(__dirname, './src/index.ts')

const commonConfig = () => {
  return {
    // mode: 'development',
    // devtool: 'inline-source-map',
    entry: [entryFile],
    target: 'webworker',
    module: {
      rules: [
        // Handle TypeScript
        {
          test: /\.(ts?)$/,
          use: 'ts-loader',
          exclude: [/node_modules/]
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    output: {
      // put build output somewhere where the compositor can find it.
      path: path.resolve(__dirname, `./build`),
      publicPath: '/',
      filename: 'app.js'
    }
  }
}

module.exports = commonConfig
