// Generated manually for Phase 0; run `wrangler types` after binding real KV IDs.
interface Env {
  OAUTH_KV: KVNamespace;
  MCP_OPS: KVNamespace;
  /** Per-authorization-code single-use lock (pentest W-Replay). Missing only in local mock mode. */
  AUTH_CODE_GUARD?: DurableObjectNamespace<import("./src/security/auth-code-guard").AuthCodeGuard>;
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
  SARING_CORPUS?: R2Bucket;
  RL_READ?: RateLimit;
  RL_WRITE?: RateLimit;
  RL_PUBMED?: RateLimit;
  RL_NCBI?: RateLimit;
  NCBI_API_KEY?: string;
  NCBI_TOOL?: string;
  NCBI_EMAIL?: string;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
}