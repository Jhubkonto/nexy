/* global require, process */
// Compatibility adapter for the npm bundled with Nexy's pinned Windows Node.
// Arborist's JavaScript realpath implementation lstats every ancestor, including
// C:\Users, even when the requested package/cache directory is already granted.
// Windows can resolve that same path through a handle without opening ancestors.
// Replace only npm's internal resolver; native realpath still follows junctions
// and symlinks and the AppContainer continues to enforce every filesystem ACL.
const { realpath } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')
const { createRequire } = require('node:module')

const npxCli = process.argv[2]
const npmRequire = createRequire(npxCli)
const resolver = join(dirname(npmRequire.resolve('@npmcli/arborist')), 'realpath.js')
// Fail during preparation if a future pinned npm changes this internal module.
if (typeof npmRequire(resolver) !== 'function') throw new Error('Unsupported managed npm realpath resolver')
npmRequire.cache[resolver].exports = async (path, realpathCache) => {
  const absolute = resolve(path)
  if (realpathCache.has(absolute)) return realpathCache.get(absolute)
  const canonical = await realpath(absolute)
  realpathCache.set(absolute, canonical)
  return canonical
}

// npx must see its original argv, including headers containing spaces.
process.argv.splice(1, 1)
npmRequire(npxCli)
