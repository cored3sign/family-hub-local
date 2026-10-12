// Listening on 127.0.0.1 (see server.js): a plain listen that resolves once
// the server is up.

export function listen(server, { port, host }) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ port, host })
  })
}
