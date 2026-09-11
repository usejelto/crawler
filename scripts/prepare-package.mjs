import { copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const require = createRequire(import.meta.url)
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  cwd: fileURLToPath(root), stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// Ship the canonical guide in the tarball without maintaining a second copy.
copyFileSync(new URL('vendor/guide/crawler.md', root), new URL('GUIDE.md', root))
