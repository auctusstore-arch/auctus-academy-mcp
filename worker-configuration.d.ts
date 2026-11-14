// Generated manually for Phase 0; run `wrangler types` after binding real KV IDs.
interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OPS: KVNamespace;
  ENVIRONMENT: string;
  MOCK_MODE: string;
  RESOURCE_URL: string;
  ISSUER_URL: string;
  WEB_APP_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_OAUTH_CLIENT_ID?: string;
  SUPABASE_OAUTH_CLIENT_SECRET?: string;
  SUPABASE_OAUTH_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_SECRET?: string;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}