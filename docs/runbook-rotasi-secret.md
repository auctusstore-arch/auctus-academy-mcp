# Runbook: deploy production dan rotasi secret

Tidak ada deploy otomatis. Semua langkah dijalankan manual oleh pemilik akun Cloudflare. Nama Worker production di `wrangler.toml` sengaja `auctus-mcp-local` agar `wrangler deploy` tanpa `--env` tidak meluncurkan mode mock. Sebelum deploy pertama, ganti dengan nama production yang diputuskan pemilik (misalnya `auctus-mcp`) dalam PR terpisah.

## Prasyarat deploy production

1. Buat KV `OAUTH_KV` dan `MCP_OPS`, lalu isi ID di blok `env.production` (gantikan `REPLACE_WITH_PROD_*`).
2. Bucket R2 `saring-corpus` sudah ada (dipakai situs web); binding baca `SARING_CORPUS` sudah dideklarasikan di blok production.
3. Isi semua secret (lihat tabel). Jangan tempel nilai secret di chat, issue, atau commit.
4. Custom domain `mcp.auctus.academy` dan `auth.mcp.auctus.academy`, plus aturan WAF rate limit pada header `Mcp-Method` dan `Mcp-Name`.
5. Deploy: `npx wrangler deploy --env production`.
6. Verifikasi: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, dan `/mcp` tanpa token membalas 401 dengan `WWW-Authenticate`. Jalankan `pentest/unauth.mjs` terhadap production dengan akun uji.

## Daftar secret

| Secret | Sumber | Rotasi |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase production | Hanya bila project berganti |
| `SUPABASE_ANON_KEY` | Supabase API settings | Saat key dirotasi atau bocor |
| `SUPABASE_OAUTH_CLIENT_ID` | Klien OAuth "Auctus MCP gateway" | Saat klien dibuat ulang |
| `SUPABASE_OAUTH_CLIENT_SECRET` | Klien yang sama | Tiap 90 hari atau bila bocor |
| `SUPABASE_OAUTH_REDIRECT_URI` | `https://auth.mcp.auctus.academy/consent/upstream-callback` | Hanya bila domain berganti |
| `NCBI_API_KEY`, `NCBI_TOOL`, `NCBI_EMAIL` | Akun NCBI | Saat key dirotasi |

## Rotasi secret

1. Buat nilai baru di sumbernya (Supabase atau NCBI). Untuk client secret OAuth, buat secret kedua bila dashboard mendukung, supaya tidak ada jeda.
2. `npx wrangler secret put <NAMA> --env production`, tempel nilai baru di prompt.
3. Deploy ulang bila perlu (`npx wrangler deploy --env production`), lalu jalankan smoke test dengan satu akun uji.
4. Cabut nilai lama di sumbernya.
5. Catat tanggal rotasi.

Rotasi `SUPABASE_OAUTH_CLIENT_SECRET` atau penggantian klien OAuth memutus refresh token upstream semua grant. Pengguna perlu login ulang di klien AI mereka.

## Kill switch dan rollback

KV `MCP_OPS`, kunci `ops:kill_switch`:

```json
{ "globalDisabled": true, "disabledClientIds": [], "pilotClientIds": [] }
```

- `globalDisabled: true` menolak `/mcp`, `/authorize`, `/token`, dan `/register` seketika.
- `pilotClientIds` berisi ID klien yang boleh dipakai selama pilot. Kosong berarti semua klien boleh.
- Rollback web: kosongkan `MCP_GATEWAY_ENABLED` di Vercel dan redeploy; halaman Koneksi AI kembali 404.
- Cabut semua grant lewat `/riset/koneksi-ai` (per pengguna) atau hapus kunci grant di KV `OAUTH_KV` bila perlu pencabutan massal.

## Kebocoran secret

1. Aktifkan kill switch global.
2. Rotasi secret yang bocor (langkah di atas).
3. Cek `mcp.audit_events` untuk aktivitas tak wajar pada rentang waktu kebocoran.
4. Bila data pribadi terdampak, ikuti prosedur notifikasi di rencana UU PDP (3x24 jam) di repo academy.
