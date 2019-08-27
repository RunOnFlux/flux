const path = require('path');

module.exports = {
  chainWebpack: (config) => {
    config
      .entry('app')
      .clear()
      .add('./ZelFront/src/main.js')
      .end();
    config.resolve.alias
      .set('@', path.join(__dirname, './ZelFront/src'));
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
};
