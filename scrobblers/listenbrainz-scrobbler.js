// scrobblers/listenbrainz-scrobbler.js
// ListenBrainz scrobbler plugin - uses simple token authentication

import BaseScrobbler from './base-scrobbler.js';

class ListenBrainzScrobbler extends BaseScrobbler {
  constructor() {
    super('listenbrainz', 'ListenBrainz');
    this.apiBase = 'https://api.listenbrainz.org/1';
  }

  async isEnabled() {
    const config = await this.getConfig();
    return !!(config.enabled && config.userToken);
  }

  async updateNowPlaying(track) {
    const config = await this.getConfig();
    if (!config.userToken) {
      throw new Error('ListenBrainz token not configured');
    }

    const additionalInfo = {
      media_player: 'Parachord',
      submission_client: 'Parachord',
      submission_client_version: '1.0.0',
      duration_ms: track.duration ? track.duration * 1000 : undefined
    };
    if (track.mbid) additionalInfo.recording_mbid = track.mbid;
    if (track.artistMbids?.length > 0) additionalInfo.artist_mbids = track.artistMbids;
    if (track.releaseMbid) additionalInfo.release_mbid = track.releaseMbid;

    const payload = {
      listen_type: 'playing_now',
      payload: [{
        track_metadata: {
          artist_name: track.artist,
          track_name: track.title,
          release_name: track.album || undefined,
          additional_info: additionalInfo
        }
      }]
    };

    const response = await window.electron.proxyFetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenBrainz API error: ${response.status} - ${error}`);
    }

    return true;
  }

  async scrobble(track, timestamp) {
    const config = await this.getConfig();
    if (!config.userToken) {
      throw new Error('ListenBrainz token not configured');
    }

    const additionalInfo = {
      media_player: 'Parachord',
      submission_client: 'Parachord',
      submission_client_version: '1.0.0',
      duration_ms: track.duration ? track.duration * 1000 : undefined
    };
    if (track.mbid) additionalInfo.recording_mbid = track.mbid;
    if (track.artistMbids?.length > 0) additionalInfo.artist_mbids = track.artistMbids;
    if (track.releaseMbid) additionalInfo.release_mbid = track.releaseMbid;

    const payload = {
      listen_type: 'single',
      payload: [{
        listened_at: timestamp,
        track_metadata: {
          artist_name: track.artist,
          track_name: track.title,
          release_name: track.album || undefined,
          additional_info: additionalInfo
        }
      }]
    };

    const response = await window.electron.proxyFetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenBrainz API error: ${response.status} - ${error}`);
    }

    return true;
  }

  // Submit love feedback to ListenBrainz. Used by the optional opt-in
  // "push loved tracks" feature (see docs/plans/2026-05-03-loved-tracks-
  // scrobbler-push-design.md). LB requires a recording_mbid — caller is
  // responsible for resolving via track.mbid or the MBID Mapper before
  // calling. Returns { ok: true } or throws. /feedback/recording-feedback
  // does not accept a backdate; the remote stamps "loved at" the call time.
  async loveTrack(track) {
    const config = await this.getConfig();
    if (!config.userToken) {
      throw new Error('ListenBrainz token not configured');
    }
    if (!track?.mbid || !/^[a-f0-9-]{36}$/i.test(track.mbid)) {
      throw new Error('loveTrack requires track.mbid (36-char UUID)');
    }
    const response = await window.electron.proxyFetch(`${this.apiBase}/feedback/recording-feedback`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recording_mbid: track.mbid, score: 1 })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenBrainz love failed: ${response.status} - ${error}`);
    }
    return true;
  }

  // Validate token by fetching user info
  async validateToken(token) {
    const response = await window.electron.proxyFetch(`${this.apiBase}/validate-token`, {
      headers: {
        'Authorization': `Token ${token}`
      }
    });

    if (!response.ok) {
      return { valid: false, error: 'Invalid token' };
    }

    const data = await response.json();
    return {
      valid: data.valid,
      username: data.user_name,
      error: data.valid ? null : 'Token validation failed'
    };
  }

  // Connect with token
  async connect(token) {
    const validation = await this.validateToken(token);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid token');
    }

    await this.setConfig({
      enabled: true,
      userToken: token,
      username: validation.username,
      connectedAt: Date.now()
    });

    return { username: validation.username };
  }
}

export default ListenBrainzScrobbler;
