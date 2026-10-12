// Request-body reading with a hard size cap.
//
// The cap is enforced twice: up front from Content-Length (so an
// oversized upload is refused before a byte is buffered) and again while
// streaming (chunked bodies have no length, and a client can lie). Over
// the cap -> BodyError 413; malformed JSON -> BodyError 400.

export const JSON_BODY_LIMIT = 64 * 1024
export const RESTORE_BODY_LIMIT = 512 * 1024 * 1024

export class BodyError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function readBody(req, { limit }) {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > limit) {
    return Promise.reject(new BodyError(413, 'too-large'))
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
      fn(value)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        // Stop buffering; the caller answers 413 and closes the connection.
        req.pause()
        finish(reject, new BodyError(413, 'too-large'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish(resolve, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size))
    const onError = (err) => finish(reject, err)
    const onAborted = () => finish(reject, new BodyError(400, 'aborted'))
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
  })
}

// Bytes -> UTF-8 text. A body at the very top of the 512 MiB restore cap
// can exceed V8's maximum string length; that is reported as too large.
export function bodyText(buf) {
  try {
    return buf.toString('utf8')
  } catch {
    throw new BodyError(413, 'too-large')
  }
}

// -> parsed JSON, or undefined for an empty body.
export async function readJsonBody(req, { limit = JSON_BODY_LIMIT } = {}) {
  const buf = await readBody(req, { limit })
  if (buf.length === 0) return undefined
  try {
    return JSON.parse(bodyText(buf))
  } catch (err) {
    if (err instanceof BodyError) throw err
    throw new BodyError(400, 'bad-json')
  }
}
