#!/usr/bin/env node
// Assembles the hub, the frontend build and the relay (with its own Wrangler) into build/app-hub,
// ready for electron-builder to put inside the app. One architecture at a time, because each
// architecture needs its own copy of Wrangler's workerd binary (about 135 MB unpacked).
//
//   node scripts/stage.mjs --arch arm64     (or --arch x64)
//
// Run after `npm run build` at the repository root, which builds frontend/dist.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..')
const repo = join(desktop, '..')
const { values } = parseArgs({ options: { arch: { type: 'string' } } })
const arch = values.arch
if (arch !== 'arm64' && arch !== 'x64') {
  console.error('Usage: node scripts/stage.mjs --arch arm64|x64')
  process.exit(2)
}
const npmArch = arch === 'x64' ? 'x64' : 'arm64'

const out = join(desktop, 'build', 'app-hub')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// The version the hub reports comes from the root package.
const rootPackage = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'yggltree', version: rootPackage.version, private: true }, null, 2))

// The hub: its source, and its runtime dependencies installed for this architecture.
await cp(join(repo, 'hub', 'src'), join(out, 'hub', 'src'), { recursive: true })
await cp(join(repo, 'hub', 'package.json'), join(out, 'hub', 'package.json'))
// The hub imports a few frontend modules (backup format, sync protocol), so the frontend source comes too.
await cp(join(repo, 'frontend', 'src'), join(out, 'frontend', 'src'), { recursive: true })
await cp(join(repo, 'frontend', 'dist'), join(out, 'frontend', 'dist'), { recursive: true })
execFileSync('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', `--cpu=${npmArch}`, '--os=darwin'], {
  cwd: join(out, 'hub'),
  stdio: 'inherit',
})

// The relay: prebuilt static files, its source, and Wrangler with the workerd binary for this architecture.
await mkdir(join(out, 'relay'), { recursive: true })
for (const entry of ['src', 'public', 'wrangler.jsonc', 'package.json']) {
  await cp(join(repo, 'relay', entry), join(out, 'relay', entry), { recursive: true })
}
execFileSync('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund', `--cpu=${npmArch}`, '--os=darwin'], {
  cwd: join(out, 'relay'),
  stdio: 'inherit',
})

// Trim what the deploy never uses: the image libraries Wrangler doesn't load, and the debug symbols
// in workerd (about 135 MB to 89 MB, and it still runs).
const modules = join(out, 'relay', 'node_modules')
await rm(join(modules, 'sharp'), { recursive: true, force: true })
await rm(join(modules, '@img'), { recursive: true, force: true })
execFileSync('strip', ['-x', join(modules, '@cloudflare', `workerd-darwin-${npmArch === 'x64' ? '64' : 'arm64'}`, 'bin', 'workerd')])

console.log(`Staged the app's hub and relay for ${arch} in ${out}`)
