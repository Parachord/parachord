// What the AI chat and MCP `control` tool does. The context's handlePause and
// handleResume are both the app's play/pause toggle, so calling one in the
// wrong state does the opposite of what was asked.
const { runPlaybackControl } = require('../../tools/playback-control');

const TRACK = { artist: 'Swapmeet', title: 'I Know!' };
const QUEUED = { artist: 'Tristan Barton', title: 'Interlude' };

function contextWith({ playing = false, current = null, queue = [] } = {}) {
  return {
    getIsPlaying: () => playing,
    getCurrentTrack: () => current,
    getQueue: () => queue,
    handlePause: jest.fn(),
    handleResume: jest.fn(),
    handleNext: jest.fn(),
    handlePrevious: jest.fn(),
    playTrack: jest.fn(async () => {})
  };
}

describe('resume', () => {
  test('a paused track resumes, and a queue behind it stays queued', async () => {
    const context = contextWith({ current: TRACK, queue: [QUEUED] });
    await expect(runPlaybackControl('resume', context)).resolves.toEqual({ success: true, action: 'resumed' });
    expect(context.handleResume).toHaveBeenCalledTimes(1);
    expect(context.playTrack).not.toHaveBeenCalled();
  });

  test('a track already playing keeps playing: the toggle would pause it', async () => {
    const context = contextWith({ playing: true, current: TRACK, queue: [QUEUED] });
    await expect(runPlaybackControl('resume', context)).resolves.toEqual({ success: true, action: 'resumed' });
    expect(context.handleResume).not.toHaveBeenCalled();
    expect(context.playTrack).not.toHaveBeenCalled();
  });

  test('nothing loaded starts the queue', async () => {
    const context = contextWith({ queue: [QUEUED, TRACK] });
    await expect(runPlaybackControl('resume', context)).resolves.toEqual({
      success: true, action: 'started', track: { artist: QUEUED.artist, title: QUEUED.title }
    });
    expect(context.playTrack).toHaveBeenCalledWith(QUEUED);
    expect(context.handleResume).not.toHaveBeenCalled();
  });

  test('nothing loaded and nothing queued says so', async () => {
    const context = contextWith();
    const result = await runPlaybackControl('resume', context);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing/i);
    expect(context.handleResume).not.toHaveBeenCalled();
  });
});

describe('pause', () => {
  test('a playing track pauses', async () => {
    const context = contextWith({ playing: true, current: TRACK });
    await expect(runPlaybackControl('pause', context)).resolves.toEqual({ success: true, action: 'paused' });
    expect(context.handlePause).toHaveBeenCalledTimes(1);
  });

  test('a paused track stays paused: the toggle would start it', async () => {
    const context = contextWith({ current: TRACK });
    await expect(runPlaybackControl('pause', context)).resolves.toEqual({ success: true, action: 'paused' });
    expect(context.handlePause).not.toHaveBeenCalled();
  });
});

describe('start', () => {
  test('plays the queue from its first track, even over a paused track', async () => {
    const context = contextWith({ current: TRACK, queue: [QUEUED] });
    await expect(runPlaybackControl('start', context)).resolves.toEqual({
      success: true, action: 'started', track: { artist: QUEUED.artist, title: QUEUED.title }
    });
    expect(context.playTrack).toHaveBeenCalledWith(QUEUED);
  });

  test('something already playing keeps playing', async () => {
    const context = contextWith({ playing: true, current: TRACK, queue: [QUEUED] });
    await expect(runPlaybackControl('start', context)).resolves.toEqual({ success: true, action: 'resumed' });
    expect(context.handleResume).not.toHaveBeenCalled();
    expect(context.playTrack).not.toHaveBeenCalled();
  });

  test('no queue resumes a paused track', async () => {
    const context = contextWith({ current: TRACK });
    await expect(runPlaybackControl('start', context)).resolves.toEqual({ success: true, action: 'resumed' });
    expect(context.handleResume).toHaveBeenCalledTimes(1);
  });

  test('no queue and no track says so', async () => {
    await expect(runPlaybackControl('start', contextWith())).resolves.toMatchObject({ success: false });
  });
});

describe('everything else', () => {
  test('skip and previous pass through', async () => {
    const context = contextWith({ playing: true, current: TRACK });
    await expect(runPlaybackControl('skip', context)).resolves.toEqual({ success: true, action: 'skipped' });
    expect(context.handleNext).toHaveBeenCalledTimes(1);
    await expect(runPlaybackControl('previous', context)).resolves.toEqual({ success: true, action: 'previous' });
    expect(context.handlePrevious).toHaveBeenCalledTimes(1);
  });

  test('an unknown action is an error', async () => {
    await expect(runPlaybackControl('rewind', contextWith())).resolves.toEqual({ success: false, error: 'Unknown action: rewind' });
  });
});

describe('both executors use it', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('app.js executeDjTool, which the AI chat and MCP dispatch through', () => {
    expect(app).toMatch(/case 'control':\s*return runPlaybackControl\(args\.action, context\);/);
  });

  test('the dj-tools registry, for pause and resume', async () => {
    const { getTool } = require('../../tools/dj-tools');
    const context = contextWith({ playing: true, current: TRACK, queue: [QUEUED] });
    await expect(getTool('control').execute({ action: 'resume' }, context)).resolves.toEqual({ success: true, action: 'resumed' });
    expect(context.handleResume).not.toHaveBeenCalled();
    await getTool('control').execute({ action: 'pause' }, context);
    expect(context.handlePause).toHaveBeenCalledTimes(1);
  });
});
