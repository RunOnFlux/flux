module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: ['plugin:vue/recommended', '@vue/airbnb'],
  parserOptions: {
    parser: 'babel-eslint',
  },
  rules: {
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-console': 'off',

    semi: ['error', 'never'],
    "import/no-extraneous-dependencies": ["error", {"devDependencies": true, "optionalDependencies": true, "peerDependencies": false, "packageDir": __dirname}],
    'max-len': 'off',
    'linebreak-style': 'off',
    camelcase: ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true }],
    'arrow-parens': ['error', 'as-needed'],
    'vue/multiline-html-element-content-newline': 'off',
    "prefer-destructuring": ["error", {"object": true, "array": false}],
  },
}
