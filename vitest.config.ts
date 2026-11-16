import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The OAuth provider imports `cloudflare:workers` (Workers runtime only).
    alias: { "cloudflare:workers": fileURLToPath(new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
