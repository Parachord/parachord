/**
 * Toast fills by type (src/renderer/lib/toast-style.js), and the call sites
 * the design audit found passing the wrong type.
 */
const fs = require('fs');
const path = require('path');
const { toastBackground } = require('../../src/renderer/lib/toast-style');
const { BANNER_SEVERITY_COLORS } = require('../../src/renderer/lib/home-banners');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = read('src/renderer/app.js');

describe('toastBackground', () => {
  test('errors, warnings and info take the banner\'s severity fills', () => {
    expect(toastBackground('error')).toBe(BANNER_SEVERITY_COLORS.error);
    expect(toastBackground('warning')).toBe(BANNER_SEVERITY_COLORS.warn);
    expect(toastBackground('warn')).toBe(BANNER_SEVERITY_COLORS.warn);
    expect(toastBackground('info')).toBe(BANNER_SEVERITY_COLORS.info);
  });

  test('a warning no longer looks like routine feedback', () => {
    expect(toastBackground('warning')).not.toBe(toastBackground('success'));
  });

  test('success, no type and anything unknown are neutral', () => {
    for (const t of ['success', 'neutral', undefined, null, 5000]) {
      expect(toastBackground(t)).toBe('var(--tooltip-bg)');
    }
  });
});

describe('toast call sites', () => {
  test('the toast draws its fill from toastBackground', () => {
    expect(app).toContain('backgroundColor: toastBackground(toast.type),');
  });

  test('the updater passes a type and a duration, not a duration as the type', () => {
    expect(app).toContain("showToast(`Update available: v${status.version}`, 'info', null, { duration: 5000 });");
    expect(app).toContain("showToast('Update downloaded. Restart to install.', 'success', null, { duration: 8000 });");
    expect(app).toContain("showToast(`Update error: ${status.error}`, 'error', null, { duration: 5000 });");
    expect(app).not.toMatch(/showToast\([^;\n]*, \d{4}\);/);
  });

  test('failure messages are error toasts', () => {
    for (const src of [app, read('src/renderer/hooks/use-playback-engine.js')]) {
      // A one-argument toast whose text says it failed.
      const words = '(Import failed|Play failed|Radio failed|Failed to|Album not found|Protocol error)';
      expect(src).not.toMatch(new RegExp('showToast\\(`' + words + '[^`\\n]*`\\);'));
      expect(src).not.toMatch(new RegExp("showToast\\('" + words + "[^'\\n]*'\\);"));
    }
  });
});
