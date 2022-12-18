import { resolve as _resolve, join } from 'path';
import CopyPlugin from 'copy-webpack-plugin';
// const CompressionPlugin = require('compression-webpack-plugin');
// ideally https://github.com/webpack-contrib/compression-webpack-plugin#using-brotli from nodejs 11.7.0
// const BrotliPlugin = require('brotli-webpack-plugin');
// const zopfli = require('@gfx/zopfli');

// const productionGzipExtensions = ['js', 'css'];

const plugins = [
  new CopyPlugin({
    patterns: [
      { from: _resolve(__dirname, 'HomeUI', 'public') },
    ],
  }),
];

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

export const css = {
  loaderOptions: {
    sass: {
      sassOptions: {
        includePaths: ['./node_modules', './HomeUI/src/assets']
      }
    }
  }
};
export const configureWebpack = {
  resolve: {
    alias: {
      '@': _resolve(__dirname, './HomeUI/src/'),
      '@themeConfig': _resolve(__dirname, './HomeUI/themeConfig.js'),
      '@core': _resolve(__dirname, './HomeUI/src/@core'),
      '@validations': _resolve(__dirname, './HomeUI/src/@core/utils/validations/validations.js'),
      '@axios': _resolve(__dirname, './HomeUI/src/libs/axios'),
      ZelBack: _resolve(__dirname, './ZelBack'),
      Config: _resolve(__dirname, './config')
    }
  },
  output: {
    libraryTarget: 'system',
  },
  plugins,
  externals(context, request, callback) {
    if (/xlsx|canvg|pdfmake/.test(request)) {
      return callback(null, `commonjs ${request}`);
    }
    return callback();
  },
  watchOptions: {
    ignored: /node_modules/
  }
};
export function chainWebpack(config) {
  config.module
    .rule('vue')
    .use('vue-loader')
    .loader('vue-loader')
    .tap((options) => {
      // eslint-disable-next-line no-param-reassign
      options.transformAssetUrls = {
        img: 'src',
        image: 'xlink:href',
        'b-avatar': 'src',
        'b-img': 'src',
        'b-img-lazy': ['src', 'blank-src'],
        'b-card': 'img-src',
        'b-card-img': 'src',
        'b-card-img-lazy': ['src', 'blank-src'],
        'b-carousel-slide': 'img-src',
        'b-embed': 'src'
      };
      return options;
    });
}
export const transpileDependencies = ['resize-detector'];
export const outputDir = join(__dirname, './HomeUI/dist');
export const pages = {
  index: {
    // entry for the page
    entry: 'HomeUI/src/main.js',
    // the source template
    template: 'HomeUI/public/index.html',
    // output as dist/index.html
    filename: 'index.html'
  }
};
export const filenameHashing = false;
export const productionSourceMap = false;
