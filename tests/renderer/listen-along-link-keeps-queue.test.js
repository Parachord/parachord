/**
 * parachord://listen-along (#1343). Starting Listen Along in the app keeps the
 * queue, which plays on when the session ends (#1319); the link cleared it
 * first, so there was nothing to come back to. It also put a "Connecting to …"
 * placeholder in the playbar before checking that the friend was listening, so
 * a friend who wasn't left the placeholder there, and one who was put the
 * placeholder, not the track it replaced, on the play history.
 * Mobile: parachord-mobile#613 / #652.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const caseStart = app.indexOf("case 'listen-along': {");
const listenAlongCase = app.slice(caseStart, app.indexOf("case 'collection-radio':", caseStart));

describe('parachord://listen-along', () => {
  test('the case was found', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(listenAlongCase).toContain('activateListenAlongRef.current(friend);');
  });

  test('keeps the queue, like an in-app start', () => {
    expect(listenAlongCase).not.toContain('clearQueue(');
  });

  test('still ends a spinoff before starting', () => {
    expect(listenAlongCase).toMatch(/if \(spinoffModeRef\.current && exitSpinoffRef\.current\) \{\s*exitSpinoffRef\.current\(\);\s*\}\s*activateListenAlongRef\.current\(friend\);/);
  });

  test('puts no placeholder in the playbar before the friend check', () => {
    expect(app).not.toMatch(/command === 'listen-along' \|\|/);
    expect(app).not.toContain('`Connecting to ${params.user || \'friend\'}…` :');
    // The acknowledgement toast still says it.
    expect(app).toContain('Connecting to ${');
  });
});
