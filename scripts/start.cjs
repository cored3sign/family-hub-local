#!/usr/bin/env node
// `npm start` -- one command (or a double-click on "Start Yggltree") for a
// family's desktop: check Node, install if needed, build the app if its
// sources changed, then run the home hub in the foreground.
//
//   npm start                      default port 8787, opens the browser
//   npm start -- --port 8788       any hub/src/cli.js flag passes through
//
// This file must stay parseable by old Node versions so the version message
// below can actually be printed: CommonJS, built-ins without the `node:`
// prefix, and no syntax newer than ~ES2017 (no `?.`, no `??`, no top-level
// await, no literal `import()` -- see runHub()).
'use strict'

var childProcess = require('child_process')
var crypto = require('crypto')
var fs = require('fs')
var path = require('path')
var url = require('url')

var MIN_MAJOR = 22
var MIN_MINOR = 12

var NODE_MESSAGE =
  'Yggltree needs Node.js 22.12 or newer. Download the LTS installer from https://nodejs.org, install it, then run npm start again.'

// Everything the frontend build reads. A change to any of these (path,
// size or mtime) triggers a rebuild on the next start.
var SOURCE_PATHS = [
  'frontend/src',
  'frontend/public',
  'frontend/index.html',
  'frontend/package.json',
  'frontend/vite.config.js',
]

var STAMP_FILE = 'frontend/dist/.source-stamp'

function isNodeSupported(version) {
  var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (!m) return false
  var major = Number(m[1])
  var minor = Number(m[2])
  return major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR)
}

// Collects [relativePath, size, mtimeMs] for every file under `rel`
// (a file or a directory). Missing paths contribute nothing.
function collectFiles(root, rel, out) {
  var abs = path.join(root, rel)
  var st
  try {
    st = fs.statSync(abs)
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  if (st.isDirectory()) {
    var names = fs.readdirSync(abs).sort()
    for (var i = 0; i < names.length; i++) collectFiles(root, rel + '/' + names[i], out)
  } else if (st.isFile()) {
    out.push(rel + '\0' + st.size + '\0' + st.mtimeMs)
  }
}

// sha1 over the path, size and mtime of every file in SOURCE_PATHS.
function sourceStamp(root) {
  var entries = []
  for (var i = 0; i < SOURCE_PATHS.length; i++) collectFiles(root, SOURCE_PATHS[i], entries)
  entries.sort()
  return crypto.createHash('sha1').update(entries.join('\n')).digest('hex')
}

function mtimeOrNull(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch (err) {
    return null
  }
}

// npm writes node_modules/.package-lock.json after every install, so it is
// missing on a fresh clone and older than package-lock.json after a
// `git pull` that changed dependencies.
function needsInstall(root) {
  var installed = mtimeOrNull(path.join(root, 'node_modules', '.package-lock.json'))
  if (installed === null) return true
  var lock = mtimeOrNull(path.join(root, 'package-lock.json'))
  return lock !== null && lock > installed
}

function readStamp(root) {
  try {
    return fs.readFileSync(path.join(root, STAMP_FILE), 'utf8').trim()
  } catch (err) {
    return null
  }
}

// Runs npm in the foreground; returns its exit code (1 if it could not run).
function npm(args, root) {
  var result = childProcess.spawnSync('npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
  })
  if (result.error) {
    console.error('Could not run npm: ' + result.error.message)
    return 1
  }
  return result.status === null ? 1 : result.status
}

// A literal `import()` would be a syntax error on very old Node, which would
// stop the version message from ever printing, so the expression is built
// at runtime instead.
function runHub(root, argv) {
  var dynamicImport = new Function('specifier', 'return import(specifier)')
  var cliUrl = url.pathToFileURL(path.join(root, 'hub', 'src', 'cli.js')).href
  return dynamicImport(cliUrl).then(function (cli) {
    return cli.main({ argv: argv })
  })
}

function start() {
  if (!isNodeSupported(process.versions.node)) {
    console.error(NODE_MESSAGE)
    process.exit(1)
    return
  }

  var root = path.resolve(__dirname, '..')

  if (needsInstall(root)) {
    console.log('First start: installing (a few minutes, needs internet)…')
    var installCode = npm(['ci'], root)
    if (installCode !== 0) {
      console.error('Installing failed (see above). Check the internet connection, then run npm start again.')
      process.exit(installCode)
      return
    }
  }

  var stamp = sourceStamp(root)
  if (stamp !== readStamp(root)) {
    console.log('Building the app…')
    // Drop the old stamp first: a build that fails part-way may leave dist
    // half-emptied, and the next start must not trust it.
    try {
      fs.unlinkSync(path.join(root, STAMP_FILE))
    } catch (err) {
      // not there yet
    }
    var buildCode = npm(['run', 'build', '-w', 'frontend'], root)
    if (buildCode !== 0) {
      console.error('Building the app failed (see above).')
      process.exit(buildCode)
      return
    }
    // Only after a successful build, so a failed one is retried next time.
    fs.writeFileSync(path.join(root, STAMP_FILE), stamp + '\n')
  }

  runHub(root, process.argv.slice(2)).then(
    function (code) {
      process.exit(code)
    },
    function (err) {
      console.error(err)
      process.exit(1)
    }
  )
}

module.exports = {
  NODE_MESSAGE: NODE_MESSAGE,
  SOURCE_PATHS: SOURCE_PATHS,
  isNodeSupported: isNodeSupported,
  sourceStamp: sourceStamp,
  needsInstall: needsInstall,
}

if (require.main === module) start()
