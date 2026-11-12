import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

function routes(port = 52858) {
  return [
    {
      match: [{ path: ['/gym/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8090' }] }]
    },
    { handle: [{ handler: 'encode', encodings: { gzip: {} } }] },
    {
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `127.0.0.1:${port}` }],
          headers: { request: { set: { 'X-Existing': ['keep'] } } }
        }
      ]
    }
  ]
}

test('only the root DSH proxy is selected; the gym proxy and unrelated settings are preserved', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  const config = routes()
  const before = structuredClone(config)
  assert.deepEqual(selectDshUpstream(config), {
    path: '/2/handle/0/upstreams/0/dial',
    dial: '127.0.0.1:52858'
  })
  assert.deepEqual(config, before)
  config.push({ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:9999' }] }] })
  assert.throws(() => selectDshUpstream(config), /ambiguous/)
})

test('a non-loopback root upstream cannot be rewritten', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  const config = routes()
  config[2].handle[0].upstreams[0].dial = 'another-host:8080'
  assert.throws(() => selectDshUpstream(config), /loopback/)
})

async function admin(
  t,
  { port = 52858, rejectPatch = false, noEtag = false, staleReadback = false } = {}
) {
  const config = routes(port),
    calls = []
  const state = { rejectPatch }
  const scope = '/config/apps/http/servers/srv0/routes'
  const server = http.createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url, fence: req.headers['if-match'] })
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === scope) {
      if (!noEtag) res.setHeader('etag', '"routes-before"')
      res.end(JSON.stringify(config))
      return
    }
    if (req.url !== scope + '/2/handle/0/upstreams/0/dial') {
      res.statusCode = 404
      res.end('{}')
      return
    }
    if (req.method === 'PATCH') {
      assert.equal(req.headers['if-match'], '"routes-before"')
      if (state.rejectPatch) {
        res.statusCode = 412
        res.end('{}')
        return
      }
      let body = ''
      for await (const chunk of req) body += chunk
      config[2].handle[0].upstreams[0].dial = JSON.parse(body)
      res.end()
      return
    }
    res.end(
      JSON.stringify(staleReadback ? '127.0.0.1:11111' : config[2].handle[0].upstreams[0].dial)
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { adminUrl: `http://127.0.0.1:${server.address().port}`, config, calls, state }
}

test('the current DSH port is conditionally patched and read back through the Caddy API', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  const f = await admin(t)
  const before = structuredClone(f.config)
  const result = await syncCaddyPort({ port: 61022, adminUrl: f.adminUrl })
  assert.equal(result.changed, true)
  assert.equal(f.config[2].handle[0].upstreams[0].dial, '127.0.0.1:61022')
  before[2].handle[0].upstreams[0].dial = '127.0.0.1:61022'
  assert.deepEqual(f.config, before)
})

test('an unchanged target does not write Caddy configuration', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  const f = await admin(t, { port: 61022 })
  assert.equal((await syncCaddyPort({ port: 61022, adminUrl: f.adminUrl })).changed, false)
  assert.equal(
    f.calls.some((call) => call.method === 'PATCH'),
    false
  )
})

test('concurrent configuration edits refuse the update without overwriting routes', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  const f = await admin(t, { rejectPatch: true })
  await assert.rejects(syncCaddyPort({ port: 61022, adminUrl: f.adminUrl }), /412/)
  assert.equal(f.config[2].handle[0].upstreams[0].dial, '127.0.0.1:52858')
})

test('an explicit hostname selects its nested root while preserving other domains and path routes', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  const config = [
    {
      match: [{ host: ['other.example'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8080' }] }]
    },
    { match: [{ host: ['chat.example'] }], handle: [{ handler: 'subroute', routes: routes() }] }
  ]
  assert.deepEqual(selectDshUpstream(config, 'chat.example'), {
    path: '/1/handle/0/routes/2/handle/0/upstreams/0/dial',
    dial: '127.0.0.1:52858'
  })
})

test('a missing hostname never guesses a host-scoped proxy', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  const config = [
    {
      match: [{ host: ['chat.example'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8080' }] }]
    }
  ]
  assert.throws(() => selectDshUpstream(config), /missing|hostname/)
})

test('an explicit hostname never rewrites a shared-host or unrelated fallback proxy', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  for (const hosts of [
    ['chat.example', 'other.example'],
    ['chat.example', '*.example']
  ]) {
    const config = [
      {
        match: [{ host: hosts }],
        handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8080' }] }]
      }
    ]
    assert.throws(() => selectDshUpstream(config, 'chat.example'), /missing/)
  }
  const config = [
    {
      match: [{ host: ['chat.example'], path: ['/api/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8081' }] }]
    },
    { handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8082' }] }] }
  ]
  assert.throws(() => selectDshUpstream(config, 'chat.example'), /missing/)
})

test('a nested exclusive host matcher can narrow a shared parent', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  const config = [
    {
      match: [{ host: ['chat.example', 'other.example'] }],
      handle: [
        {
          handler: 'subroute',
          routes: [
            {
              match: [{ host: ['chat.example'] }],
              handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8080' }] }]
            }
          ]
        }
      ]
    }
  ]
  assert.deepEqual(selectDshUpstream(config, 'chat.example'), {
    path: '/0/handle/0/routes/0/handle/0/upstreams/0/dial',
    dial: '127.0.0.1:8080'
  })
})

test('conditional and path-constrained routes cannot be mistaken for the DSH root', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  for (const match of [
    [{ header: { 'X-App': ['other'] } }],
    [{ host: ['chat.example'], path: ['/private/*'] }]
  ]) {
    const config = [
      { match, handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:8080' }] }] }
    ]
    assert.throws(() => selectDshUpstream(config, 'chat.example'), /missing/)
  }
})

test('deployment-specific protected ports are refused', async () => {
  const { selectDshUpstream } = await import('../caddy-sync.js')
  assert.throws(() => selectDshUpstream(routes(8088), '', [8088]), /protected|reserved/)
})

test('configuration is schema-validated and carries generic deployment defaults', async () => {
  const { Config } = await import('../index.js')
  assert.ok(Config?.['~standard'], 'plugin must export the DSH Standard Schema configuration')
  const result = Config['~standard'].validate({ hostname: 'CHAT.EXAMPLE' })
  assert.equal(result.value.hostname, 'chat.example')
  assert.equal(result.value.server, 'srv0')
  assert.equal(result.value.pollIntervalMs, 2000)
  for (const invalid of [
    { adminUrl: 'https://remote.example' },
    { adminUrl: 'http://127.0.0.1:2019?x=1' },
    { server: '../srv0' },
    { hostname: '*.example' },
    { pollIntervalMs: 0 },
    { requestTimeoutMs: -1 }
  ]) {
    const { parseConfig } = await import('../config.js')
    assert.throws(() => parseConfig(invalid), undefined, JSON.stringify(invalid))
  }
})

test('missing revision prevents all writes and a failed readback is reported', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  const missing = await admin(t, { noEtag: true })
  await assert.rejects(syncCaddyPort({ port: 61022, adminUrl: missing.adminUrl }), /revision/)
  assert.equal(missing.calls.length, 1)
  const stale = await admin(t, { staleReadback: true })
  await assert.rejects(syncCaddyPort({ port: 61022, adminUrl: stale.adminUrl }), /readback/)
})

test('invalid upstreams and the configured admin port never become proxy targets', async (t) => {
  const { syncCaddyPort, selectDshUpstream } = await import('../caddy-sync.js')
  for (const dial of ['127.0.0.1:65536', '127.0.0.1:0', 'https://remote.example:443']) {
    const config = routes()
    config[2].handle[0].upstreams[0].dial = dial
    assert.throws(() => selectDshUpstream(config), /loopback/)
  }
  const fixture = await admin(t)
  await assert.rejects(
    syncCaddyPort({ port: Number(new URL(fixture.adminUrl).port), adminUrl: fixture.adminUrl }),
    /Invalid DSH port/
  )
  assert.equal(fixture.calls.length, 0)
})

async function rawAdmin(t, handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('malformed and oversized responses fail without changing the proxy', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  for (const body of ['not json', 'x'.repeat(2048)]) {
    const adminUrl = await rawAdmin(t, (_req, res) => res.end(body))
    await assert.rejects(
      syncCaddyPort({ port: 61022, adminUrl, maxResponseBytes: 1024 }),
      /invalid response|too large/
    )
  }
})

test('requests have a deadline and can be aborted during plugin shutdown', async (t) => {
  const { syncCaddyPort } = await import('../caddy-sync.js')
  const adminUrl = await rawAdmin(t, () => {})
  await assert.rejects(syncCaddyPort({ port: 61022, adminUrl, requestTimeoutMs: 30 }), /timed out/)
  const abort = new AbortController()
  const request = syncCaddyPort({ port: 61022, adminUrl, signal: abort.signal })
  abort.abort()
  await assert.rejects(request, { name: 'AbortError' })
})

test('the Cordis plugin retries, follows a changed host port, and stops polling on disposal', async (t) => {
  const { Context } = await import('@deepseek-ai/cordis')
  const plugin = await import('../index.js')
  const { setTimeout: delay } = await import('node:timers/promises')
  const fixture = await admin(t, { rejectPatch: true })
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const service = { port: 61022 }
  ctx.provide('webServer', service)
  const warnings = []
  ctx.logger.exporter({ export: (record) => warnings.push(record) })
  await ctx.plugin(plugin, { adminUrl: fixture.adminUrl, pollIntervalMs: 100 })
  async function waitFor(predicate) {
    for (let i = 0; i < 100 && !predicate(); i++) await delay(10)
    assert.ok(predicate(), 'expected plugin state within one second')
  }
  await waitFor(() => fixture.calls.some((call) => call.method === 'PATCH'))
  fixture.state.rejectPatch = false
  await waitFor(() => fixture.config[2].handle[0].upstreams[0].dial === '127.0.0.1:61022')
  service.port = 61023
  await waitFor(() => fixture.config[2].handle[0].upstreams[0].dial === '127.0.0.1:61023')
  await ctx.fiber.dispose()
  await delay(30)
  const count = fixture.calls.length
  await delay(220)
  assert.equal(fixture.calls.length, count)
  assert.ok(warnings.length > 0)
})
