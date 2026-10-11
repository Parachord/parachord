/**
 * Widevine VMP signing through castlabs EVS (parachord#882).
 *
 * Parachord runs on castlabs' Electron for Content Security (ECS). Its prebuilt
 * binaries are VMP-signed for development only, which Widevine's production
 * license servers (Apple Music, etc.) refuse. EVS issues the production
 * signature for free; see https://github.com/castlabs/electron-releases/wiki/EVS
 *
 * Order matters (per castlabs):
 *   macOS   — VMP-sign BEFORE Apple code signing  → called from afterPack
 *   Windows — VMP-sign AFTER Authenticode signing → called from afterSign
 *   Linux   — nothing to do (the Linux CDM has no VMP)
 *
 * Needs `python3 -m castlabs_evs` and a logged-in EVS account (CI logs in with
 * EVS_ACCOUNT_NAME / EVS_PASSWD before building). When EVS isn't available —
 * local builds, fork PRs without secrets — it warns and skips, leaving the
 * development signature. Set EVS_REQUIRED=1 (release tags) to fail the build
 * instead of shipping a release that can't get production licenses.
 */

const { execFileSync } = require('child_process');

const PYTHON = process.env.EVS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const isRequired = () => ['1', 'true'].includes(String(process.env.EVS_REQUIRED || '').toLowerCase());

function evsAvailable() {
  try {
    execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function vmpSign(context) {
  const platform = context.electronPlatformName;
  if (platform !== 'darwin' && platform !== 'win32') return;

  const skip = (reason) => {
    if (isRequired()) throw new Error(`[VMP] ${reason}, and EVS_REQUIRED is set`);
    console.warn(`[VMP] ${reason}; skipping. This build keeps the development signature and can't get production Widevine licenses.`);
  };

  if (!evsAvailable()) return skip(`castlabs-evs not found (${PYTHON} -m castlabs_evs)`);

  console.log(`[VMP] Signing ${context.appOutDir} (${platform}) for streaming`);
  try {
    // -n: never prompt; fail instead if the cached EVS login has expired.
    execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', '--streaming', context.appOutDir], { stdio: 'inherit' });
    execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', '-n', 'verify-pkg', context.appOutDir], { stdio: 'inherit' });
  } catch (e) {
    return skip(`VMP signing failed (${e.message})`);
  }
}

module.exports = { vmpSign };
