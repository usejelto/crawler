// ESLint for the package source, its tests and the packaging script. `make lint`
// runs it; `tsc` (`npm run check`) owns type errors, so this config adds the
// recommended JavaScript and TypeScript rules on top.
import js from '@eslint/js'
import globals from 'globals'
import ts from 'typescript-eslint'

export default ts.config(
  // Build output, release staging and vendored snapshots (their producers lint them).
  { ignores: ['dist/', 'vendor/', 'release-artifacts/'] },
  js.configs.recommended,
  ts.configs.recommended,
  {
    // Node scripts and configuration that run at build or package time, and
    // the opengrep rule test cases, written as Node modules.
    files: ['scripts/**', '.opengrep/**', '*.config.js', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
