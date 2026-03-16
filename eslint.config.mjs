import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { configs, plugins, rules } from 'eslint-config-airbnb-extended';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default [
  // Ignore .gitignore patterns + additional project ignores
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      'CloudUI/**',
      'config/userconfig.js',
      'ZelApps/**',
    ],
  },

  // ESLint recommended
  js.configs.recommended,

  // Airbnb base (stylistic + import-x)
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,
  rules.base.importsStrict,

  // Node.js specific
  plugins.node,
  ...configs.node.recommended,

  // Prettier (must be last to override formatting rules)
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'warn',
    },
  },

  // Project-wide settings
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      parserOptions: {
        ecmaVersion: 'latest',
      },
      globals: {
        ...globals.node,
        ...globals.mocha,
        userconfig: 'readonly',
        BigInt: 'readonly',
      },
    },
    rules: {
      // Line length
      'max-len': ['error', {
        code: 110,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreTrailingComments: true,
      }],

      // Complexity monitoring
      complexity: ['warn', 25],

      // Console is expected in a Node.js backend
      'no-console': 'off',

      // Destructuring
      'prefer-destructuring': ['error', { object: true, array: false }],

      // Camelcase
      camelcase: ['error', {
        properties: 'never',
        ignoreDestructuring: true,
        ignoreImports: true,
      }],

      // Allow underscore-prefixed unused vars (common pattern in this codebase)
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Relax some airbnb rules for this codebase
      'no-restricted-syntax': ['error',
        { selector: 'ForInStatement', message: 'Use Object.keys/values/entries instead of for...in to avoid prototype chain iteration.' },
        { selector: 'WithStatement', message: 'with is not allowed — it makes scope ambiguous.' },
      ],
      'no-continue': 'off',
      'no-await-in-loop': 'warn',
      'no-plusplus': 'off',
      'no-param-reassign': ['error', { props: false }],
      'no-use-before-define': ['error', { functions: false }],
      'consistent-return': 'off',

      // Import rules
      'import-x/extensions': 'off',
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
      }],
      'import-x/no-extraneous-dependencies': ['error', {
        devDependencies: ['tests/**', '**/*.test.js', '**/*.spec.js'],
      }],

      // Node.js specific relaxations
    },
  },

  // Test file overrides
  {
    files: ['tests/**/*.js'],
    rules: {
      'no-unused-expressions': 'off',
      'max-len': 'off',
      complexity: 'off',
    },
  },
];
