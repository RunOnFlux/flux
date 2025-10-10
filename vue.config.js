const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');
const { ProvidePlugin } = require('webpack');
// const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
// const CompressionPlugin = require('compression-webpack-plugin');
// ideally https://github.com/webpack-contrib/compression-webpack-plugin#using-brotli from nodejs 11.7.0
// const BrotliPlugin = require('brotli-webpack-plugin');
// const zopfli = require('@gfx/zopfli');

// const productionGzipExtensions = ['js', 'css'];

const plugins = [
  new CopyPlugin({
    patterns: [{ from: path.resolve(__dirname, 'HomeUI', 'public') }],
  }),
  new ProvidePlugin({
    Buffer: ['buffer', 'Buffer'],
  }),
  // new BundleAnalyzerPlugin(),
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

module.exports = {
  // this disables / enables linting when running homebuild
  // once the files have been formatted, we can reenable
  // lintOnSave: 'error',
  lintOnSave: false,
  css: {
    loaderOptions: {
      sass: {
        sassOptions: {
          includePaths: ['./node_modules', './HomeUI/src/assets'],
        },
      },
    },
  },
  configureWebpack: {
    mode: process.env.NODE_ENV,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './HomeUI/src/'),
        '@themeConfig': path.resolve(__dirname, './HomeUI/themeConfig.js'),
        '@core': path.resolve(__dirname, './HomeUI/src/@core'),
        '@validations': path.resolve(__dirname, './HomeUI/src/@core/utils/validations/validations.js'),
        '@axios': path.resolve(__dirname, './HomeUI/src/libs/axios'),
        ZelBack: path.resolve(__dirname, './ZelBack'),
        Config: path.resolve(__dirname, './config'),
      },
      fallback: {
        buffer: require.resolve('buffer/'),
        Buffer: require.resolve('buffer/'),
      },
    },
    plugins,
    externals(context, request, callback) {
      if (/xlsx|canvg|pdfmake/.test(request)) {
        return callback(null, `commonjs ${request}`);
      }
      return callback();
    },
    watchOptions: {
      ignored: /node_modules/,
    },
    optimization: {
      splitChunks: {
        cacheGroups: {
          vueAwesome: {
            name: 'vueAwesome',
            test: /[\\/]node_modules[\\/](vue-awesome)[\\/]/,
            chunks: 'all',
          },
          metamask: {
            name: 'metamask',
            test: /[\\/]node_modules[\\/](@metamask)[\\/]/,
            chunks: 'all',
          },
          walletconnect: {
            name: 'walletconnect',
            test: /[\\/]node_modules[\\/](@walletconnect)[\\/]/,
            chunks: 'all',
          },
          stablelib: {
            name: 'stablelib',
            test: /[\\/]node_modules[\\/](@stablelib)[\\/]/,
            chunks: 'all',
          },
          xterm: {
            name: 'xterm',
            test: /[\\/]node_modules[\\/](xterm)[\\/]/,
            chunks: 'all',
          },
          openpgp: {
            name: 'openpgp',
            test: /[\\/]node_modules[\\/](openpgp)[\\/]/,
            chunks: 'all',
          },
          apexcharts: {
            name: 'apexcharts',
            test: /[\\/]node_modules[\\/](apexcharts)[\\/]/,
            chunks: 'all',
          },
          vueFeatherIcons: {
            name: 'vueFeatherIcons',
            test: /[\\/]node_modules[\\/](vue-feather-icons)[\\/]/,
            chunks: 'all',
          },
          bootstrapVue: {
            name: 'bootstrapVue',
            test: /[\\/]node_modules[\\/](bootstrap-vue)[\\/]/,
            chunks: 'all',
          },
          leaflet: {
            name: 'leaflet',
            test: /[\\/]node_modules[\\/](leaflet)[\\/]/,
            chunks: 'all',
          },
          vue: {
            name: 'vue',
            test: /[\\/]node_modules[\\/](vue)[\\/]/,
            chunks: 'all',
          },
          vueAt: {
            name: 'vueAt',
            test: /[\\/]node_modules[\\/](@vue)[\\/]/,
            chunks: 'all',
          },
          vuex: {
            name: 'vuex',
            test: /[\\/]node_modules[\\/](vuex)[\\/]/,
            chunks: 'all',
          },
          vueRouterVendor: {
            name: 'vueRouter',
            test: /[\\/]node_modules[\\/](vue-router)[\\/]/,
            chunks: 'all',
          },
          clipboard: {
            name: 'clipboard',
            test: /[\\/]node_modules[\\/](clipboard)[\\/]/,
            chunks: 'all',
          },
          vueJsonViewer: {
            name: 'vueJsonViewer',
            test: /[\\/]node_modules[\\/](vue-json-viewer)[\\/]/,
            chunks: 'all',
          },
        },
      },
    },
  },
  chainWebpack: (config) => {
    config.module
      .rule('walletConnect')
      .test(/node_modules[\\/](@walletconnect|@wagmi|@web3modal|viem|abitype|unstorage)/)
      .use('babel-loader')
      .loader('babel-loader');
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
          'b-embed': 'src',
        };
        return options;
      });
  },
  transpileDependencies: ['resize-detector'],
  outputDir: path.join(__dirname, './HomeUI/dist'),
  pages: {
    index: {
      // entry for the page
      entry: 'HomeUI/src/main.js',
      // the source template
      template: 'HomeUI/src/index.html',
      // output as dist/index.html
      filename: 'index.html',
    },
  },
  filenameHashing: false,
  productionSourceMap: false,
};
