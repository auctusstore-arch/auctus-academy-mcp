# Checklist keamanan PRD §11 — status Fase 0

Legenda: ✅ lulus scaffold / tes | ⚠️ sebagian / stub | ❌ belum | 🔜 butuh deploy / academy

| Item | Status |
|------|--------|
| PRM RFC 9728 + 401 challenge | ✅ via OAuthProvider |
| PKCE S256, iss, resource, redirect exact | ✅ library + validasi redirect |
| CIMD + DCR terbatas | ✅ allowlist host; TTL 90 hari |
| Consent Indonesia, loopback warning, frame-ancestors | ✅ `consent-page.ts` |
| Token ≤10 menit, refresh rotation | ✅ `ACCESS_TOKEN_TTL_SECONDS=600` |
| No token passthrough | ✅ |
| Scope + entitlement + can_access_project | ⚠️ entitlement ✅; RPC Supabase TODO |
| No service role di jalur tool | ✅ `scripts/check-no-service-role.sh` |
| RLS gateway `auctus-mcp-gateway` | 🔜 migrasi di repo academy |
| Lintas tenant CI | ✅ `tests/cross-tenant.test.ts` |
| untrusted_content + batas ukuran | ✅ |
| Anotasi tool jujur (`readOnlyHint`, `openWorldHint` PubMed) | ✅ `catalog.ts` |
| PubMed native E-utilities (bukan proxy MCP) | ✅ `src/pubmed/` |
| Audit PubMed tanpa query plaintext | ✅ `pubmed/audit-args.ts` |
| Rencana impor PubMed → Saring | 📄 `docs/pubmed-phase1-plan.md` |
| W2 / approval | N/A Fase 0 |
| Audit append-only + hash chain | ⚠️ tes unit; Postgres TODO |
| Rate limit | ✅ read path |
| Halaman Koneksi AI revoke | 🔜 academy #1789 |
| Kill switch + pilot allowlist | ✅ KV |
| Dependabot + gitleaks | ✅ CI |
| Privasi / legal | 🔜 Muhammad / legal |