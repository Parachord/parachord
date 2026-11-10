/**
 * The periodic friend-graph sync (new Last.fm / ListenBrainz friends). It
 * used to run on every 15th tick of the friend-activity poll, which only runs
 * once a friend is saved or pinned, so with no friends yet a follow made
 * mid-session never arrived until a restart. It now has its own 30-minute
 * timer, gated on a configured Last.fm or ListenBrainz username.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

// The activity-poll effect: from its setInterval to its dependency array.
const pollStart = app.indexOf('friendPollIntervalRef.current = setInterval(');
const pollEnd = app.indexOf('}, [pinnedFriendIds.length, hasSavedFriends, listenAlongFriend]);', pollStart);
const activityPoll = app.slice(pollStart, pollEnd);

describe('periodic friend-graph sync', () => {
  test('the activity poll no longer carries it', () => {
    expect(pollStart).toBeGreaterThan(-1);
    expect(pollEnd).toBeGreaterThan(pollStart);
    expect(activityPoll).not.toMatch(/syncFriendsFromServices/);
    expect(app).not.toMatch(/friendSyncTickCounterRef|SYNC_TICK_INTERVAL/);
  });

  test('runs every 30 minutes on its own timer, gated only on a Last.fm or ListenBrainz account', () => {
    expect(app).toMatch(/const FRIEND_GRAPH_SYNC_MS = 30 \* 60 \* 1000;/);
    expect(app).toMatch(/const hasFriendServiceAccount = !!\(metaServiceConfigs\.lastfm\?\.username \|\| metaServiceConfigs\.listenbrainz\?\.username\);/);
    expect(app).toMatch(/if \(!cacheLoaded \|\| !hasFriendServiceAccount\) return;\s*const id = setInterval\(\(\) => \{\s*syncFriendsFromServicesRef\.current\?\.\(\{ silent: true \}\);\s*\}, FRIEND_GRAPH_SYNC_MS\);\s*return \(\) => clearInterval\(id\);\s*\}, \[cacheLoaded, hasFriendServiceAccount\]\);/);
  });

  test('the timer calls the latest sync function, not the one from the render that started it', () => {
    expect(app).toMatch(/syncFriendsFromServicesRef\.current = syncFriendsFromServices;/);
  });
});

describe('Friends tab sync', () => {
  test('opening the Collection Friends tab syncs, unless a sync started in the last 5 minutes', () => {
    expect(app).toMatch(/const FRIEND_TAB_SYNC_MIN_GAP_MS = 5 \* 60 \* 1000;/);
    expect(app).toMatch(/if \(activeView !== 'library' \|\| collectionTab !== 'friends'\) return;\s*if \(Date\.now\(\) - lastFriendSyncAtRef\.current < FRIEND_TAB_SYNC_MIN_GAP_MS\) return;\s*syncFriendsFromServicesRef\.current\?\.\(\{ silent: true \}\);\s*\}, \[activeView, collectionTab, cacheLoaded, hasFriendServiceAccount\]\);/);
  });

  test('every sync records when it started, and the startup sync skips one that just ran', () => {
    expect(app).toMatch(/const syncFriendsFromServices = async \(\{ silent = true \} = \{\}\) => \{\s*if \(friendSyncInProgress\) return 0;\s*lastFriendSyncAtRef\.current = Date\.now\(\);/);
    expect(app).toMatch(/setTimeout\(\(\) => \{\s*if \(Date\.now\(\) - lastFriendSyncAtRef\.current < FRIEND_TAB_SYNC_MIN_GAP_MS\) return;\s*syncFriendsFromServicesRef\.current\?\.\(\{ silent: true \}\);\s*\}, 5000\);/);
  });
});
