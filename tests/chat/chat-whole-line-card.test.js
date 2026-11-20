/**
 * renderChatContent's whole-line card check (#1574): a line that is one card
 * renders as that card; a line with two cards and text between them is left
 * to the inline parser, which draws both.
 */
const fs = require('fs');
const path = require('path');
const { CARD_INLINE_REGEX, wholeLineCard } = require('../../src/renderer/lib/chat-card-syntax');

const inlineCards = (text) => Array.from(text.matchAll(new RegExp(CARD_INLINE_REGEX.source, 'g')))
  .map((m) => ({ type: m[1], parts: m[2].split('|') }));

describe('wholeLineCard', () => {
  test('a line that is one card is that card', () => {
    expect(wholeLineCard('{{track|Creep|Radiohead|Pablo Honey}}'))
      .toEqual({ type: 'track', parts: ['Creep', 'Radiohead', 'Pablo Honey'] });
    expect(wholeLineCard('{{artist|Björk}}')).toEqual({ type: 'artist', parts: ['Björk'] });
  });

  test('two cards with text between them are not one card', () => {
    expect(wholeLineCard('{{track|A|X}} and {{track|B|Y}}')).toBeNull();
    expect(wholeLineCard('{{album|OK Computer|Radiohead}} / {{album|Kid A|Radiohead}}')).toBeNull();
  });

  test('text around a card is not a whole-line card', () => {
    expect(wholeLineCard('Try {{track|A|X}}')).toBeNull();
    expect(wholeLineCard('plain text')).toBeNull();
    expect(wholeLineCard(undefined)).toBeNull();
  });

  test('the inline parser then finds both cards', () => {
    expect(inlineCards('{{track|A|X}} and {{track|B|Y}}')).toEqual([
      { type: 'track', parts: ['A', 'X'] },
      { type: 'track', parts: ['B', 'Y'] },
    ]);
  });
});

describe('renderChatContent uses the shared card syntax', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('no greedy whole-line card pattern is left in app.js', () => {
    expect(app).not.toMatch(/\(track\|artist\|album\|playlist\)\\\|\(\.\+\)/);
  });

  test('the whole-line check and the inline pattern come from chat-card-syntax', () => {
    expect(app).toMatch(/require\('\.\/lib\/chat-card-syntax'\)/);
    expect(app).toMatch(/wholeLineCard\(processedLine\)/);
    expect(app).toMatch(/regex: new RegExp\(CARD_INLINE_REGEX\.source, 'g'\), type: 'card'/);
  });
});
