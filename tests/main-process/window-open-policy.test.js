/**
 * The main window's window-open rule (main-process/window-open-policy.js):
 * Apple's sign-in pop-up stays in the app, other http(s) opens in the
 * browser, and nothing else opens at all.
 */
const fs = require('fs');
const path = require('path');
const { windowOpenDecision } = require('../../main-process/window-open-policy');

describe('windowOpenDecision', () => {
  test.each([
    'https://authorize.music.apple.com/woa?a=1',
    'https://appleid.apple.com/auth/authorize',
    'https://apple.com/',
    'https://www.icloud.com/',
    'HTTPS://IDMSA.APPLE.COM/x',
  ])('%s is the Apple sign-in pop-up', (url) => {
    expect(windowOpenDecision(url)).toBe('apple-popup');
  });

  test.each([
    'https://example.com/?next=apple.com',
    'https://apple.com.example.net/',
    'https://notapple.com/',
    'https://example.com/apple.music',
    'http://appleid.apple.com/', // not https
  ])('%s is not the Apple pop-up; it opens in the browser', (url) => {
    expect(windowOpenDecision(url)).toBe('external');
  });

  test.each([
    'file:///etc/hosts',
    'javascript:alert(1)',
    'data:text/html,hi',
    'tel:+15555550100',
    'smb://server/share',
    'spotify:track:abc',
    'about:blank',
    'not a url',
    '',
    undefined,
  ])('%s opens nowhere', (url) => {
    expect(windowOpenDecision(url)).toBe('deny');
  });
});

describe('main.js uses it for the main window', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf('mainWindow.webContents.setWindowOpenHandler(');
  const handler = main.slice(start, main.indexOf('});', start));

  test('the handler decides by windowOpenDecision', () => {
    expect(start).toBeGreaterThan(0);
    expect(handler).toMatch(/const decision = windowOpenDecision\(url\);/);
    expect(handler).toMatch(/if \(decision === 'apple-popup'\)/);
    expect(handler).toMatch(/if \(decision === 'external'\) shell\.openExternal\(url\)/);
  });

  test('no substring check on the URL is left', () => {
    expect(handler).not.toMatch(/url\.includes\(/);
  });
});
