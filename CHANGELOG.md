# Changelog

## 0.2.0 — 2026-11-12

- Prepare a standalone open-source DSH bundle with native ESM, license, tests, CI, and package metadata.
- Replace deployment-specific values with a validated DSH configuration schema.
- Support nested Caddy subroutes with exact hostname selection and conservative matcher filtering.
- Make polling, request deadlines, response-size limits, admin origin, server, and protected ports configurable.
- Cover conditional updates, readback, concurrency, network failures, retry, and lifecycle cleanup with isolated tests.

## 0.1.1 — 2026-11-07

- Verify the original local repair against DSH 0.2.2-rc.1 and correct the top-level compatibility declaration.

## 0.1.0

- Initial host-only Caddy port synchronization repair.
