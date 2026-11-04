// What the AI chat and MCP `queue_add` tool does.
//
// With nothing playing, it starts the first track it can find rather than ending
// a request to play something in silence. That means an album can start on its
// second track, so `notFound` lists what was skipped and the AI can say so. This
// matches mobile (parachord-mobile#525).
//
// Tracks after the one that starts aren't looked up: they go in as metadata for
// the queue's ResolutionScheduler, so `notFound` can't cover them. With something
// already playing, nothing is looked up at all.

const { pickTrackMatch } = require('../sync-providers/track-match');

async function runQueueAdd(args, context) {
  const currentTrack = context.getCurrentTrack();
  const notFound = [];
  let startedPlaying = false;
  let tracksToQueue = args.tracks;

  // Deduplicate: if the first track in the list matches what's currently playing,
  // skip it to avoid double-play (models often call play + queue_add with overlapping tracks)
  if (currentTrack && tracksToQueue.length > 0) {
    const first = tracksToQueue[0];
    if (first.artist?.toLowerCase() === currentTrack.artist?.toLowerCase() &&
        first.title?.toLowerCase() === currentTrack.title?.toLowerCase()) {
      tracksToQueue = tracksToQueue.slice(1);
    }
  }

  if (!currentTrack) {
    while (tracksToQueue.length > 0 && !startedPlaying) {
      const [track, ...rest] = tracksToQueue;
      tracksToQueue = rest;
      const results = await context.search(`${track.artist} ${track.title}`, {
        earlyReturn: true,
        targetArtist: track.artist,
        targetTitle: track.title
      });
      const match = pickTrackMatch(results, track.artist, track.title);
      if (match) {
        await context.playTrack(match);
        startedPlaying = true;
      } else {
        notFound.push({ artist: track.artist, title: track.title });
      }
    }
  }

  if (tracksToQueue.length > 0) {
    const metadataTracks = tracksToQueue.map(t => ({
      artist: t.artist,
      title: t.title,
      album: t.album || null
    }));
    await context.addToQueue(metadataTracks, args.position || 'last');
  }

  const added = tracksToQueue.length + (startedPlaying ? 1 : 0);
  return {
    success: added > 0,
    added,
    nowPlaying: startedPlaying,
    ...(notFound.length > 0 ? { notFound } : {}),
    ...(notFound.length > 0 && added === 0 ? { error: 'Could not find any of the requested tracks' } : {})
  };
}

module.exports = { runQueueAdd };
