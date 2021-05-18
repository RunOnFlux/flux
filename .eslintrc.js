module.exports = {
  root: true,
  env: {
    commonjs: true,
    node: true,
    mocha: true,
  },
  extends: [
    'plugin:vue/essential',
    '@vue/airbnb',
  ],
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
    'import/extensions': [
      'error',
      'never',
    ],
    'linebreak-style': [
      'error',
      'unix',
    ],
  },
  parserOptions: {
    parser: 'babel-eslint',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: [
          '.js',
          '.jsx',
          '.vue',
        ],
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
