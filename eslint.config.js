const path = require('path');
const globals = require('globals');
const { includeIgnoreFile } = require('@eslint/compat');
const js = require('@eslint/js');
const { configs, plugins, rules } = require('eslint-config-airbnb-extended');
const { rules: prettierConfigRules } = require('eslint-config-prettier');
const prettierPlugin = require('eslint-plugin-prettier');
const babelParser = require('@babel/eslint-parser');
const vue = require('eslint-plugin-vue');
const vueParser = require('vue-eslint-parser');

const gitignorePath = path.resolve('.', '.gitignore');

const jsConfig = [
  // ESLint Recommended Rules
  {
    name: 'js/config',
    ...js.configs.recommended,
  },
  // Stylistic Plugin
  plugins.stylistic,
  // Import X Plugin
  plugins.importX,
  // Airbnb Base Recommended Config
  ...configs.base.recommended,
  // Strict Import Config
  rules.base.importsStrict,
];

const nodeConfig = [
  // Node Plugin
  plugins.node,
  // Airbnb Node Recommended Config
  ...configs.node.recommended,
];

const prettierConfig = [
  // Prettier Plugin
  {
    name: 'prettier/plugin/config',
    plugins: {
      prettier: prettierPlugin,
    },
  },
  // Prettier Config
  {
    name: 'prettier/config',
    rules: {
      ...prettierConfigRules,
      'prettier/prettier': 'error',
    },
  },
];

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
  // Include .gitignore patterns
  includeIgnoreFile(gitignorePath),
  // JavaScript Config
  ...jsConfig,
  // Node Config
  ...nodeConfig,
  // Prettier Config
  ...prettierConfig,
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
        ecmaVersion: 2022,
        sourceType: 'module',
      },
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
      'import-x/no-extraneous-dependencies': [
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
      'import-x/extensions': [
        'error',
        'ignorePackages',
        { js: 'never' },
      ],
      'import-x/order': 'off',
      complexity: [
        'warn',
        {
          max: 25,
        },
      ],
    },
    settings: {
      'import-x/resolver': {
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
        ...globals.browser,
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
      'import-x': plugins.importX.plugins['import-x'],
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
      'import-x/no-extraneous-dependencies': [
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
      'import-x/extensions': [
        'error',
        'ignorePackages',
        { vue: 'always', js: 'never' },
      ],
      'import-x/order': 'off',
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
      'import-x/resolver': {
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