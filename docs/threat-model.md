# Pemetaan ancaman (PRD §2)

Status: **Fase 0 sampai 2 diimplementasi (kode + tes), belum dideploy.** Kolom "Bukti" menunjuk tes yang menegakkan mitigasi. Gerbang manusia (pentest internal/eksternal, red-team, review legal) belum dijalankan.

| ID | Mitigasi | Bukti |
|----|----------|-------|
| T1 Prompt injection | `untrusted_content` + flag heuristik, `instructions` server, prompt `screening_assistant`, W2 untuk bulk, diff di halaman approval | `tests/tools.test.ts`, `tests/untrusted.test.ts` |
| T2 Tool poisoning / rug pull | Katalog statis `src/mcp/tools.ts`, hash di `/.well-known/auctus-mcp-tools.json` | `tests/tools.test.ts` (catalog) |
| T3 Tool shadowing | Prefiks `auctus_`, `instructions` | catalog test |
| T4 Confused deputy / consent | Consent di AS sendiri (handle terikat cookie browser, sekali pakai), CSP `form-action` hanya ke rantai redirect, `frame-ancestors`/`X-Frame-Options`, peringatan loopback, peringatan "jangan setujui tautan kiriman orang" (consent phishing), consent kedua di academy menampilkan akun yang dipakai | smoke OAuth (CSRF tanpa cookie = 400, replay handle = 400), `tests/auth-upstream.test.ts` |
| T5 Token passthrough | Token MCP opaque; token Supabase hanya di props terenkripsi; Worker memanggil Supabase sebagai user | `src/auth/default-handler.ts` |
| T6 Audience | RFC 8707 resource per env | library |
| T7 Session hijacking | Stateless; batch JSON-RPC ditolak | `tests/auth-upstream.test.ts` |
| T8 Lintas tenant / fail-open gateway | **Deny-by-default** `mcp.pre_request`: token ber-`client_id` hanya boleh `POST /rpc/*` di schema `mcp`; Storage hanya baca `ma-results/{uid}/`; Realtime ditutup; API mobile menolak token OAuth; RLS + cek kepemilikan di setiap RPC | pgTAP `supabase/tests/mcp_gateway.sql` (academy), uji HTTP PostgREST nyata (403 untuk tabel, schema lain, GraphQL), `tests/e2e-supabase.test.ts` |
| T9 Scope | Scope bertahap; tool tanpa scope menjawab `insufficient_scope` + scope yang dibutuhkan; consent hanya menerima scope yang didukung | `tests/tools.test.ts`, `tests/auth-upstream.test.ts` |
| T10 DCR/CIMD | CIMD aktif; DCR allowlist host (400 `invalid_redirect_uri`) + 10/jam per IP | smoke (`register evil host 400`, `429` setelah 10) |
| T11 Token TTL / pencabutan | Akses 10 menit; refresh dirotasi; refresh MCP menyegarkan token upstream dan `invalid_grant` mencabut grant bila Supabase menolak; cek sesi upstream per panggilan (cache 60 detik) sehingga ganti password / logout semua perangkat berlaku dalam sekitar 1 menit | `tests/auth-upstream.test.ts` |
| T12 Tulis destruktif | W1 dengan change set + undo; W2 (>20 record atau >5 exclude, **termasuk kumulatif per jam per klien+proyek**); approval hanya dari sesi web (bukan token gateway) dengan login ≤12 jam dan hash payload; revert dari perubahan yang disetujui manusia butuh approval lagi; hapus/undang/korpus = W3 tidak ada tool | pgTAP + `tests/tools.test.ts` |
| T13 Kuota / DoS | Baca 60/menit, tulis 10/menit, W2 maks 10/jam, run selalu W2 + `ma.enqueue_job` (rate 20/jam, satu job aktif), PubMed 30/menit + NCBI 10/detik | `src/security/rate-limit.ts`, SQL |
| T14 Audit | `mcp.audit_events` append-only, rantai hash **per user**, verifikasi `mcp.verify_audit_chain`, retensi via `mcp.purge_audit_before` (≥365 hari) | pgTAP |
| T15 Supply chain | lockfile, Dependabot, gitleaks; engine dedup di-vendor dengan hash guard | `tests/auth-upstream.test.ts` (vendored hash) |
| T16 SSRF | CIMD fetch guard; NCBI host tetap; Storage path divalidasi | pubmed tests |
| T17 Klien tanpa approval di sisi klien | Semua konfirmasi ditegakkan server (W2) | pgTAP |
| T18 PII / kolaborator | Tanpa email kolaborator; akses MCP kolaborator **default mati**, dinyalakan pemilik proyek dari web | pgTAP |
| T19 Shadow server | Host kanonik di halaman Koneksi AI | academy |
| T20 PubMed exfil | Host NCBI saja, query hanya di-hash di audit | pubmed tests |
| T21 Konten NCBI | `untrusted_content`, batas ukuran | pubmed tests |
| Header `Mcp-Method`/`Mcp-Name` | Ditolak bila tidak cocok dengan body (review) | `tests/auth-upstream.test.ts`, smoke |

## Sisa risiko yang diketahui

- `Mcp-Method`/`Mcp-Name` belum diwajibkan (hanya dicocokkan bila ada) supaya klien lama tetap jalan.
- Realtime `postgres_changes` untuk token gateway tetap dibatasi RLS biasa (data milik sendiri), tidak ditutup total.
- Consent kedua di academy dilewati Supabase bila akun sudah pernah memberi izin ke gateway; consent per aplikasi AI di Worker tetap selalu tampil.
- Alert Telegram (W2 ditolak >3/hari, lonjakan, negara baru) belum dibuat.
