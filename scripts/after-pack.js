/**
 * electron-builder afterPack hook.
 *
 * macOS: Widevine VMP signing has to happen before Apple code signing, and
 * afterPack runs just before electron-builder signs. Windows signs VMP in
 * after-sign.js instead (it must follow Authenticode). See vmp-sign.js.
 */

const { vmpSign } = require('./vmp-sign');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') vmpSign(context);
};
