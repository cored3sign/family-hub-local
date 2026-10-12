// The dev desktop reaches the hub through Vite's proxy, which connects from
// 127.0.0.1. The hub's admin guard only stays correct if the proxy keeps
// the browser's own Host (changeOrigin: false) and adds no X-Forwarded-*
// headers (xfwd: false).
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import config, { markRemoteClients } from '../../vite.config.js'

describe('vite dev proxy', () => {
  it('sends /api and /sync to the local hub without forwarding headers', () => {
    const proxy = config.server.proxy
    expect(proxy['/api']).toMatchObject({ target: 'http://localhost:8787', xfwd: false, changeOrigin: false })
    expect(proxy['/sync']).toMatchObject({ target: 'ws://localhost:8787', ws: true, xfwd: false, changeOrigin: false })
  })
})

describe('markRemoteClients', () => {
  function run(event, remoteAddress) {
    const proxy = new EventEmitter()
    markRemoteClients(proxy)
    const headers = {}
    const proxyReq = { setHeader: (k, v) => (headers[k] = v) }
    proxy.emit(event, proxyReq, { socket: { remoteAddress } })
    return headers
  }

  it('tags requests from other machines (http and ws upgrade) so the hub refuses admin', () => {
    expect(run('proxyReq', '192.0.2.30')).toEqual({ 'x-forwarded-for': '192.0.2.30' })
    expect(run('proxyReqWs', '192.0.2.30')).toEqual({ 'x-forwarded-for': '192.0.2.30' })
    expect(run('proxyReq', undefined)).toEqual({ 'x-forwarded-for': 'unknown' })
  })

  it('leaves the desktop\'s own loopback browser untagged', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(run('proxyReq', a)).toEqual({})
      expect(run('proxyReqWs', a)).toEqual({})
    }
  })

  it('is wired into both proxies', () => {
    expect(config.server.proxy['/api'].configure).toBe(markRemoteClients)
    expect(config.server.proxy['/sync'].configure).toBe(markRemoteClients)
  })
})
