// src/renderer/lib/meta-service.js: a meta-service plug-in (AI, scrobbling,
// recommendations, concerts, artist info) as the app keeps it in its
// metaServices list, built from its .axe.
//
// Three paths built this object by hand (startup, a marketplace sync's
// reload, an install) and none carried `requirement`, so a meta service's
// "Needs …" line never reached its settings dialog while every music
// plug-in's did (#1498). One builder now, with `requirement` read the way
// resolver-loader.js reads it for music plug-ins: the trimmed sentence, or
// null when there is none. Pure; loads under plain Node.

'use strict';

function metaServiceFromAxe(axe, filename) {
  const m = (axe && axe.manifest) || {};
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    version: m.version,
    author: m.author,
    description: m.description,
    requirement: typeof m.requirement === 'string' && m.requirement.trim() ? m.requirement.trim() : null,
    icon: m.icon,
    color: m.color,
    homepage: m.homepage,
    capabilities: axe.capabilities,
    settings: axe.settings,
    _filename: filename !== undefined ? filename : axe._filename,
  };
}

module.exports = { metaServiceFromAxe };
