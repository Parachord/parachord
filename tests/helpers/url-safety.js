function isPublicHttpUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  let u;
  try { u = new URL(urlString); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost') return false;
  if (host.endsWith('.local')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    if (a === 127) return false;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}
module.exports = { isPublicHttpUrl };
