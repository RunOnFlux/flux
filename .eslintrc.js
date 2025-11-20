const path = require('path');

module.exports = {
  root: true,
  env: {
    // so we get BigInt etc
    es2020: true,
    commonjs: true,
    node: true,
    mocha: true,
  },
  globals: {
    userconfig: true,
  },
  extends: [
    'eslint:recommended',
  ],
  plugins: [],
  rules: {
    'max-len': [
      'error',
      {
        code: 300,
        ignoreUrls: true,
        ignoreTrailingComments: true,
      },
    ],
    'no-console': 'off',
    'linebreak-style': [
      'error',
      'unix',
    ],
    'prefer-destructuring': ['error', { object: true, array: false }],
    'import/no-extraneous-dependencies': ['error', {
      devDependencies: true, optionalDependencies: true, peerDependencies: false,
    }],
    camelcase: ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true }],
    'import/extensions': ['error', 'ignorePackages', { js: 'never' }],
    'import/order': 'off',
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: [
          '.js',
          '.jsx',
        ],
      },
      alias: {
        map: [
          ['ZelBack', path.resolve(__dirname, './ZelBack')],
          ['Config', path.resolve(__dirname, './config')],
        ],
        extensions: ['.js', '.jsx'],
      },
    },
  },
  overrides: [
    {
      files: [
        '**/__tests__/*.{j,t}s?(x)',
      ],
      env: {
        mocha: true,
      },
    },
  ],
};
