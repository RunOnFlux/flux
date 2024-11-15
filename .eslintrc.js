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
    'plugin:vue/recommended',
    '@vue/eslint-config-airbnb',
  ],
  plugins: [
    'vue',
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
    'vue/max-len': [
      'error',
      {
        code: 300,
        ignoreUrls: true,
        ignoreTrailingComments: true,
      },
    ],
    'no-console': 'off',
    'vue/no-use-v-if-with-v-for': 'off',
    'linebreak-style': [
      'error',
      'unix',
    ],
    'prefer-destructuring': ['error', { object: true, array: false }],
    'import/no-extraneous-dependencies': ['error', {
      devDependencies: true, optionalDependencies: true, peerDependencies: false,
    }],
    camelcase: ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true }],
    'import/extensions': ['error', 'ignorePackages', { vue: 'always', js: 'never' }],
    'import/order': 'off',
    'vue/multi-word-component-names': 'off',
    'vuejs-accessibility/label-has-for': 'off',
    'vuejs-accessibility/click-events-have-key-events': 'off',
    'vuejs-accessibility/heading-has-content': 'off',
    'vuejs-accessibility/anchor-has-content': 'off',
    'vuejs-accessibility/form-control-has-label': 'off',
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@babel/eslint-parser',
    requireConfigFile: false,
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
      alias: {
        map: [
          ['@', path.resolve(__dirname, './HomeUI/src')],
          ['@themeConfig', path.resolve(__dirname, './HomeUI/themeConfig.js')],
          ['@core', path.resolve(__dirname, './HomeUI/src/@core')],
          ['@validations', path.resolve(__dirname, './HomeUI/src/@core/utils/validations/validations.js')],
          ['@axios', path.resolve(__dirname, './HomeUI/src/libs/axios')],
          ['ZelBack', path.resolve(__dirname, './ZelBack')],
          ['Config', path.resolve(__dirname, './config')],
        ],
        extensions: ['.js', '.jsx', '.vue'],
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
    {
      files: ['*.html'],
      rules: {
        'vue/comment-directive': 'off',
      },
    },
  ],
};
