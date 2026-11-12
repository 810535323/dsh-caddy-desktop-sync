# dsh-caddy-desktop-sync

A host-only DeepSeek Harness (DSH) bundle that keeps one existing Caddy reverse-proxy upstream aligned with DSH Desktop's current loopback web port. It addresses 502 errors after Desktop restarts with a different OS-assigned port.

[中文说明](#中文说明)

## Compatibility

- DSH: **0.2.1-rc.5** or **0.2.2-rc.1**. Other releases are intentionally not admitted until verified.
- Node.js: **24.9.0 or newer**.
- Caddy: its JSON configuration admin API must be available on `127.0.0.1` over HTTP; the routes GET must return an ETag.
- The selected upstream must be one literal `127.0.0.1:<port>` using HTTP transport. IPv6, Unix sockets, HTTPS/remote upstreams, load-balanced/dynamic upstreams, wildcard host matchers, and routes restricted by paths or other conditions are not selected.

## Install

Install the public repository into the profile that owns the Desktop web host:

```sh
dsh plugin --profile desktop add github:810535323/dsh-caddy-desktop-sync#v0.2.0
```

For a local checkout or a downloaded release archive:

```sh
dsh plugin --profile desktop add ./dsh-caddy-desktop-sync
dsh plugin --profile desktop add ./dsh-caddy-desktop-sync-0.2.0.tgz
```

No build or install script is needed: the package ships native ESM JavaScript. DSH manages the profile dependency and `dsh.bundle.patch` layer. Reload/restart DSH if the layer is not hot-loaded. This is an independent community plugin, not an official DeepSeek or Caddy component.

## Configure

Use the host's configuration editor, or override the inserted row in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-caddy-desktop-sync
  config:
    adminUrl: http://127.0.0.1:2019
    server: srv0
    hostname: chat.example.com
    pollIntervalMs: 2000
    requestTimeoutMs: 3000
    maxResponseBytes: 1000000
    protectedPorts: [8080]
```

| Field              | Default                 | Meaning                                                                                                                        |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `adminUrl`         | `http://127.0.0.1:2019` | Credential-free loopback HTTP admin origin; custom local ports are supported.                                                  |
| `server`           | `srv0`                  | Existing Caddy HTTP server ID; letters, digits, `_` and `-`.                                                                   |
| `hostname`         | empty                   | Exact hostname, normalized to lowercase. When empty, only host-unrestricted routes qualify.                                    |
| `pollIntervalMs`   | `2000`                  | Poll interval, 100–3,600,000 ms; only one check runs at a time.                                                                |
| `requestTimeoutMs` | `3000`                  | Deadline for each admin request, 1–300,000 ms.                                                                                 |
| `maxResponseBytes` | `1000000`               | Maximum admin response size, 1,024–100,000,000 bytes.                                                                          |
| `protectedPorts`   | `[]`                    | Additional service ports that must never be selected or used as the DSH target. The configured admin port is always protected. |

The schema validates configuration on load. A profile patch replaces the row's configuration; omitted options receive the schema defaults. Set the exact `hostname` for host-scoped Caddy routes, especially when multiple sites share a server. With an explicit hostname, a proxy must be exclusively scoped to that host through its route or inherited parent matchers: shared-host proxies and unrestricted fallbacks are refused. If zero or multiple eligible proxies are found, the plugin reports a warning and writes nothing. It does not inspect a backend's identity: configure it only for a Caddy server whose selected proxy belongs to DSH.

## What changes

The plugin reads `ctx.webServer.port`, fetches the existing server routes, and changes only the unique selected upstream's `dial` string. Each PATCH uses the routes GET's ETag as `If-Match`, then reads the changed field back. A concurrent edit (HTTP 412), missing revision, failed readback, or unavailable admin API is reported; a later poll retries from a fresh read. It never creates routes or replaces a full Caddy configuration.

Nested `subroute` handlers are supported. Path-scoped routes, other domains, TLS, authentication settings, and existing proxy headers stay intact. Existing non-loopback targets are refused. Timers and in-flight requests are canceled when the plugin unloads. No model tools, external network requests, credentials, telemetry, tunnels, firewall rules, or additional listener are registered.

Authentication and device pairing remain the responsibility of DSH and your remote-access setup. This plugin neither serves a remote UI nor grants access. An unpaired HTTP 401 can be expected even when the proxy is healthy. Caddy persistence follows your existing deployment and autosave/resume configuration.

## Disable and uninstall

Set `disabled: true` on the plugin row to stop synchronization, or uninstall:

```sh
dsh plugin --profile desktop remove dsh-caddy-desktop-sync
```

The last successfully synchronized upstream is retained. There is no automatic rollback to an old port. Back up your Caddy configuration before first enabling the plugin.

## Development

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm pack
```

The individual commands are `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm format`. Run them in this repository. Tests use isolated loopback HTTP fixtures and a Cordis context, with no real Caddy or DSH profile writes. The package has no compilation step; `pnpm pack` emits an installable `.tgz`. CI checks Node 24 and 26 on Linux and Windows. Source code and tests use two-space indentation, single quotes, and no semicolons, enforced by Prettier and ESLint.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md). Licensed under [AGPL-3.0-or-later](LICENSE).

## References

- [Official DSH bundle packaging](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Official DSH configuration schemas](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md)
- [Caddy configuration concurrency](https://caddyserver.com/docs/api#concurrent-config-changes)

## 中文说明

这是独立的 DSH 社区插件，用于修复 Desktop 重启后监听端口变化、Caddy 仍转发旧端口造成的 502。

通过上面的 `dsh plugin --profile desktop add` 命令安装。已有域名站点应在配置中填写真实的 `hostname`；示例域名仅作占位。Caddy 管理接口必须位于本机 `127.0.0.1`，插件不会创建公网入口或绕过 DSH 配对认证。

插件只对唯一匹配的根代理做带 ETag 的单字段修改；其他域名、路径路由、证书和认证配置不变。多个候选、远程上游、缺少 ETag 或并发配置冲突都会拒绝写入，后续轮询重试。`protectedPorts` 可保护其他本机服务的端口。

停用或卸载后停止同步，保留最后生效的端口。开发、测试和打包均在本仓库独立完成，不依赖 openGym 或任何个人配置。兼容版本仅声明已验证的 DSH 发布版，更新前请先运行测试并核对宿主接口。
