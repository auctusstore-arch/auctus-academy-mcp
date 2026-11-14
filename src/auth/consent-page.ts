import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { SCOPE_LABELS_ID } from "../config";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function renderConsentPage(details: ConsentDescription, handle: string, opts: { planAllowed: boolean }): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Diterbitkan oleh <strong>${escape(details.clientDomain)}</strong> (CIMD).`
    : "Aplikasi ini mendaftar sendiri; nama klien tidak terverifikasi.";
  const scopeLines = details.scope
    .map((scope) => {
      const label = SCOPE_LABELS_ID[scope] ?? scope;
      return `<li><code>${escape(scope)}</code> — ${escape(label)}</li>`;
    })
    .join("");
  const loopback = details.redirectIsLoopback
    ? "<p><strong>Peringatan:</strong> token akan dikirim ke aplikasi di komputer Anda (localhost). Lanjutkan hanya jika Anda baru memulai login dari aplikasi itu.</p>"
    : "";
  const planBlock = opts.planAllowed
    ? "<p>Paket Anda mendukung koneksi MCP read-only.</p>"
    : "<p><strong>Paket Free tidak mendapat akses MCP.</strong> Upgrade ke Sysrev Complete atau Coaching untuk melanjutkan.</p>";

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'">
  <title>Izinkan ${name} — Auctus MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 1.25rem; }
    button { padding: 0.5rem 1rem; margin-right: 0.5rem; }
  </style>
</head>
<body>
  <h1>Izinkan koneksi AI?</h1>
  <div class="card">
    <p><strong>${name}</strong> meminta izin mengakses workspace SR-MA Anda (hanya baca).</p>
    <p>${origin}</p>
    <p>Akses akan dikirim ke host redirect: <strong>${escape(details.redirectHost)}</strong></p>
    ${loopback}
    <h2>Scope</h2>
    <ul>${scopeLines}</ul>
    ${planBlock}
    <form method="post">
      <input type="hidden" name="handle" value="${escape(handle)}">
      <button type="submit" name="decision" value="approve" ${opts.planAllowed ? "" : "disabled"}>Setujui</button>
      <button type="submit" name="decision" value="deny">Tolak</button>
    </form>
  </div>
</body>
</html>`;
}