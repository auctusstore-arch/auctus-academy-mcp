# Auctus MCP Server — Fase 0 (beta read-only)

Server MCP resmi Auctus untuk workspace SR-MA. Prioritas desain: **1. keamanan, 2. keamanan, 3. keamanan, 4. UX.**

## Apa yang ada di repo ini

- Worker Cloudflare (`src/`) dengan OAuth 2.1 + MCP Streamable HTTP pada `/mcp`
- Tool read-only Fase 0 (`sr.read`) dengan prefiks `auctus_`
- Halaman consent (mock lokal) dan redirect ke web Auctus (staging/prod)
- Rate limit, kill switch, allowlist pilot (KV `MCP_OPS`)
- Migrasi SQL **usulan** schema `mcp.*` (belum diterapkan ke Supabase mana pun)
- CI: typecheck, lint, test, gitleaks

## Menjalankan lokal

```bash
npm install
cp .dev.vars.example .dev.vars   # opsional; default mock aktif lewat wrangler.toml
npm run dev                      # wrangler dev, MOCK_MODE=1
```

Tanpa secret produksi. Data tool memakai mock in-memory (`src/data/mock-store.ts`).

## Dokumentasi

| Berkas | Isi |
|--------|-----|
| [threat-model.md](./threat-model.md) | Pemetaan T1–T19 PRD |
| [security-checklist.md](./security-checklist.md) | Status checklist §11 |
| [setup-muhammad.md](./setup-muhammad.md) | Langkah staging deploy |
| [keputusan-dan-pertanyaan.md](./keputusan-dan-pertanyaan.md) | Keputusan terbuka untuk Muhammad |

## Lingkungan Wrangler

- `local` — default di `wrangler.toml` (`MOCK_MODE=1`)
- `staging` — `wrangler dev --env staging` (butuh secret & KV asli)
- `production` — konfigurasi placeholder, **tanpa perintah deploy** di CI

## Keamanan

Lihat [SECURITY.md](../SECURITY.md) dan `public/.well-known/security.txt`.