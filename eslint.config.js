const path = require('path');
const globals = require('globals');
const vue = require('eslint-plugin-vue');
const js = require('@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  {
    ignores: [
      'HomeUI/dist/',
      'config/userconfig.js',
      'lib/daemonrpc/',
      'tests/e2e/',
      'ZelApps/',
      'docs/',
      'dev/',
    ],
  },
  ...compat.extends(
    'plugin:vue/recommended', 
    '@vue/eslint-config-airbnb',
    'prettier'
  ),
  {
    languageOptions: {
      globals: {
        ...globals.es2020,
        ...globals.commonjs,
        ...globals.node,
        ...globals.mocha,
        userconfig: true,
      },
      parser: require('vue-eslint-parser'),
      parserOptions: {
        parser: '@babel/eslint-parser',
        requireConfigFile: false,
      },
    },
    plugins: {
      vue,
    },
    rules: {
      'max-len': [
        'error',
        {
          code: 120,
          ignoreUrls: true,
          ignoreTrailingComments: true,
        },
      ],
      'vue/max-len': [
        'error',
        {
          code: 120,
          ignoreUrls: true,
          ignoreTrailingComments: true,
        },
      ],
      'no-console': 'off',
      'vue/no-use-v-if-with-v-for': 'off',
      'linebreak-style': ['error', 'unix'],
      'prefer-destructuring': ['error', { object: true, array: false }],
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
          optionalDependencies: true,
          peerDependencies: false,
        },
      ],
      camelcase: [
        'error',
        { properties: 'never', ignoreDestructuring: true, ignoreImports: true },
      ],
      'import/extensions': [
        'error',
        'ignorePackages',
        { vue: 'always', js: 'never' },
      ],
      'import/order': 'off',
      'vue/multi-word-component-names': 'off',
      complexity: [
        'warn',
        {
          max: 25, // Gradual improvement threshold - currently 103 violations would become ~30
        },
      ],
      'vuejs-accessibility/label-has-for': 'off',
      'vuejs-accessibility/click-events-have-key-events': 'off',
      'vuejs-accessibility/heading-has-content': 'off',
      'vuejs-accessibility/anchor-has-content': 'off',
      'vuejs-accessibility/form-control-has-label': 'off',
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.vue'],
        },
        alias: {
          map: [
            ['@', path.resolve(__dirname, './HomeUI/src')],
            ['@themeConfig', path.resolve(__dirname, './HomeUI/themeConfig.js')],
            ['@core', path.resolve(__dirname, './HomeUI/src/@core')],
            [
              '@validations',
              path.resolve(__dirname, './HomeUI/src/@core/utils/validations/validations.js'),
            ],
            ['@axios', path.resolve(__dirname, './HomeUI/src/libs/axios')],
            ['ZelBack', path.resolve(__dirname, './ZelBack')],
            ['Config', path.resolve(__dirname, './config')],
          ],
          extensions: ['.js', '.jsx', '.vue'],
        },
      },
    },
  },
  {
    files: ['**/__tests__/*.{j,t}s?(x)'],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
  {
    files: ['*.html'],
    rules: {
      'vue/comment-directive': 'off',
    },
  },
];