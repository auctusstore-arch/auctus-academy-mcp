# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.0.x (Phase 0) | Yes |

## Reporting a vulnerability

1. **Do not** open a public GitHub issue for security-sensitive reports.
2. Email security contact listed in `public/.well-known/security.txt` (update before production).
3. Include reproduction steps, impact, and affected component (OAuth, MCP tools, KV).

We aim to acknowledge within 72 hours. Coordinated disclosure preferred.

## Scope

- This repository: Cloudflare Worker, OAuth flows, MCP read-only tools, proposed SQL migrations.
- Out of scope: `auctus-academy` web app, Supabase production (`qtphbhqvkeqqmbvgtmec`), user-owned AI clients.

## Secret handling

- No production secrets in git. Use `wrangler secret` and `.dev.vars` locally (gitignored).
- CI runs [Gitleaks](https://github.com/gitleaks/gitleaks) on every push.

## Planned improvements before production

- External penetration test (PRD gate before broad prod).
- `security.txt` contact and PGP key on `mcp.auctus.academy`.
- SBOM per release (Dependabot + lockfile).