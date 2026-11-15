import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { MCP_SCOPE_LIST, SCOPE_LABELS_ID } from "../config";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1.25rem; }
  .warn { border-left: 4px solid #c47f00; padding-left: .75rem; }
  label { display: block; margin: .35rem 0; }
  button, .btn { padding: .6rem 1rem; margin: .5rem .5rem 0 0; border-radius: 8px; border: 1px solid #8886; font-size: 1rem; }
  button[value=approve] { background: #0b5; color: #fff; border-color: #0b5; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Consent is rendered by the authorization server itself (review gap 3: no
 * cross-origin handoff). The user logs in to Auctus right after approving.
 */
export function renderConsentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Identitas aplikasi diverifikasi dari domain <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "Nama aplikasi ini didaftarkan sendiri oleh aplikasinya dan <strong>tidak terverifikasi</strong>.";
  const supported = new Set<string>(MCP_SCOPE_LIST);
  const requested = details.scope.filter((s) => supported.has(s));
  const scopes = requested.length ? requested : ["sr.read"];
  const scopeLines = scopes
    .map((scope) => {
      const label = SCOPE_LABELS_ID[scope] ?? scope;
      if (scope === "sr.read") {
        return `<label><input type="checkbox" checked disabled> ${escapeHtml(label)}</label><input type="hidden" name="scope" value="sr.read">`;
      }
      return `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(label)}</label>`;
    })
    .join("");
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>Perhatian:</strong> izin akan dikirim ke aplikasi di komputer Anda sendiri (localhost). Lanjutkan hanya jika Anda yang baru saja memulai login dari aplikasi itu.</p>`
    : "";

  return page(
    `Izinkan ${details.clientName} - Auctus`,
    `<h1>Hubungkan AI ke Auctus?</h1>
  <div class="card">
    <p><strong>${name}</strong> meminta izin mengakses workspace SR-MA Anda di Auctus.</p>
    <p>${origin}</p>
    <p>Izin dikirim ke: <strong>${escapeHtml(details.redirectHost)}</strong></p>
    ${loopback}
    <p class="warn">Jika Anda tidak sedang menghubungkan aplikasi AI, atau seseorang mengirimi Anda tautan ini, pilih <strong>Tolak</strong>.</p>
    <form method="post">
      <h2>Yang boleh dilakukan</h2>
      ${scopeLines}
      <p>Setelah menyetujui, Anda akan masuk dengan akun Auctus. Paket Free tidak mendapat akses MCP.</p>
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <button type="submit" name="decision" value="approve">Setujui dan masuk</button>
      <button type="submit" name="decision" value="deny">Tolak</button>
    </form>
  </div>`,
  );
}

export function renderPlanDeniedPage(backToClient: string, webOrigin: string): string {
  const upgrade = new URL("/riset", webOrigin).toString();
  return page(
    "Paket belum mendukung - Auctus",
    `<h1>Paket Anda belum mendukung koneksi AI</h1>
  <div class="card">
    <p>Koneksi AI (MCP) tersedia untuk Sysrev Complete dan Coaching. Paket Free tidak mendapat akses MCP.</p>
    <p><a class="btn" href="${escapeHtml(upgrade)}">Lihat paket di Auctus</a>
    <a class="btn" href="${escapeHtml(backToClient)}">Kembali ke aplikasi AI</a></p>
  </div>`,
  );
}

export function renderErrorPage(message: string): string {
  return page("Auctus MCP", `<h1>Tidak bisa melanjutkan</h1><div class="card"><p>${escapeHtml(message)}</p></div>`);
}
