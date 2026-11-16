// src/renderer/lib/discord-presence-status.js: Settings' Discord Presence
// row: the words and the tone for each connection state main can report
// (see discord-presence-logic.js presenceStatus()). Moved out of app.js
// with the Settings page (#1451).

const DISCORD_PRESENCE_STATUS_LABELS = {
  'off': 'Off',
  'connected': 'Connected to Discord',
  'connecting': 'Connecting…',
  'discord-not-running': 'Discord is not running',
  'discord-not-responding': 'Discord is not responding',
  'not-configured': 'No Discord Application id configured',
  'invalid-client-id': 'Discord rejected the Application id',
  'rate-limited': 'Rate limited by Discord',
  'token-revoked': 'Discord revoked the connection',
  'invalid-version': 'Discord is too old for this build',
  'invalid-origin': 'Discord rejected the connection',
  'set-activity-failed': 'Discord refused the update',
  'dependency-missing': 'Discord support unavailable in this build',
  'disconnected': 'Disconnected — retrying',
  'error': 'Disconnected — retrying',
};

const DISCORD_PRESENCE_STATUS_TONES = {
  'connected': 'good',
  'connecting': 'warn',
  'off': 'neutral',
  'dependency-missing': 'warn',
};

const discordPresenceStatusTone = (status) => {
  if (DISCORD_PRESENCE_STATUS_TONES[status]) return DISCORD_PRESENCE_STATUS_TONES[status];
  return status === 'connected' ? 'good' : 'warn';
};

module.exports = { DISCORD_PRESENCE_STATUS_LABELS, DISCORD_PRESENCE_STATUS_TONES, discordPresenceStatusTone };
