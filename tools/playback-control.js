// What the AI chat and MCP `control` tool does.
//
// The context's handlePause and handleResume are both the app's play/pause
// toggle, so they must only run in the state they change: pausing a paused
// track would start it, and resuming a playing one would pause it.
//
// resume means "carry on with this track". Only when nothing is loaded does it
// start the queue. start means "play the queue from its first track".

async function startQueue(context) {
  const [first] = context.getQueue() || [];
  if (!first) return null;
  await context.playTrack(first);
  return { success: true, action: 'started', track: { artist: first.artist, title: first.title } };
}

const NOTHING_TO_PLAY = { success: false, error: 'Nothing to play: no track is loaded and the queue is empty' };

async function resume(context) {
  if (context.getIsPlaying()) return { success: true, action: 'resumed' };
  if (context.getCurrentTrack()) {
    context.handleResume();
    return { success: true, action: 'resumed' };
  }
  return (await startQueue(context)) || NOTHING_TO_PLAY;
}

async function runPlaybackControl(action, context) {
  switch (action) {
    case 'pause':
      if (context.getIsPlaying()) context.handlePause();
      return { success: true, action: 'paused' };
    case 'resume':
      return resume(context);
    case 'start':
      if (context.getIsPlaying()) return { success: true, action: 'resumed' };
      return (await startQueue(context)) || resume(context);
    case 'skip':
      context.handleNext();
      return { success: true, action: 'skipped' };
    case 'previous':
      context.handlePrevious();
      return { success: true, action: 'previous' };
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

module.exports = { runPlaybackControl };
