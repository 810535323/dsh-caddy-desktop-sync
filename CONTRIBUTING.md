# Contributing

Use Node.js 24.9 or newer and pnpm 11. Install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm check` before proposing changes. Use `pnpm format` to apply the repository formatting rules.

Add a focused regression test for behavioral changes. Network tests must use isolated loopback fixtures, never a contributor's live Caddy configuration or DSH profile. Keep private hostnames, credentials, logs, and machine paths out of fixtures and issue reports.

Pull requests should explain the trigger and resulting behavior, affected DSH/Caddy versions, and verification performed. Changes to the supported DSH range need actual runtime verification as well as manifest checks. Preserve conditional leaf-only writes and conservative rejection of ambiguous routes.

Contributions are licensed under AGPL-3.0-or-later, the same license as this repository. The GitHub repository uses the `dsh-plugin` topic for ecosystem discovery as recommended by DSH's contribution guide.
