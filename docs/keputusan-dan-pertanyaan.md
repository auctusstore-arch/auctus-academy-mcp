# Keputusan & pertanyaan untuk Muhammad

## Sudah diimplementasi di scaffold (menunggu konfirmasi deploy)

- Satu Worker `OAuthProvider` (AS + resource `/mcp`) untuk kesederhanaan Fase 0; split `auth.*` vs `mcp.*` tetap bisa dilakukan sebelum prod.
- Consent Worker untuk **mock lokal**; staging/prod redirect ke `WEB_APP_ORIGIN` (halaman academy belum ada di repo ini).
- Port data Supabase **belum di-wire** (`supabase_port_not_wired`); hanya mock.
- DCR rate limit per IP: validasi host saja di callback; limit 10/jam di KV butuh hook dengan akses `env` atau WAF.

## Pertanyaan terbuka (PRD §15)

3. ChatGPT Plus read-only — diterima?
5. Kolaborator Saring pakai MCP?
7. Approval W2 hanya web vs elicitation?
8. Anggaran pentest eksternal?
9. Listing direktori Fase 3 vs custom connector saja?
10. **Daftar user pilot** beta read-only — siapa saja?
11. Review legal UU PDP — siapa?

## Keputusan yang perlu Muhammad sebelum staging

1. Apakah satu Worker atau split AS/RS (dua subdomain)?
2. Apakah migrasi `mcp.*` digabung satu PR dengan RLS gateway di academy?
3. Nilai awal `pilotClientIds` dan `pilot_users` di Supabase.
4. Staging Supabase project ref (hindari prod).
5. Siapkan OAuth Supabase upstream client secret & rotasi.