module.exports = {
  root: true,
  env: {
    commonjs: true,
    es2022: true,
    mocha: true,
  },
  extends: [
    'plugin:vue/vue3-recommended',
  ],
  rules: {
    // 'max-len': [
    //   'error',
    //   {
    //     code: 120,
    //     ignoreStrings: true,
    //     ignoreTrailingComments: true,
    //   },
    // ],
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
    // 'import/extensions': ['error', 'ignorePackages', { vue: 'always', js: 'never' }],
    'vue/multi-word-component-names': ['error', {
      'ignores': [ 'Bookmarks', 'Debug', 'Help', 'Home', 'Locale', 'Logo', 'Navbar', 'Management', 'Marketplace', 'Transaction' , 'Explorer', 'Error404', 'Resources', 'Map', 'Overview', 'List', 'Economics', 'Start', 'Stop', 'Restart' ],
    }],
  },
  parserOptions: {
  },
  plugins: ["import"],
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
    {
      files: ['*.html'],
      rules: {
        'vue/comment-directive': 'off'
      }
    }
  ],
};
