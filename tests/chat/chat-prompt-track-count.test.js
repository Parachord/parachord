/**
 * The chat system prompt's default mix length (parachord#1596).
 *
 * A mix, a playlist or "some songs" with no number used to come back at
 * whatever length the model liked. Both apps now say 10, in the same words:
 * mobile's ChatContextProvider.buildSystemPrompt() (parachord-mobile#755) is
 * a port of AI_CHAT_SYSTEM_PROMPT, and this line was the one place they
 * differed. Whether the model keeps to it can only be checked in a real
 * chat; this pins that the rule is there, worded as mobile's, right after the
 * rule against calling play and queue_add together.
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const start = source.indexOf('const AI_CHAT_SYSTEM_PROMPT = `');
const prompt = source.slice(start, source.indexOf('`;', start));

const TRACK_COUNT_RULE = '- HOW MANY TRACKS: A mix, playlist or "some songs" with no number given gets 10 tracks. If the user names a number, use exactly that number. An album gets all of its tracks.';

describe('chat system prompt: default mix length', () => {
  test('the prompt is found', () => {
    expect(start).toBeGreaterThan(-1);
    expect(prompt.length).toBeGreaterThan(1000);
  });

  test('says a mix with no number gets 10 tracks, in mobile\'s words', () => {
    expect(prompt).toContain(TRACK_COUNT_RULE);
  });

  test('sits right after the play + queue_add rule, as on mobile', () => {
    const lines = prompt.split('\n');
    const i = lines.findIndex((line) => line.startsWith('- NEVER use play + queue_add together'));
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toBe(TRACK_COUNT_RULE);
  });
});
