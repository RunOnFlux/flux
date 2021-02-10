const path = require('path');
const CompressionPlugin = require('compression-webpack-plugin');
// ideally https://github.com/webpack-contrib/compression-webpack-plugin#using-brotli from nodejs 11.7.0
// const BrotliPlugin = require('brotli-webpack-plugin');
// const zopfli = require('@gfx/zopfli');

// const productionGzipExtensions = ['js', 'css'];

const plugins = [];

// if (process.env.NODE_ENV === 'production') {
//   const compressionTest = /\.(js|css|json|txt|html|ico|svg)(\?.*)?$/i;
//   plugins = [
//     new CompressionPlugin({
//       algorithm(input, compressionOptions, callback) {
//         return zopfli.gzip(input, compressionOptions, callback);
//       },
//       compressionOptions: {
//         numiterations: 15,
//       },
//       minRatio: 0.99,
//       test: compressionTest,
//     }),
//     new BrotliPlugin({
//       test: compressionTest,
//       minRatio: 0.99,
//     }),
//   ];
// }

module.exports = {
  chainWebpack: (config) => {
    config
      .entry('app')
      .clear()
      .add('./ZelFront/src/main.js')
      .end();
    config.resolve.alias
      .set('@', path.join(__dirname, './ZelFront/src'));
    config.plugin('CompressionPlugin').use(CompressionPlugin);
  },
  outputDir: path.join(__dirname, './ZelFront/dist'),
  pages: {
    index: {
      // entry for the page
      entry: 'ZelFront/src/main.js',
      // the source template
      template: 'ZelFront/public/index.html',
      // output as dist/index.html
      filename: 'index.html',
    },
  },
  configureWebpack: {
    plugins,
  },
};
