import { syncCaddyPort } from './caddy-sync.js'
import { parseConfig } from './config.js'

export { Config } from './config.js'

export const name = 'dsh-caddy-desktop-sync'
export const inject = ['webServer']

export function apply(ctx, input) {
  const config = parseConfig(input)
  const abort = new AbortController()
  let pending = false,
    previousError = ''
  const sync = async () => {
    if (
      pending ||
      abort.signal.aborted ||
      !Number.isInteger(ctx.webServer.port) ||
      ctx.webServer.port < 1
    )
      return
    pending = true
    try {
      const result = await syncCaddyPort({
        ...config,
        port: ctx.webServer.port,
        signal: abort.signal
      })
      previousError = ''
      if (result.changed) ctx.logger.info(`Caddy DSH upstream updated to 127.0.0.1:${result.port}`)
    } catch (error) {
      if (!abort.signal.aborted && error.message !== previousError) {
        previousError = error.message
        ctx.logger.warn(`DSH remote proxy sync: ${error.message}`)
      }
    } finally {
      pending = false
    }
  }
  ctx.effect(() => {
    void sync()
    const timer = setInterval(() => {
      void sync()
    }, config.pollIntervalMs)
    timer.unref?.()
    return () => {
      abort.abort()
      clearInterval(timer)
    }
  })
}
