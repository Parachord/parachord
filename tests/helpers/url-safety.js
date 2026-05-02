// SSRF guard for user-supplied URLs in parachord:// commands (import, play-*).
// Rejects: non-http(s) schemes; literal IPs in loopback / RFC1918 / link-local
// / CGNAT / cloud-metadata ranges; mDNS .local; IPv6 loopback / link-local /
// ULA / IPv4-mapped.
//
// NOTE: Defends against literal-IP and well-known-hostname SSRF only.
// Does NOT defend against DNS rebinding — a public hostname resolving to
// 127.0.0.1 is accepted here. Callers in privileged contexts must additionally
// fetch through a resolver that pins to the resolved IP, or accept this risk.
//
// SYNC: app.js — keep byte-identical with window.isPublicHttpUrl
function isPublicHttpUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  let u;
  try { u = new URL(urlString); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === 'localhost.') return false;
  if (host.endsWith('.local') || host.endsWith('.local.')) return false;
  if (host === '[::1]') return false;
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::' || v6 === '::1') return false;
    if (/^fe[89ab][0-9a-f]?:/i.test(v6)) return false;
    if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return false;
    if (/^::ffff:/i.test(v6)) return false;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    if (a === 0) return false;
    if (a === 127) return false;
    if (a === 10) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}
module.exports = { isPublicHttpUrl };
