# Pemetaan ancaman (PRD §2)

Status: **Fase 0 scaffold** — mitigasi di kolom "Di repo MCP" unless noted TODO (butuh app academy / infra).

| ID | Mitigasi di repo MCP | Status / catatan |
|----|----------------------|------------------|
| T1 Prompt injection | `wrapUntrustedText`, flags heuristik, `instructions` server | ✅ tool saring + PubMed/MeSH; approval W2 belum (Fase 1) |
| T2 Tool poisoning | Katalog statis `PHASE0_TOOLS`, hash di `/.well-known/auctus-mcp-tools.json` | ✅ |
| T3 Tool shadowing | Prefiks `auctus_`, dokumentasi | ✅ |
| T4 Confused deputy | Consent per client, PKCE, redirect exact match, `beginConsent` | ✅ consent; sesi web penuh di auctus.academy TODO |
| T5 Token passthrough | Token MCP opaque via workers-oauth-provider; upstream JWT di `props` | ✅ scaffold; tidak dikirim ke klien |
| T6 Audience binding | `resourceMetadata.resource` per env | ✅ |
| T7 Session hijacking | MCP stateless 2026-07-28 | ✅ |
| T8 Lintas tenant | `can_access_project` (mock + RPC nanti), tes CI | ✅ mock; Supabase port TODO |
| T9 Scope berlebihan | Hanya `sr.read` + `offline_access`; gate di tool | ✅ |
| T10 DCR/CIMD | CIMD on, allowlist host redirect, SSRF guard `fetchClientMetadataDocument` | ✅ DCR rate limit KV TODO (callback tanpa env) |
| T11 Token TTL | 10 menit access, refresh rotation (library) | ✅ |
| T12 Write destructive | Tidak ada tool tulis | ✅ Fase 0 |
| T13 Rate limit / DoS | Read 60/menit per user+client (KV); PubMed +30/menit; NCBI global 10/detik (KV) | ✅ |
| T14 Audit | Hash chain in-memory + SQL proposal `mcp.audit_events` | ⚠️ persist ke Postgres TODO |
| T15 Supply chain | lockfile, Dependabot, CI gitleaks | ✅ |
| T16 SSRF CIMD | `global_fetch_strictly_public` + fetch guard | ✅ |
| T20 PubMed SSRF / data exfil | Host tetap `eutils.ncbi.nlm.nih.gov`, path prefix `/entrez/eutils/` | ✅ Fase 0 |
| T21 Konten pihak ketiga (NCBI) | `untrusted_content`, `openWorldHint: true`, batas ukuran, timeout 15s | ✅ Fase 0 |
| T17 Klien tanpa approval | Hanya baca; tidak ada W2 | ✅ Fase 0 |
| T18 PII | Tanpa email kolaborator di output mock | ✅; review legal TODO |
| T19 Shadow server | Dokumentasi host kanonik | ✅ |