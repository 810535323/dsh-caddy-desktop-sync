import Schema from '@deepseek-ai/schemastery'

function adminOrigin(value) {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Caddy admin must be a credential-free HTTP origin on 127.0.0.1')
  }
  return url.origin
}

function identifier(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Caddy server identifier')
  return value
}

function hostname(value) {
  const normalized = value.trim().toLowerCase()
  if (
    normalized &&
    (normalized.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized))
  ) {
    throw new Error('Hostname must be an exact hostname without scheme, port, or wildcard')
  }
  return normalized
}

export const Config = Schema.object({
  adminUrl: Schema.transform(Schema.string(), adminOrigin).default('http://127.0.0.1:2019'),
  server: Schema.transform(Schema.string(), identifier).default('srv0'),
  hostname: Schema.transform(Schema.string(), hostname).default(''),
  pollIntervalMs: Schema.number().step(1).min(100).max(3600000).default(2000),
  requestTimeoutMs: Schema.number().step(1).min(1).max(300000).default(3000),
  maxResponseBytes: Schema.number().step(1).min(1024).max(100000000).default(1000000),
  protectedPorts: Schema.array(Schema.number().step(1).min(1).max(65535)).default([])
})

export function parseConfig(input = {}) {
  const result = Config['~standard'].validate(input)
  if (result.issues)
    throw new Error(
      'Invalid Caddy sync configuration: ' + result.issues.map((issue) => issue.message).join('; ')
    )
  return result.value
}
