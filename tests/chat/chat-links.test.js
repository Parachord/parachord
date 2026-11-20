/**
 * Links in a Shuffleupagus reply (#1581): only http(s) and the parachord://
 * commands the chat handles are clickable; every other scheme renders as
 * plain text.
 */
const fs = require('fs');
const path = require('path');
const { chatLinkTarget, CHAT_PARACHORD_COMMANDS } = require('../../src/renderer/lib/chat-links');

describe('chatLinkTarget', () => {
  test('http(s) links open in the browser', () => {
    expect(chatLinkTarget('https://open.spotify.com/track/x')).toEqual({ kind: 'external', url: 'https://open.spotify.com/track/x' });
    expect(chatLinkTarget('http://example.com/a')).toEqual({ kind: 'external', url: 'http://example.com/a' });
    expect(chatLinkTarget('  HTTPS://Example.com/  ')).toEqual({ kind: 'external', url: 'https://example.com/' });
  });

  test.each([
    'file:///etc/passwd',
    'tel:+15555550100',
    'sms:+15555550100',
    'mailto:someone@example.com',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'spotify:track:abc',
    'slack://open',
    'not a url',
    '',
  ])('%s is not a link', (url) => {
    expect(chatLinkTarget(url)).toBeNull();
  });

  test('the chat\'s own parachord:// commands are kept, parsed', () => {
    expect(chatLinkTarget('parachord://artist/Radiohead')).toMatchObject({ kind: 'parachord', command: 'artist', segments: ['Radiohead'] });
    expect(chatLinkTarget('parachord:///artist/Sigur%20R%C3%B3s')).toMatchObject({ command: 'artist', segments: ['Sigur Rós'] });
    expect(chatLinkTarget('parachord://play?artist=Hovvdy&title=Bubble')).toMatchObject({ command: 'play', segments: [], params: { artist: 'Hovvdy', title: 'Bubble' } });
    expect(chatLinkTarget('parachord://queue/add?artist=A&title=B')).toMatchObject({ command: 'queue', segments: ['add'], params: { artist: 'A', title: 'B' } });
    for (const c of CHAT_PARACHORD_COMMANDS) expect(chatLinkTarget(`parachord://${c}/x`)).toMatchObject({ command: c });
  });

  test('a parachord:// command the chat doesn\'t handle is not a link', () => {
    expect(chatLinkTarget('parachord://settings/plugins')).toBeNull();
    expect(chatLinkTarget('parachord://import?url=https://example.com/x.xspf')).toBeNull();
    expect(chatLinkTarget('parachord://')).toBeNull();
    expect(chatLinkTarget('parachord://artist/%E0%A4%A')).toBeNull(); // a broken escape
  });

  test('the command list is the chat\'s switch, case for case', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = app.indexOf('const target = chatLinkTarget(');
    expect(start).toBeGreaterThan(0);
    const branch = app.slice(start, app.indexOf("} else if (r.type === 'bareurl')", start));
    const cases = [...branch.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).sort();
    expect(cases).toEqual([...CHAT_PARACHORD_COMMANDS].sort());
  });
});

describe('renderChatContent uses it', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = app.indexOf("} else if (r.type === 'link' || r.type === 'imagelink') {");
  const branch = app.slice(start, app.indexOf("} else if (r.type === 'bareurl')", start));

  test('a link that isn\'t allowed is plain text, and the href is only ever an allowed URL', () => {
    expect(branch).toMatch(/const target = chatLinkTarget\(r\.match\[2\]\);/);
    expect(branch).toMatch(/result\.push\(!target \? linkText :\s*React\.createElement\('a'/);
    expect(branch).toMatch(/href: target\.url,/);
    expect(branch).not.toMatch(/href: url,/);
  });

  test('the link opens the parsed target, never the raw text', () => {
    expect(branch).toMatch(/window\.electron\?\.shell\?\.openExternal\(target\.url\)/);
    expect(branch).not.toMatch(/new URL\(url\)/);
  });
});
