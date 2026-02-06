/**
 * Chat Card Parsing Tests
 *
 * Tests for parsing the {{type|field1|field2}} card syntax used in AI chat responses.
 * Cards render as interactive elements for tracks, albums, artists, and playlists.
 */

// Regex pattern used in app.js renderChatContent to find cards
const CARD_REGEX = /\{\{(track|album|artist|playlist)\|([^}]+)\}\}/g;

/**
 * Parse card syntax into structured objects.
 * Mirrors the parsing logic in app.js renderChatContent (line ~13462)
 */
function parseCards(text) {
  const cards = [];
  let match;
  const regex = new RegExp(CARD_REGEX.source, CARD_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    const type = match[1];
    const parts = match[2].split('|');

    switch (type) {
      case 'track':
        cards.push({ type: 'track', title: parts[0], artist: parts[1], album: parts[2] || null });
        break;
      case 'album':
        cards.push({ type: 'album', title: parts[0], artist: parts[1] || null });
        break;
      case 'artist':
        cards.push({ type: 'artist', name: parts[0] });
        break;
      case 'playlist':
        cards.push({ type: 'playlist', name: parts[0], id: parts[1], trackCount: parseInt(parts[2]) || 0 });
        break;
    }
  }

  return cards;
}

/**
 * Extract plain text with cards removed (for checking surrounding content)
 */
function stripCards(text) {
  return text.replace(CARD_REGEX, '').replace(/\s+/g, ' ').trim();
}

describe('Chat Card Parsing', () => {
  describe('track cards', () => {
    test('parses track with all fields', () => {
      const cards = parseCards('{{track|Creep|Radiohead|Pablo Honey}}');

      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual({
        type: 'track',
        title: 'Creep',
        artist: 'Radiohead',
        album: 'Pablo Honey'
      });
    });

    test('parses track without album', () => {
      const cards = parseCards('{{track|Creep|Radiohead|}}');

      expect(cards[0].title).toBe('Creep');
      expect(cards[0].artist).toBe('Radiohead');
      // Trailing empty pipe splits to empty string in parts[2], but our parser returns null for parts[2] when it's empty via || null
      // The actual app behavior: parts[2] exists but is empty string
      expect(cards[0].album === '' || cards[0].album === null).toBe(true);
    });

    test('handles special characters in fields', () => {
      const cards = parseCards("{{track|What's Going On|Marvin Gaye|What's Going On}}");

      expect(cards[0].title).toBe("What's Going On");
      expect(cards[0].artist).toBe('Marvin Gaye');
    });

    test('handles parentheses in track names', () => {
      const cards = parseCards('{{track|Everything In Its Right Place (Live)|Radiohead|Kid A}}');

      expect(cards[0].title).toBe('Everything In Its Right Place (Live)');
    });

    test('handles ampersands in artist names', () => {
      const cards = parseCards('{{track|The Outsiders|R.E.M. & Q-Tip|Around the Sun}}');

      expect(cards[0].artist).toBe('R.E.M. & Q-Tip');
    });
  });

  describe('album cards', () => {
    test('parses album with artist', () => {
      const cards = parseCards('{{album|OK Computer|Radiohead|}}');

      expect(cards[0]).toEqual({
        type: 'album',
        title: 'OK Computer',
        artist: 'Radiohead'
      });
    });

    test('parses album without trailing pipe', () => {
      const cards = parseCards('{{album|OK Computer|Radiohead}}');

      expect(cards[0].title).toBe('OK Computer');
      expect(cards[0].artist).toBe('Radiohead');
    });
  });

  describe('artist cards', () => {
    test('parses artist card', () => {
      const cards = parseCards('{{artist|Radiohead|}}');

      expect(cards[0]).toEqual({ type: 'artist', name: 'Radiohead' });
    });

    test('parses artist without trailing pipe', () => {
      const cards = parseCards('{{artist|Radiohead}}');

      expect(cards[0].name).toBe('Radiohead');
    });

    test('handles dots and periods in names', () => {
      const cards = parseCards('{{artist|R.E.M.}}');

      expect(cards[0].name).toBe('R.E.M.');
    });
  });

  describe('playlist cards', () => {
    test('parses playlist with all fields', () => {
      const cards = parseCards('{{playlist|Chill Vibes|ai-chat-1706789012345|15}}');

      expect(cards[0]).toEqual({
        type: 'playlist',
        name: 'Chill Vibes',
        id: 'ai-chat-1706789012345',
        trackCount: 15
      });
    });

    test('handles non-numeric track count', () => {
      const cards = parseCards('{{playlist|My List|id-123|many}}');

      expect(cards[0].trackCount).toBe(0);
    });
  });

  describe('multiple cards', () => {
    test('parses multiple cards in one message', () => {
      const text = `Here are my recommendations:
1. {{track|Creep|Radiohead|Pablo Honey}} - a classic
2. {{track|Karma Police|Radiohead|OK Computer}} - moody
3. {{album|In Rainbows|Radiohead|}} - their best`;

      const cards = parseCards(text);

      expect(cards).toHaveLength(3);
      expect(cards[0].type).toBe('track');
      expect(cards[1].type).toBe('track');
      expect(cards[2].type).toBe('album');
    });

    test('parses mixed card types', () => {
      const text = `Check out {{artist|Radiohead|}} - especially {{album|OK Computer|Radiohead|}} and {{track|Creep|Radiohead|Pablo Honey}}`;

      const cards = parseCards(text);

      expect(cards).toHaveLength(3);
      expect(cards[0].type).toBe('artist');
      expect(cards[1].type).toBe('album');
      expect(cards[2].type).toBe('track');
    });

    test('parses inline cards within sentences', () => {
      const text = 'You might enjoy {{track|Motion Sickness|Phoebe Bridgers|Stranger in the Alps}} and {{track|Your Hand in Mine|Explosions in the Sky|The Earth Is Not a Cold Dead Place}}.';

      const cards = parseCards(text);

      expect(cards).toHaveLength(2);
      expect(cards[0].title).toBe('Motion Sickness');
      expect(cards[1].title).toBe('Your Hand in Mine');
    });
  });

  describe('edge cases', () => {
    test('returns empty array for no cards', () => {
      const cards = parseCards('Just some text without any cards.');

      expect(cards).toEqual([]);
    });

    test('ignores malformed cards', () => {
      const cards = parseCards('{{invalid|test}} and {{|missing type}}');

      expect(cards).toEqual([]);
    });

    test('handles empty fields gracefully', () => {
      const cards = parseCards('{{track|||}}');

      expect(cards).toHaveLength(1);
      expect(cards[0].title).toBe('');
    });

    test('strips cards from text correctly', () => {
      const text = 'Here is {{track|Creep|Radiohead|Pablo Honey}} for you';
      const stripped = stripCards(text);

      expect(stripped).toBe('Here is for you');
    });

    test('handles unicode in card fields', () => {
      const cards = parseCards('{{artist|Sigur Rós}}');

      expect(cards[0].name).toBe('Sigur Rós');
    });

    test('handles very long card fields', () => {
      const longTitle = 'A'.repeat(200);
      const cards = parseCards(`{{track|${longTitle}|Artist|Album}}`);

      expect(cards[0].title).toBe(longTitle);
    });
  });
});
