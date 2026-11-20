// main-process/window-open-policy.js: what the main window does with a
// window.open() or a link that asks for a new window.
//
//   - 'apple-popup': an https page on apple.com or icloud.com (or a
//     subdomain): MusicKit JS's Apple ID sign-in, opened in a small app
//     window. The host is compared whole, never searched for a substring;
//   - 'external': any other http(s) URL, opened in the user's browser;
//   - 'deny': everything else (another scheme, or not a URL), opened nowhere.
//
// The same rule as the shell-open-external IPC handler: only http(s) leaves
// the app. Pure; loads under plain Node.

const APPLE_POPUP_DOMAINS = ['apple.com', 'icloud.com'];

function hostIsUnder(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function windowOpenDecision(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (_e) { return 'deny'; }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return 'deny';
  const host = parsed.hostname.toLowerCase();
  if (protocol === 'https:' && APPLE_POPUP_DOMAINS.some((d) => hostIsUnder(host, d))) return 'apple-popup';
  return 'external';
}

module.exports = { windowOpenDecision, APPLE_POPUP_DOMAINS };
