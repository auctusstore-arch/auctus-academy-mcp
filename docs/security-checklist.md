# Checklist keamanan PRD §11

Legenda: ✅ diimplementasi + diuji lokal | 🔜 butuh deploy/konfigurasi | ❌ belum | 👤 butuh keputusan/aksi manusia

| Item | Status |
|------|--------|
| PRM RFC 9728, 401 + `resource_metadata` + `scope` | ✅ smoke |
| PKCE S256, `iss`, `resource`, redirect exact, `state` sekali pakai | ✅ smoke (iss + state dikembalikan, replay handle ditolak) |
| CIMD + DCR terbatas (URI persis dipin per vendor, 10/jam/IP, TTL 90 hari) | ✅ |
| Consent milik Auctus, CSRF, `frame-ancestors`, loopback warning | ✅ |
| Token ≤10 menit, refresh rotasi, idle 7 / absolut 30 hari | ✅ |
| Tanpa token passthrough | ✅ |
| Scope + entitlement (Free ditolak) + `can_access_project` | ✅ pgTAP + e2e |
| Tanpa service role di jalur tool | ✅ `scripts/check-no-service-role.sh` |
| Pembatasan token gateway deny-by-default | ✅ pgTAP + uji HTTP PostgREST |
| Lintas tenant | ✅ pgTAP, e2e, unit |
| `untrusted_content`, tanpa email kolaborator, batas ukuran | ✅ |
| Anotasi jujur, katalog di-hash | ✅ |
| W2 tidak bisa di-commit tanpa manusia | ✅ pgTAP (`web_only`, `reauth_required`, `payload_changed`) |
| Audit append-only + hash chain + revert | ✅ pgTAP |
| Rate limit + ukuran payload | ✅ unit; 🔜 uji beban |
| Koneksi AI: cabut satu/semua langsung berlaku | ✅ diuji di browser lokal |
| Pencabutan otomatis saat ganti password / akses berakhir | ✅ unit (session check, refresh `invalid_grant`); 🔜 uji di staging |
| Kill switch global + per klien | ✅ |
| Dependensi dipin, secret di store, RUNBOOK rotasi | ✅ lockfile; ✅ RUNBOOK (`docs/runbook-rotasi-secret.md`) |
| Pentest internal (Fase 0), pentest eksternal + red-team (Fase 1), uji abuse kuota + pentest regresi (Fase 2) | 👤 |
| Kebijakan privasi / UU PDP | 👤 |
