# Panduan setup staging (untuk Muhammad)

Tidak ada deploy otomatis dari repo ini. Semua langkah di bawah dikerjakan di **staging** dulu (`gxbwpuvgmhcsurrtqhrk`), bukan prod.

## 1. Database (repo auctus-academy)

1. Merge PR academy yang berisi `supabase/migrations/20261116120000_mcp_gateway.sql` ke `staging`. Supabase GitHub Integration akan menerapkannya.
2. Migrasi ini memasang `pgrst.db_pre_request = mcp.pre_request` pada role `authenticator` dan menambah `mcp` ke `pgrst.db_schemas` bila daftar itu di-pin. Bila migrasi gagal dengan pesan "already has pgrst.db_pre_request", ada pre-request lain yang harus dirangkai dulu.
3. Setelah apply, verifikasi: `supabase/tests/mcp_gateway.sql` (pgTAP, rollback sendiri).

## 2. Supabase Auth: OAuth 2.1 Server (staging)

1. Dashboard > Authentication > OAuth Server: **Enable**. Authorization URL path: `/oauth/consent`. **Dynamic client registration: OFF.**
2. Pastikan Site URL staging menunjuk ke web staging (halaman consent ada di `<site>/oauth/consent`).
3. Daftarkan klien **confidential** "Auctus MCP gateway", `client_secret_basic`, grant `authorization_code` + `refresh_token`, redirect `https://auth.mcp-staging.auctus.academy/consent/upstream-callback`. Simpan `client_id` dan `client_secret`.

## 3. Cloudflare Worker

1. Buat KV `OAUTH_KV` dan `MCP_OPS` (staging), isi ID di `wrangler.toml` `[env.staging]`.
2. Binding R2 **baca** ke bucket korpus Saring staging (`saring-corpus-staging`) dengan nama binding `SARING_CORPUS`.
3. Secret (`wrangler secret put --env staging`):

| Nama | Isi |
|------|-----|
| `SUPABASE_URL` | `https://gxbwpuvgmhcsurrtqhrk.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key staging |
| `SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET` | dari langkah 2.3 |
| `SUPABASE_OAUTH_REDIRECT_URI` | `https://auth.mcp-staging.auctus.academy/consent/upstream-callback` |
| `NCBI_API_KEY`, `NCBI_TOOL`, `NCBI_EMAIL` | E-utilities |

4. DNS/route: `auth.mcp-staging.auctus.academy` dan `mcp-staging.auctus.academy` ke Worker. `ISSUER_URL`, `RESOURCE_URL`, `WEB_APP_ORIGIN` sudah di `wrangler.toml`.
5. WAF: rate limit per header `Mcp-Method`/`Mcp-Name` (Worker sudah menolak header yang tidak cocok dengan body).
6. Pilot: isi `ops:kill_switch` di KV `MCP_OPS` (contoh di bawah). `pilotClientIds` kosong berarti semua klien boleh.

## 4. Web academy (Vercel, environment staging)

| Env | Nilai |
|-----|-------|
| `MCP_GATEWAY_ENABLED` | `1` (default mati; tanpa ini halaman Koneksi AI dan consent 404) |
| `MCP_AUTH_ORIGIN` | `https://auth.mcp-staging.auctus.academy` |
| `NEXT_PUBLIC_MCP_RESOURCE_URL` | `https://mcp-staging.auctus.academy/mcp` |
| `SUPABASE_MCP_GATEWAY_CLIENT_ID` | `client_id` dari langkah 2.3 |

## 5. Verifikasi di staging

1. Login dari Claude, Cursor, Codex (smoke): consent Worker, login Auctus, consent kedua, `auctus_whoami`.
2. User Free ditolak setelah login (halaman "Paket belum mendukung").
3. `auctus_saring_set_decision` lalu `auctus_changes_revert`; usulan >20 record muncul di `/riset/koneksi-ai` dan bisa disetujui.
4. Cabut koneksi dari halaman Koneksi AI, lalu panggilan berikutnya 401.
5. Logout semua perangkat di Auctus, lalu panggilan MCP gagal dalam sekitar 1 menit.

## 6. Kill switch (KV `MCP_OPS`, kunci `ops:kill_switch`)

```json
{ "globalDisabled": false, "disabledClientIds": [], "pilotClientIds": [] }
```

## Uji lokal tanpa staging

- `npm run dev` (MOCK_MODE=1) untuk alur OAuth + tool dengan data palsu.
- Kontrak SQL: Supabase lokal dengan migrasi academy, `psql < scripts/e2e-seed.sql`, lalu `MCP_E2E_ENV=<supabase status -o env> npx vitest run tests/e2e-supabase.test.ts`.
