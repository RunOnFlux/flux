module.exports = {
  env: {
    mocha: true,
  },
  rules: {
    'max-len': [
      'error',
      {
        code: 120,
        ignoreStrings: true,
        ignoreTrailingComments: true,
      },
    ],
    'no-unused-expressions': 'off',
  },
};
