const path = require('path');
const globals = require('globals');
const importPlugin = require('eslint-plugin-import');
const babelParser = require('@babel/eslint-parser');
const vue = require('eslint-plugin-vue');
const vueParser = require('vue-eslint-parser');

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
  // JavaScript files configuration ONLY (no Vue files)
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.es2020,
        ...globals.commonjs,
        ...globals.node,
        ...globals.mocha,
        userconfig: true,
      },
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
      },
    },
    plugins: {
      import: importPlugin,
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
      'no-console': 'off',
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
        { js: 'never' },
      ],
      'import/order': 'off',
      complexity: [
        'warn',
        {
          max: 25,
        },
      ],
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
  // Vue files ONLY - completely separate configuration
  {
    files: ['**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.es2020,
        ...globals.commonjs,
        ...globals.node,
        ...globals.mocha,
        userconfig: true,
      },
      parser: vueParser,
      parserOptions: {
        parser: babelParser,
        requireConfigFile: false,
      },
    },
    plugins: {
      vue,
      import: importPlugin,
    },
    rules: {
      // Vue recommended rules
      ...vue.configs.recommended.rules,

      // 140 character limit for Vue files
      'max-len': [
        'error',
        {
          code: 140,
          ignoreUrls: true,
          ignoreTrailingComments: true,
        },
      ],
      'vue/max-len': [
        'error',
        {
          code: 140,
          ignoreUrls: true,
          ignoreTrailingComments: true,
        },
      ],

      // Vue-specific overrides
      'vue/no-use-v-if-with-v-for': 'off',
      'vue/multi-word-component-names': 'off',

      // General rules for Vue files
      'no-console': 'off',
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
      complexity: [
        'warn',
        {
          max: 25,
        },
      ],

      // Accessibility overrides for Vue
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
];