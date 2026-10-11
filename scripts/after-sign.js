/**
 * electron-builder afterSign hook.
 *
 * Windows: Widevine VMP signing has to follow Authenticode signing (see
 * vmp-sign.js). macOS: notarize, as before (scripts/notarize.js); its VMP
 * signing already ran in after-pack.js.
 */

const { vmpSign } = require('./vmp-sign');
const notarize = require('./notarize');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'win32') vmpSign(context);
  return notarize.default(context);
};
