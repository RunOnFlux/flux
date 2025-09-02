module.exports = {
  // Align with ESLint max-len rule (120 characters)
  printWidth: 120,

  // Use single quotes to match ESLint rules
  singleQuote: true,

  // Add trailing commas where valid (ES5)
  trailingComma: 'es5',

  // Use semicolons
  semi: true,

  // 2 space indentation
  tabWidth: 2,
  useTabs: false,

  // Quote object properties only when necessary
  quoteProps: 'as-needed',

  // Use single quotes in JSX
  jsxSingleQuote: true,

  // Put closing bracket on new line for multi-line JSX
  bracketSameLine: false,

  // Always include parens around arrow function args
  arrowParens: 'always',

  // Unix line endings
  endOfLine: 'lf',

  // Format embedded code in Vue SFC
  embeddedLanguageFormatting: 'auto',

  // Override settings for specific file types
  overrides: [
    {
      files: ['*.vue'],
      options: {
        // Vue files can have slightly longer lines for template readability
        printWidth: 140,
      },
    },
    {
      files: ['*.json', '*.jsonc'],
      options: {
        // JSON files are often config files, keep them readable
        printWidth: 120,
      },
    },
  ],
};
