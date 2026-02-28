const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PARACHORD_PORT || '3000', 10),
  host: process.env.PARACHORD_HOST || '0.0.0.0',
  dataDir: process.env.PARACHORD_DATA_DIR || path.join(require('os').homedir(), '.parachord-server'),
  pluginDirs: [
    path.resolve(__dirname, '../../plugins'),  // bundled plugins
  ],

  get(key) {
    return process.env[key];
  }
};

// Add user plugin dir (inside data dir)
config.pluginDirs.push(path.join(config.dataDir, 'plugins'));

module.exports = config;
