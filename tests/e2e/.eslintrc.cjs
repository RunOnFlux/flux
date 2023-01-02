module.exports = {
  plugins: [
    'cypress',
  ],
  env: {
    mocha: true,
    'cypress/globals': true,
  },
  rules: {
    // 'max-len': [
    //   'error',
    //   {
    //     code: 120,
    //     ignoreStrings: true,
    //     ignoreTrailingComments: true,
    //   },
    // ],
    strict: 'off',
  },
};
