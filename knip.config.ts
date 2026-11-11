// Knip: files nothing imports, unused exports and dependencies, and
// dependencies used but not declared. `make deadcode` runs it. Tests count as
// users. Everything a tool loads without an import is named here, with why.
//
// Knip already reads every entry from package.json: `exports` (src/index.ts
// for the server runtimes, the src/browser.ts guard for `browser`, mapped back
// from dist/ through tsconfig.json), the `prepack` script and the test file
// the `node --test` scripts name, which imports the package by its own name.
// The entries' exports are the public API, so they are never reported unused.
import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // The opengrep rule test cases, which `opengrep test .opengrep` (make sast)
  // pairs with the rule of the same name instead of importing them.
  entry: ['.opengrep/*.{ts,mjs}'],
  // The Makefile runs Prettier (`make format-check`); Knip reads package.json
  // scripts, not the Makefile.
  ignoreDependencies: ['prettier'],
}

export default config
