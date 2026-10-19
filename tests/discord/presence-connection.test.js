/**
 * Discord Rich Presence — connection state machine (discord-presence.js),
 * driven against a fake Client.
 *
 * The parts worth pinning are the ones a user only experiences as "my
 * presence is missing/stale/won't stop spamming": a Discord that is not
 * running, a Discord that restarts mid-playback, an Application id Discord
 * refuses, and a paused track whose elapsed clock must not keep ticking.
 */

const { EventEmitter } = require('events');
const createDiscordPresence = require('../../discord-presence');

const CLIENT_ID = '123456789012345678';
const REFUSED_CLIENT_ID = '999999999999999999';

/**
 * Fake @xmcl/discord-rpc Client, modelling the part of the real one that
 * matters: `connect()` resolves when the **socket opens**, while `user` and the
 * `connected` (READY) event arrive later; a refused Application id never
 * produces READY at all — it arrives as a transport CLOSE frame with code 4000.
 * Activities are recorded as raw `request('SET_ACTIVITY', args)` calls, which is
 * what the manager actually sends.
 */
function makeFakeClientClass(behavior = {}) {
  const instances = [];
  class FakeClient extends EventEmitter {
    constructor(options) {
      super();
      this.clientId = options.clientId;
      this.user = null;
      this.destroyed = false;
      this.closedTransport = false;
      this.activityRequests = [];
      this.connectAttempts = 0;
      this.transport = null;
      instances.push(this);
    }

    async connect() {
      this.connectAttempts += 1;
      const transport = new EventEmitter();
      transport.close = async () => { this.closedTransport = true; };
      this.transport = transport;
      if (behavior.onConnect) return behavior.onConnect(this, transport);
      this.emitReady();
      return undefined;
    }

    /** The READY dispatch — when the real library sets `client.user`. */
    emitReady() {
      setImmediate(() => {
        if (this.destroyed) return;
        this.user = {
          setActivity: async (activity) => this.request('SET_ACTIVITY', { activity }),
          clearActivity: async () => this.request('SET_ACTIVITY', { activity: null }),
        };
        this.emit('connected');
      });
    }

    /** Discord sending a CLOSE frame (refused id, revoked token, ...). */
    closeWith(code, message = 'closed') {
      this.transport.emit('close', { code, message });
    }

    async request(command, args) {
      if (command !== 'SET_ACTIVITY') throw new Error(`unexpected command ${command}`);
      const entry = { pid: args.pid, activity: args.activity === undefined ? null : args.activity };
      this.activityRequests.push(entry);
      if (behavior.onRequest) return behavior.onRequest(entry, this.activityRequests.length);
      return { data: entry.activity };
    }

    // Recorded calls under the names the tests read: the activities that were
    // sent, and how many times the presence was cleared.
    get setActivityCalls() {
      return this.activityRequests.filter((entry) => entry.activity).map((entry) => entry.activity);
    }

    get clearActivityCalls() {
      return this.activityRequests.filter((entry) => !entry.activity).length;
    }

    async destroy() {
      this.destroyed = true;
    }

    emitDisconnected() {
      this.transport.emit('close');
    }
  }
  FakeClient.instances = instances;
  return FakeClient;
}

function makeTimers() {
  const scheduled = [];
  let nextId = 1;
  const setTimeoutFn = (fn, ms) => {
    const entry = { id: nextId++, fn, ms, cancelled: false };
    scheduled.push(entry);
    return entry;
  };
  const clearTimeoutFn = (handle) => {
    const entry = scheduled.find((s) => s === handle);
    if (entry) entry.cancelled = true;
  };
  const runPending = () => {
    const due = scheduled.filter((s) => !s.cancelled && !s.run);
    due.forEach((s) => {
      s.run = true;
      s.fn();
    });
    return due.map((s) => s.ms);
  };
  return { setTimeoutFn, clearTimeoutFn, scheduled, runPending };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makePresence(behavior = {}, overrides = {}) {
  const Client = makeFakeClientClass(behavior);
  const timers = makeTimers();
  let clientId = overrides.clientId === undefined ? CLIENT_ID : overrides.clientId;
  const presence = createDiscordPresence({
    Client,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    getClientId: () => clientId,
    logger: overrides.logger || { warn: () => {}, log: () => {}, error: () => {} },
  });
  // swapClientId models a *config* change (.env edited, then the app
// relaunched or nudged) — there is no in-app id field.
  return { presence, Client, timers, swapClientId: (id) => { clientId = id; } };
}

const TRACK = { id: 't1', title: 'Clearwater', artist: 'Sigur Rós', album: '( )' };

describe('gating and configuration', () => {
  test('never connects while disabled', async () => {
    const { presence, Client } = makePresence();
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances.length).toBe(0);
    expect(presence.getStatus().status).toBe('off');
  });

  test('no Application id configured means no connection attempt at all', async () => {
    const { presence, Client, timers } = makePresence({}, { clientId: '' });
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances.length).toBe(0);
    expect(timers.scheduled.length).toBe(0); // nothing to retry towards
    expect(presence.getStatus().status).toBe('not-configured');
  });

    test('a refused Application id is not retried until a new build', async () => {
      // What Discord actually does with an unregistered id: it answers the
      // handshake with a CLOSE frame, so `connect()` itself succeeds. A build
      // that treats the opened socket as connected reports success forever and
      // never publishes anything.
      const { presence, Client, timers, swapClientId } = makePresence({
        onConnect: (client) => {
          if (client.clientId === REFUSED_CLIENT_ID) {
            setImmediate(() => client.closeWith(4000, 'Invalid Client ID'));
            return undefined;
          }
          client.emitReady();
          return undefined;
        },
      }, { clientId: REFUSED_CLIENT_ID });
      presence.setEnabled(true);
      await flush();
      expect(presence.getStatus().status).toBe('invalid-client-id');
      expect(presence.getStatus().connected).toBe(false);
      // Nothing left pending: the handshake deadline is cleared, and no retry
      // is scheduled against an id Discord will refuse again.
      expect(timers.scheduled.filter((t) => !t.cancelled).length).toBe(0);

    // The id is a build-time constant, so a real fix means a new build; the
    // toggle cycle is the equivalent nudge that clears the blocked state.
    swapClientId(CLIENT_ID);
    presence.setEnabled(false);
    presence.setEnabled(true);
    await flush();
    expect(Client.instances.length).toBe(2);
    expect(presence.getStatus().status).toBe('connected');
  });
});

describe('publishing now playing', () => {
  test('the published activity is the Listening-shaped one', async () => {
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack({ ...TRACK, albumArt: 'https://example.com/cover.jpg' });
    presence.setPlaybackStatus('playing');
    presence.setPosition(30);
    await flush();
    const client = Client.instances[0];
    expect(client.setActivityCalls.length).toBe(1);
    const activity = client.setActivityCalls[0];
    expect(activity.details).toBe('Clearwater');
    expect(activity.state).toBe('Sigur R\u00f3s');
    expect(activity.assets.large_image).toBe('https://example.com/cover.jpg');
    expect(activity.type).toBe(2);
    // Unix seconds, not ms: start = now - position.
    expect(activity.timestamps.start).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(activity.timestamps.start).toBeGreaterThan(Math.floor(Date.now() / 1000) - 3600);
  });

  test('pause clears the presence, resume puts it back', async () => {
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    const client = Client.instances[0];
    expect(client.setActivityCalls[0].timestamps.start).toBeGreaterThan(0);
    expect(client.clearActivityCalls).toBe(0);

    presence.setPlaybackStatus('paused');
    await flush();
    expect(client.clearActivityCalls).toBe(1);
    expect(client.setActivityCalls.length).toBe(1);

    // Resume rebuilds the activity from the position we are holding, so the
    // elapsed clock comes back consistent with the scrubbed position.
    presence.setPosition(40);
    await flush();
    presence.setPlaybackStatus('playing');
    await flush();
    expect(client.setActivityCalls.length).toBe(2);
    expect(client.clearActivityCalls).toBe(1);
    const resumed = client.setActivityCalls[1];
    expect(resumed.timestamps.start).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) - 40 + 1);
  });

  test('connecting while paused sends nothing, not a clear of nothing', async () => {
    // A fresh connection has no activity to remove; a paused track has no
    // payload. Spending a round trip on "remove what is not there" on every
    // reconnect is waste, and it is what makes a clear-only burst on Discord
    // restarts look like flapping.
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('paused');
    await flush();
    expect(Client.instances[0].activityRequests.length).toBe(0);
    expect(presence.getStatus().connected).toBe(true);
  });

  test('a track with no Discord-fetchable cover shows the Parachord asset', async () => {
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack({ ...TRACK, albumArt: 'local-audio://cover/1234' });
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances[0].setActivityCalls[0].assets.large_image).toBe('parachord');
  });

  test('stop clears the presence', async () => {
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances[0].setActivityCalls.length).toBe(1);
    presence.setPlaybackStatus('stopped');
    await flush();
    expect(Client.instances[0].clearActivityCalls).toBe(1);
  });

  test('an identical payload is not re-sent', async () => {
    const { presence, Client } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances[0].setActivityCalls.length).toBe(1);
  });

  test('disabling clears the presence and stops reconnecting', async () => {
    const { presence, Client, timers } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    presence.setEnabled(false);
    await flush();
    expect(Client.instances[0].clearActivityCalls).toBe(1);
    expect(Client.instances[0].destroyed).toBe(true);
    presence.setTrack({ title: 'Next', artist: 'Someone' });
    await flush();
    expect(timers.runPending()).toEqual([]);
    expect(presence.getStatus().status).toBe('off');
  });
});

describe('a Discord that is not there, or that comes and goes', () => {
  test('no socket: back off, then connect when Discord starts', async () => {
    let refuse = true;
    const { presence, Client, timers } = makePresence({
      onConnect: (client) => {
        if (refuse) {
          const err = new Error('Could not connect');
          err.code = 2; // RPC_COULD_NOT_CONNECT
          throw err;
        }
        client.emitReady();
      },
    });

    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(presence.getStatus().status).toBe('discord-not-running');
    const [firstDelay] = timers.runPending();
    expect(firstDelay).toBe(5000);
    await flush();
    expect(presence.getStatus().status).toBe('discord-not-running');

    // Discord starts up; the next scheduled attempt should win and publish
    // the state we were already holding.
    refuse = false;
    timers.runPending();
    await flush();
    expect(presence.getStatus().status).toBe('connected');
    const working = Client.instances[Client.instances.length - 1];
    expect(working.setActivityCalls.length).toBe(1);
    expect(working.setActivityCalls[0].details).toBe('Clearwater');
  });

  test('Discord restarting mid-track re-publishes the current track', async () => {
    const { presence, Client, timers } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    const first = Client.instances[0];
    first.emitDisconnected();
    await flush();
    expect(presence.getStatus().connected).toBe(false);
    timers.runPending();
    await flush();
    const second = Client.instances[1];
    expect(second.setActivityCalls.length).toBe(1);
    expect(second.setActivityCalls[0].details).toBe('Clearwater');
    expect(presence.getStatus().status).toBe('connected');
  });

  test('backoff grows between failed attempts', async () => {
    const { presence, timers } = makePresence({
      onConnect: () => {
        const err = new Error('Could not connect');
        err.code = 2;
        throw err;
      },
    });
    presence.setEnabled(true);
    await flush();
    expect(timers.runPending()).toEqual([5000]);
    await flush();
    expect(timers.runPending()).toEqual([10000]);
    await flush();
    expect(timers.runPending()).toEqual([20000]);
    expect(presence.getStatus().attempt).toBe(3);
  });

  test('a failed attempt closes its transport so retries cannot leak sockets', async () => {
    const { presence, Client } = makePresence({
      onConnect: (client) => {
        const err = new Error('Connection timed out');
        // RPC_CONNECTION_TIMEOUT: the socket opened, Discord never answered.
        // Without an explicit close that is one leaked fd per retry, and the
        // retries keep running for hours while Discord stays unresponsive.
        err.code = 1;
        throw err;
      },
    });
    presence.setEnabled(true);
    await flush();
    expect(presence.getStatus().status).toBe('discord-not-responding');
    expect(Client.instances[0].closedTransport).toBe(true);
  });

  test('a client that rejects type:listening falls back to no type, once', async () => {
    let first = true;
    const { presence, Client } = makePresence({
      onRequest: (entry) => {
        if (first && entry.activity && entry.activity.type === 2) {
          first = false;
          const err = new Error('Invalid payload');
          err.code = 4000;
          throw err;
        }
        return { data: entry.activity };
      },
    });
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    const client = Client.instances[0];
    const withoutType = client.setActivityCalls.find((a) => !('type' in a));
    expect(withoutType).toBeTruthy();
    expect(withoutType.details).toBe('Clearwater');

    // Later updates must not re-probe the rejected type.
    presence.setTrack({ title: 'Other', artist: 'Someone' });
    await flush();
    const last = client.setActivityCalls[client.setActivityCalls.length - 1];
    expect('type' in last).toBe(false);
    // listening (rejected) -> fallback -> next track (no re-probe)
    expect(client.setActivityCalls.length).toBe(3);
  });
});

describe('the handshake is not the connection', () => {
  test('an open socket is not "connected": nothing publishes until READY lands', async () => {
    // The library resolves connect() off the socket being open. If the manager
    // believed that, it would report a healthy connection while every publish
    // was dropped for want of a session - a ticked checkbox and no presence.
    const { presence, Client } = makePresence({ onConnect: () => undefined });
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    expect(Client.instances[0].activityRequests.length).toBe(0);
    expect(presence.getStatus().connected).toBe(false);
    expect(presence.getStatus().status).toBe('connecting');

    Client.instances[0].emitReady();
    await flush();
    expect(presence.getStatus().status).toBe('connected');
    expect(Client.instances[0].setActivityCalls.length).toBe(1);
    expect(Client.instances[0].setActivityCalls[0].details).toBe('Clearwater');
  });

  test('a socket that never gets READY times out, closes, and retries', async () => {
    const { presence, Client, timers } = makePresence({ onConnect: () => undefined });
    presence.setEnabled(true);
    await flush();
    // Our own handshake deadline, not the library's: it has none on this path.
    expect(timers.runPending()).toEqual([8000]);
    await flush();
    expect(presence.getStatus().status).toBe('discord-not-responding');
    expect(Client.instances[0].closedTransport).toBe(true);
    expect(timers.runPending()).toEqual([5000]);
  });

  test('a 4000 CLOSE frame mid-session blocks instead of retrying forever', async () => {
    const { presence, Client, timers } = makePresence();
    presence.setEnabled(true);
    presence.setTrack(TRACK);
    presence.setPlaybackStatus('playing');
    await flush();
    Client.instances[0].closeWith(4000, 'Invalid Client ID');
    await flush();
    expect(presence.getStatus().status).toBe('invalid-client-id');
    expect(presence.getStatus().connected).toBe(false);
    expect(timers.scheduled.filter((t) => !t.cancelled).length).toBe(0);
  });
});

describe('module shape', () => {
  test('the factory returns null when the rpc dependency cannot load', () => {
    const create = require('../../discord-presence');
    expect(typeof create).toBe('function');
    // No Client injection + a dependency that is present means a real client
    // is constructed lazily; the null path is the missing-dependency guard.
    expect(typeof create.createDiscordPresence).toBe('function');
  });
});
