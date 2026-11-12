import http from 'node:http'
import { parseConfig } from './config.js'

export function selectDshUpstream(routes, hostname = '', protectedPorts = [2019]) {
  if (!Array.isArray(routes)) throw new Error('Caddy routes are unavailable')
  const candidates = []
  const wanted = hostname.toLowerCase()
  const visit = (rows, prefix, inheritedHosts = null) =>
    rows.forEach((route, i) => {
      const match = route.match ?? []
      if (!Array.isArray(match)) throw new Error('Invalid Caddy route matchers')
      // Unknown conditions are deliberately excluded: only unconditional/host-only roots qualify.
      if (match.some((matcher) => !matcher || Object.keys(matcher).some((key) => key !== 'host')))
        return
      if (
        match.some(
          (matcher) =>
            matcher.host &&
            (!Array.isArray(matcher.host) ||
              matcher.host.some((host) => typeof host !== 'string' || host.includes('*')))
        )
      )
        return
      const constrained = match.length > 0 && match.every((matcher) => matcher.host)
      const routeHosts = constrained
        ? new Set(match.flatMap((matcher) => matcher.host.map((host) => host.toLowerCase())))
        : null
      const effectiveHosts =
        routeHosts === null
          ? inheritedHosts
          : inheritedHosts === null
            ? routeHosts
            : new Set([...routeHosts].filter((host) => inheritedHosts.has(host)))
      if (wanted ? effectiveHosts !== null && !effectiveHosts.has(wanted) : effectiveHosts !== null)
        return
      const exclusive = wanted
        ? effectiveHosts?.size === 1 && effectiveHosts.has(wanted)
        : effectiveHosts === null
      route.handle?.forEach((handler, j) => {
        const path = `${prefix}/${i}/handle/${j}`
        if (handler.handler === 'subroute' && Array.isArray(handler.routes))
          visit(handler.routes, `${path}/routes`, effectiveHosts)
        if (handler.handler === 'reverse_proxy' && exclusive) {
          if (handler.upstreams?.length !== 1 || handler.dynamic_upstreams)
            throw new Error('Caddy root upstream is ambiguous')
          if (handler.transport?.protocol && handler.transport.protocol !== 'http')
            throw new Error('Caddy root proxy must use HTTP transport')
          candidates.push({ path: `${path}/upstreams/0/dial`, dial: handler.upstreams[0].dial })
        }
      })
    })
  visit(routes, '')
  if (candidates.length !== 1) throw new Error('Caddy root proxy is missing or ambiguous')
  const target = candidates[0]
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(target.dial)
  if (!match || Number(match[1]) > 65535)
    throw new Error('Caddy root target must be a valid loopback port')
  if (protectedPorts.includes(Number(match[1])))
    throw new Error('Caddy root points to a protected service; manual inspection required')
  return target
}

function adminRequest(config, method, pathname, value, etag, signal) {
  return new Promise((resolve, reject) => {
    const body = value === undefined ? undefined : JSON.stringify(value)
    const url = new URL(config.adminUrl)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: pathname,
        method,
        signal,
        headers: {
          ...(body
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : {}),
          ...(etag ? { 'if-match': etag } : {})
        }
      },
      (response) => {
        let text = '',
          bytes = 0
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk)
          if (bytes > config.maxResponseBytes) {
            reject(new Error('Caddy response too large'))
            response.destroy()
            req.destroy()
            return
          }
          text += chunk
        })
        response.on('error', reject)
        response.on('aborted', () => reject(new Error('Caddy response was interrupted')))
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              etag: response.headers.etag,
              value: text ? JSON.parse(text) : undefined
            })
          } catch {
            reject(new Error('Caddy returned an invalid response'))
          }
        })
      }
    )
    req.on('error', reject)
    const deadline = setTimeout(
      () => req.destroy(new Error('Caddy API timed out')),
      config.requestTimeoutMs
    )
    req.on('close', () => clearTimeout(deadline))
    req.end(body)
  })
}

export async function syncCaddyPort({ port, signal, ...input }) {
  const config = parseConfig(input)
  const protectedPorts = [...config.protectedPorts, Number(new URL(config.adminUrl).port || 80)]
  if (!Number.isInteger(port) || port < 1 || port > 65535 || protectedPorts.includes(port))
    throw new Error('Invalid DSH port')
  const scope = `/config/apps/http/servers/${config.server}/routes`
  const before = await adminRequest(config, 'GET', scope, undefined, undefined, signal)
  if (before.status !== 200 || !before.etag)
    throw new Error(`Cannot read Caddy routes with revision: HTTP ${before.status}`)
  const selected = selectDshUpstream(before.value, config.hostname, protectedPorts)
  const desired = `127.0.0.1:${port}`
  if (selected.dial === desired) return { changed: false, port }
  const resource = scope + selected.path
  const changed = await adminRequest(config, 'PATCH', resource, desired, before.etag, signal)
  if (changed.status !== 200)
    throw new Error(`Caddy conditional update refused: HTTP ${changed.status}`)
  const after = await adminRequest(config, 'GET', resource, undefined, undefined, signal)
  if (after.status !== 200 || after.value !== desired)
    throw new Error('Caddy DSH target readback mismatch')
  return { changed: true, port }
}
