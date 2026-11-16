import { NCBI_EUTILS_ORIGIN, NCBI_REQUEST_TIMEOUT_MS } from "./constants";

const ALLOWED_PATH_PREFIX = "/entrez/eutils/";

export class PubMedClientError extends Error {
  constructor(
    readonly code: "ncbi_timeout" | "ncbi_http_error" | "ncbi_invalid_response" | "ncbi_ssrf_blocked",
    message: string,
  ) {
    super(message);
    this.name = "PubMedClientError";
  }
}

function assertAllowedUrl(url: URL): void {
  if (url.origin !== NCBI_EUTILS_ORIGIN) {
    throw new PubMedClientError("ncbi_ssrf_blocked", "ncbi_host_not_allowed");
  }
  if (!url.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    throw new PubMedClientError("ncbi_ssrf_blocked", "ncbi_path_not_allowed");
  }
}

export type NcbiCredentials = {
  apiKey?: string;
  tool: string;
  email: string;
};

export async function ncbiGet(
  pathname: string,
  searchParams: Record<string, string | number | undefined>,
  creds: NcbiCredentials,
  signal?: AbortSignal,
): Promise<string> {
  if (!pathname.startsWith(ALLOWED_PATH_PREFIX) || pathname.includes("..") || pathname.includes("//")) {
    throw new PubMedClientError("ncbi_ssrf_blocked", "ncbi_path_not_allowed");
  }
  const url = new URL(`${NCBI_EUTILS_ORIGIN}${pathname}`);
  assertAllowedUrl(url);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("tool", creds.tool);
  url.searchParams.set("email", creds.email);
  if (creds.apiKey) url.searchParams.set("api_key", creds.apiKey);

  assertAllowedUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NCBI_REQUEST_TIMEOUT_MS);
  const mergedSignal = signal ?? controller.signal;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: mergedSignal,
      headers: { Accept: "application/json,text/xml,*/*" },
    });
    if (!res.ok) {
      throw new PubMedClientError("ncbi_http_error", `ncbi_status_${res.status}`);
    }
    return await res.text();
  } catch (e) {
    if (e instanceof PubMedClientError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new PubMedClientError("ncbi_timeout", "ncbi_timeout");
    }
    throw new PubMedClientError("ncbi_http_error", "ncbi_fetch_failed");
  } finally {
    clearTimeout(timeout);
  }
}

export function ncbiCredentialsFromEnv(env: Env): NcbiCredentials {
  return {
    apiKey: env.NCBI_API_KEY,
    tool: env.NCBI_TOOL ?? "auctus-mcp",
    email: env.NCBI_EMAIL ?? "mcp-ops@auctus.academy",
  };
}