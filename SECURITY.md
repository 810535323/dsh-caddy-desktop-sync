# Security

This plugin can change the selected Caddy upstream through the local admin API. Only enable it for a server and hostname you own. Keep the Caddy admin endpoint restricted to trusted local processes and use `protectedPorts` for unrelated services where appropriate.

The plugin selects one eligible loopback root proxy; it does not authenticate the backend or configure TLS, user authentication, device pairing, DNS, or a firewall. Protect those components through your existing DSH/Caddy deployment.

Report reproducible bugs with sanitized configuration, package versions, and expected behavior. Never include credentials, real pairing links, private conversation data, or complete production configuration dumps in public issues. For a vulnerability involving sensitive information, use GitHub's private vulnerability reporting when enabled; avoid publishing exploit details before a fix is available.

Only the DSH versions listed in `engines.dsh` are supported. Dependency vulnerabilities and newly verified runtime compatibility are handled in subsequent releases; the manifest is not a claim that other DSH versions are compatible.
