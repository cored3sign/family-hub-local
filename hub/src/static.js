// Static file serving for the built frontend (frontend/dist), with SPA
// fallback:
//   - extensionless unknown paths serve index.html (client-side routes);
//   - no-cache on index.html, sw.js, version.json, manifest.json;
//   - immutable on /assets/* (Vite content-hashes those names);
//   - `..` (and anything else that escapes distDir) is rejected *after*
//     percent-decoding, with a 404.

import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_FRAMING = { 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' }

function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

// /assets/* is content-hashed by Vite, so it can be cached forever.
// Everything else -- index.html, sw.js, version.json, manifest.json and the
// unhashed icons/favicon -- must revalidate, so a rebuilt app is never
// shadowed by a stale copy.
function cacheControlFor(urlPath) {
  return urlPath.startsWith('/assets/') ? IMMUTABLE : 'no-cache'
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(res.req.method === 'HEAD' ? undefined : text)
}

// Decoded, validated URL path ('/calendar', '/assets/a.js'), or null for
// anything malformed or escaping the root.
export function safeDecodePath(rawUrl) {
  const q = rawUrl.indexOf('?')
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q)
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (!decoded.startsWith('/')) return null
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  if (decoded.split('/').some((seg) => seg === '..' || seg === '.')) return null
  return decoded
}

export function createStaticHandler({ distDir }) {
  const root = resolve(distDir)

  function insideRoot(path, base = root) {
    return path === base || path.startsWith(base + sep)
  }

  // A regular file whose *real* path (symlinks resolved) is inside the
  // real distDir, as { stat }, else null. Without the realpath check a
  // symlink in dist (or a symlinked directory) could serve any file the
  // hub process can read.
  async function servable(path) {
    try {
      const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)])
      if (!insideRoot(realFile, realRoot) || realFile === realRoot) return null
      const s = await stat(realFile)
      return s.isFile() ? s : null
    } catch {
      return null
    }
  }

  async function serveFile(req, res, filePath, urlPath, s) {
    const type = contentTypeFor(filePath)
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': s.size,
      'Cache-Control': cacheControlFor(urlPath),
      'X-Content-Type-Options': 'nosniff',
      // The app is never framed (clickjacking of the admin pages).
      ...(type.startsWith('text/html') ? NO_FRAMING : {}),
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  return async function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
      return
    }
    const urlPath = safeDecodePath(req.url)
    if (urlPath === null) {
      sendText(res, 404, 'Not Found')
      return
    }

    const wantsIndex = urlPath === '/' || urlPath === '/index.html'
    if (!wantsIndex) {
      const filePath = resolve(join(root, urlPath))
      if (!insideRoot(filePath) || filePath === root) {
        sendText(res, 404, 'Not Found')
        return
      }
      const s = await servable(filePath)
      if (s) {
        await serveFile(req, res, filePath, urlPath, s)
        return
      }
      // Only extensionless paths are client-side routes; a missing
      // /assets/x.js or /logo.png is a real 404, never the SPA shell.
      const lastSegment = urlPath.slice(urlPath.lastIndexOf('/') + 1)
      if (extname(lastSegment) !== '' || urlPath.startsWith('/assets/')) {
        sendText(res, 404, 'Not Found')
        return
      }
    }

    const indexPath = join(root, 'index.html')
    const s = await servable(indexPath)
    if (!s) {
      sendText(res, 503, 'Yggltree has not been built yet. Run `npm run build` (or `npm start`), then reload.')
      return
    }
    await serveFile(req, res, indexPath, '/index.html', s)
  }
}
