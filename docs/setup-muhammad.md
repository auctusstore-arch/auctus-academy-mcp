# Panduan setup untuk Muhammad (staging)

Urutan disarankan sebelum `wrangler deploy --env staging` (deploy **tidak** diotomasi dari repo ini).

## 1. Cloudflare

1. Buat account Workers Paid (jika belum).
2. Buat **dua** KV namespace: `OAUTH_KV`, `MCP_OPS`; isi ID di `wrangler.toml` (`env.staging`).
3. (Opsional) Durable Object rate limit — Fase 0 memakai KV saja.
4. DNS (setelah siap):
   - `auth.mcp-staging.auctus.academy` → Worker OAuth (atau satu Worker gabungan)
   - `mcp-staging.auctus.academy` → route `/mcp`
5. WAF rate limit pada header `Mcp-Method` / `Mcp-Name` — konfigurasi dashboard.

## 2. Secrets Worker (`wrangler secret put`, staging)

| Nama | Keterangan |
|------|------------|
| `TOKEN_ENCRYPTION_SECRET` | 32+ byte random (props grant); rotate terdokumentasi |
| `SUPABASE_URL` | URL project **staging** (bukan prod `qtphbhqvkeqqmbvgtmec`) |
| `SUPABASE_ANON_KEY` | Anon key staging |
| `SUPABASE_OAUTH_CLIENT_ID` | Confidential client `auctus-mcp-gateway` di Supabase Auth OAuth 2.1 |
| `SUPABASE_OAUTH_CLIENT_SECRET` | Secret client tersebut |
| `SUPABASE_OAUTH_REDIRECT_URI` | Callback Worker `/consent/upstream-callback` |

Salin pola dari `.dev.vars.example`. **Jangan** commit nilai asli.

## 3. Supabase (staging only)

1. Review & apply migrasi `supabase/migrations/20261114000000_mcp_schema.sql` lewat PR di **auctus-academy**, bukan langsung dari repo ini.
2. Daftar OAuth client confidential `auctus-mcp-gateway`; matikan DCR di Supabase.
3. RLS restriktif JWT `client_id = auctus-mcp-gateway` untuk schema `saring`, `research`, `ma`, `prisma` — issue terpisah di academy.
4. RPC yang dipakai tool: `saring.can_access_project`, `ma.my_quota`, `ma.pilot_status`, dll. (sesuai staging branch `ma-workspace`).

## 4. Aplikasi web (auctus.academy)

1. Halaman consent `/riset/koneksi-ai/oauth/authorize` — integrasi dengan flow Worker (`WEB_APP_ORIGIN` redirect dari `/authorize`).
2. Halaman Koneksi AI: daftar grant, cabut, riwayat audit (baca `mcp.connections` / `mcp.audit_events`).
3. Set `MOCK_MODE=0` di staging Worker.

## 5. Verifikasi

1. OAuth end-to-end dari minimal: Claude, Cursor, Codex (smoke).
2. `auctus_whoami` + satu tool baca dengan user Complete.
3. User Free ditolak di consent.
4. Tes lintas tenant setelah port Supabase hidup.
5. Aktifkan pilot: tulis `ops:kill_switch` di KV `MCP_OPS` (`pilotClientIds`).

## 6. Kill switch (KV)

Contoh nilai JSON kunci `ops:kill_switch`:

```json
{
  "globalDisabled": false,
  "disabledClientIds": [],
  "pilotClientIds": ["<client_id_pilot>"]
}
```