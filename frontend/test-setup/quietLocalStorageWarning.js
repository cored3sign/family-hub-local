// lib0 (y-protocols / y-websocket / y-indexeddb) probes
// globalThis.localStorage at import time; Node >= 25 answers that with an
// ExperimentalWarning ("localStorage is not available because
// --localstorage-file was not provided"). Drop exactly that warning --
// every other warning, experimental or not, still prints.
const original = process.emitWarning
process.emitWarning = function (warning, ...rest) {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (/localStorage is not available/.test(message ?? '')) return
  return original.call(this, warning, ...rest)
}
