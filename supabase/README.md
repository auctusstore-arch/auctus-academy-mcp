# Database schema

The `mcp` schema lives in **auctus-academy** (`supabase/migrations/20261116120000_mcp_gateway.sql`, tests in `supabase/tests/mcp_gateway.sql`), so it ships through the normal staging/main release flow with every other migration. This repo only calls its `mcp.*` RPCs.

`scripts/e2e-seed.sql` seeds a **local** stack for `tests/e2e-supabase.test.ts`.
