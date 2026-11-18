// src/renderer/components/home-getting-started.js: Home's getting-started
// layout (#1493), shown in place of the normal sections until setup is done
// or skipped. One card holds the whole path, three steps, each done, current
// or not yet; the current one is open and any one can be opened. Below it,
// "Explore while you set up" (Critical Darlings and Pop of the Tops, the two
// discovery pages that load with no setup; home-sections.js ExploreRow).
//
// Props-driven: Home passes the model (lib/getting-started.js) and the
// actions. Built from the shared pieces: ListRow for the step headers,
// OptionTile for every choice inside a step, Badge for a tile's state,
// Button, CollectionRadioButton. Loads under plain Node.

const Icons = require('./icons');
const { Button } = require('./button');
const { Badge } = require('./badge');
const { ListRow } = require('./list-row');
const { OptionTile } = require('./option-tile');
const { SERVICE_LOGOS } = require('./brand-logos');
const { CollectionRadioButton } = require('./collection-radio-button');
const { BrandMark } = require('./brand-logos');
const { PAGE_COLORS } = require('../lib/page-colors');
const { PAGE_ICONS } = require('../lib/page-icons');
const { countOf } = require('../lib/plural');

const e = React.createElement;

// The phone apps' beta links (parachord.com's).
const MOBILE_LINKS = {
  ios: 'https://testflight.apple.com/join/zXvg5zxK',
  android: 'https://play.google.com/store/apps/details?id=com.parachord.android',
};

const STEPS = [
  { id: 'connect', title: 'Connect where you listen' },
  { id: 'music', title: 'Bring in your music' },
  { id: 'listen', title: 'Start listening' },
];

// Shared between the layout and its skeleton, so content replaces the
// skeleton without a jump.
const CARD_STYLE = {
  borderRadius: '16px', border: '1px solid var(--border-default)', backgroundColor: 'var(--card-bg)',
  boxShadow: 'var(--card-shadow)', overflow: 'hidden',
};
const STEP_GRID = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderBottom: '1px solid var(--border-subtle)' };
const STEP_HEADER_HEIGHT = 64;
const PANEL_STYLE = { padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' };
// Choice tiles: as many 200px tiles as fit (three across in the 744px
// content of the 1000px window, four or more when wider).
const TILE_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' };
const TILE_HEIGHT = 68;
const GROUP_LABEL = { margin: '0 0 8px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' };
const LINE = { margin: 0, fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 };

// The step's marker: a check when done, its number otherwise (accent when
// it's the current one).
function StepMarker({ index, done, current }) {
  const look = done
    ? { backgroundColor: 'var(--fill-success)', color: 'var(--on-accent)' }
    : current
      ? { backgroundColor: 'var(--accent-fill)', color: 'var(--on-accent)' }
      : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' };
  return e('span', {
    'aria-hidden': 'true',
    style: Object.assign({
      width: '28px', height: '28px', borderRadius: '9999px', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600,
    }, look),
  }, done ? e(Icons.Check, { size: 16 }) : String(index + 1));
}

// A service's logo on its own colour, the Plug-Ins tile's look in small:
// the same SERVICE_LOGOS mark, drawn at 22px.
const isWide = (logo) => {
  const box = String((logo.props && logo.props.viewBox) || '').split(/\s+/).map(Number);
  return box.length === 4 && box[3] > 0 && box[2] / box[3] > 1.5;
};
function ServiceMark({ resolver }) {
  const logo = SERVICE_LOGOS[resolver.id];
  return e('span', {
    style: {
      width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: resolver.color || 'var(--fill-neutral)', color: 'var(--on-accent)',
    },
  }, logo
    // A wide mark (Libre.fm's wordmark) gets the tile's width, not 22px.
    ? React.cloneElement(logo, { className: undefined, style: Object.assign({}, logo.props.style, isWide(logo) ? { width: '30px', height: '30px' } : { width: '22px', height: '22px' }) })
    : e(Icons.Music, { size: 18 }));
}

// A choice that leads to one of the app's pages: that page's icon
// (PAGE_ICONS) in white on its colour (PAGE_COLORS fill), the way a
// service's tile is its logo on its colour. With no page, the neutral fill.
function IconMark({ page, icon }) {
  const Icon = icon || (page && Icons[PAGE_ICONS[page]]) || Icons.Music;
  return e('span', {
    style: {
      width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: page && PAGE_COLORS[page] ? PAGE_COLORS[page].fill : 'var(--fill-neutral)', color: 'var(--on-accent)',
    },
  }, e(Icon, { size: 18 }));
}

function Tile(props) {
  return e(OptionTile, Object.assign({ style: { minHeight: `${TILE_HEIGHT}px` } }, props));
}

function Group({ label, children }) {
  return e('div', null,
    label && e('h4', { style: GROUP_LABEL }, label),
    e('div', { style: TILE_GRID }, children));
}

// ------------------------------------------------------------------ steps

// A note under a step's tiles: an icon, a line, and its links.
function StepNote({ icon: Icon, children, actions }) {
  return e('div', { className: 'border border-line', style: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', borderRadius: '12px' } },
    e('span', { 'aria-hidden': 'true', className: 'text-ink-tertiary', style: { display: 'inline-flex', marginTop: '2px' } }, e(Icon, { size: 18 })),
    e('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 } },
      e('p', { style: Object.assign({}, LINE, { fontSize: '13px' }) }, children),
      actions && e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginLeft: '-12px' } }, actions)));
}

function ConnectStep({ plugins, serviceStates, watchFolders, onConnect, onOpenPlugin, onAddFolder, onBrowsePlugins, onOpenQuality }) {
  const folders = Array.isArray(watchFolders) ? watchFolders.length : 0;
  const folder = plugins.folder;
  return e(React.Fragment, null,
    e('p', { style: LINE }, 'Sign in to the services you use, and your own music server if you have one. Parachord finds each song wherever you have it and plays it here.'),
    e(Group, { label: 'Services' },
      plugins.services.map((r) => {
        const s = serviceStates[r.id] || { state: 'connect' };
        const description = s.state === 'connected'
          ? e(Badge, { tone: 'accent', icon: Icons.Check }, 'Connected')
          : (s.state === 'limited' || s.state === 'setup') ? s.label : 'Connect';
        const ariaLabel = s.state === 'connect' ? `Connect ${r.name}`
          : s.state === 'setup' ? `Set up ${r.name}: ${s.label.toLowerCase()}`
            : `${r.name}: ${s.state === 'connected' ? 'connected' : s.label}`;
        return e(Tile, {
          key: r.id,
          icon: e(ServiceMark, { resolver: r }),
          title: r.name,
          description,
          'aria-label': ariaLabel,
          // Connect runs the sign-in (or opens the panel when a setting is
          // needed first); a connected or limited tile opens its panel.
          onClick: () => ((s.state === 'connect' || s.state === 'setup') ? onConnect(r.id) : onOpenPlugin(r.id)),
        });
      }),
      e(Tile, {
        key: 'more', icon: e(IconMark, { icon: Icons.Plus }), title: 'More plug-ins', description: 'Browse',
        onClick: onBrowsePlugins,
      })),
    (folder || plugins.free.length > 0) && e(Group, { label: 'On already, no account needed' },
      folder && e(Tile, {
        key: 'folder',
        // The Local Files plug-in's own colour and logo, as on Plug-Ins.
        icon: e(ServiceMark, { resolver: folder }),
        title: 'Your music folder',
        // Local Files can be switched off on Plug-Ins: say so, never "On".
        description: `${folder.active === false ? 'Off' : 'On'} · ${folders > 0 ? countOf(folders, 'folder') : 'Add a folder'}`,
        'aria-label': folders > 0 ? `Your music folder: ${countOf(folders, 'folder')}. Add another` : 'Add a music folder',
        onClick: onAddFolder,
      }),
      plugins.free.map((r) => e(Tile, {
        key: r.id,
        icon: e(ServiceMark, { resolver: r }),
        title: r.name,
        description: r.active ? 'On' : 'Off',
        onClick: () => onOpenPlugin(r.id),
      }))),
    // Below every source: the order decides which plays, and quality is one
    // setting for all of them (never a per-service one).
    e(StepNote, {
      icon: Icons.ListOrdered,
      actions: [
        e(Button, { key: 'order', variant: 'text', size: 'sm', onClick: onBrowsePlugins }, 'Set the order'),
        e(Button, { key: 'quality', variant: 'text', size: 'sm', onClick: onOpenQuality }, 'Sound quality'),
      ],
    }, 'With more than one source, Parachord plays each song from the first one in your order that has it. Drag plug-ins to change the order, and pick your sound quality, up to lossless and Dolby Atmos where a service offers them.'));
}

function MusicStep({ scrobblers, scrobblerStates, onImportLink, onSyncLibrary, onOpenPlugin }) {
  return e(React.Fragment, null,
    e('p', { style: LINE }, 'Bring in your playlists and liked songs, and your listening history for recommendations and friends.'),
    e(Group, { label: 'Playlists and liked songs' },
      e(Tile, {
        key: 'link', icon: e(IconMark, { page: 'playlists' }), title: 'Import a playlist', description: 'Paste a link from any service',
        onClick: onImportLink,
      }),
      e(Tile, {
        key: 'sync', icon: e(IconMark, { page: 'library' }), title: 'Sync your library', description: 'From a service you connected',
        onClick: onSyncLibrary,
      })),
    scrobblers.length > 0 && e(Group, { label: 'Listening history' },
      scrobblers.map((s) => {
        const on = !!scrobblerStates[s.id];
        return e(Tile, {
          key: s.id,
          icon: e(ServiceMark, { resolver: s }),
          title: s.name,
          description: on ? e(Badge, { tone: 'accent', icon: Icons.Check }, 'Connected') : 'Connect',
          'aria-label': on ? `${s.name}: connected` : `Connect ${s.name}`,
          onClick: () => onOpenPlugin(s.id),
        });
      })));
}

function ListenStep({ hasCollection, playlists, onCollectionRadio, onOpenPlaylist, onSearch }) {
  const list = (playlists || []).slice(0, 3);
  return e(React.Fragment, null,
    e('p', { style: LINE }, hasCollection || list.length > 0
      ? 'Play your collection, or open a playlist you brought in.'
      : 'Play an album from Explore below, or search for a song.'),
    (hasCollection || list.length > 0) && e(Group, null,
      list.map((p) => e(Tile, {
        key: p.id, icon: e(IconMark, { page: 'playlists' }), title: p.title || 'Untitled playlist',
        description: countOf((p.tracks || []).length || p.trackCount || 0, 'track'),
        onClick: () => onOpenPlaylist(p),
      }))),
    e('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' } },
      hasCollection && e(CollectionRadioButton, { onClick: onCollectionRadio }),
      e(Button, { variant: 'secondary', onClick: onSearch }, e(Icons.Search, { size: 16 }), 'Search')));
}

// ----------------------------------------------------------------- layout

function GettingStarted(props) {
  const { status, onSkip, openStep: openProp } = props;
  const stepState = {};
  for (const s of status.steps) stepState[s.id] = s;
  // The open step: the current one until the person opens another.
  const [picked, setPicked] = React.useState(openProp || null);
  const open = picked || status.current || 'connect';

  const panel = open === 'connect' ? e(ConnectStep, props)
    : open === 'music' ? e(MusicStep, props)
      : e(ListenStep, props);

  return e('section', { 'aria-labelledby': 'home-getting-started', style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
    e('header', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' } },
      e('div', { style: { minWidth: 0 } },
        e('h2', { id: 'home-getting-started', style: { margin: 0, fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)' } }, 'Welcome to Parachord'),
        e('p', { style: Object.assign({}, LINE, { marginTop: '4px' }) }, 'All your music, from every service, in one player. Three steps:')),
      e(Button, { variant: 'text', size: 'sm', onClick: onSkip }, 'Skip setup for now')),
    e('div', { style: CARD_STYLE },
      e('div', { style: STEP_GRID },
        STEPS.map((step, i) => {
          const s = stepState[step.id] || {};
          const isCurrent = status.current === step.id;
          return e(ListRow, {
            key: step.id,
            state: open === step.id ? 'current' : undefined,
            'aria-expanded': open === step.id,
            'aria-controls': 'home-getting-started-panel',
            onClick: () => setPicked(step.id),
            style: { height: `${STEP_HEADER_HEIGHT}px` },
          },
            e(StepMarker, { index: i, done: !!s.done, current: isCurrent }),
            e('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              e('span', { className: 'text-ink-primary', style: { fontSize: '14px', fontWeight: 600 } }, step.title),
              e('span', { className: 'text-ink-tertiary', style: { fontSize: '12px' } },
                s.done ? 'Done' : isCurrent ? 'Next' : 'Not yet')));
        })),
      e('div', { id: 'home-getting-started-panel', role: 'region', 'aria-label': (STEPS.find((s) => s.id === open) || STEPS[0]).title, style: PANEL_STYLE }, panel)),
    // The phone apps: they play from the same services, and stay in step
    // with this computer through them (playlist sync, Library Sync, Loves).
    e(StepNote, {
      icon: Icons.Smartphone,
      actions: [
        // The store marks parachord.com's badges use (BRAND_MARKS).
        e(Button, { key: 'ios', variant: 'text', size: 'sm', onClick: () => props.onOpenLink && props.onOpenLink(MOBILE_LINKS.ios) }, e(BrandMark, { id: 'apple', size: 16 }), 'iPhone beta on TestFlight'),
        e(Button, { key: 'android', variant: 'text', size: 'sm', onClick: () => props.onOpenLink && props.onOpenLink(MOBILE_LINKS.android) }, e(BrandMark, { id: 'googleplay', size: 14 }), 'Android beta on Google Play'),
      ],
    }, 'Take it with you. Parachord for iPhone and Android (both in beta) plays from the same services. Connect the same accounts and turn on sync there, and your playlists, collection and Loves stay up to date between your phone and this computer.'));
}

// ---------------------------------------------------------------- skeleton

const bar = (style) => e('div', {
  className: 'rounded shimmer-light animate-shimmer',
  style: Object.assign({ backgroundSize: '200% 100%' }, style),
});

// The layout's shape while the plug-ins load: the header, the step row and
// four tiles in the tile grid.
function GettingStartedSkeleton() {
  return e('section', { 'aria-busy': 'true', 'aria-hidden': 'true', style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
    e('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      bar({ height: '28px', width: '280px' }),
      bar({ height: '14px', width: '360px', maxWidth: '100%' })),
    e('div', { style: CARD_STYLE },
      e('div', { style: STEP_GRID },
        STEPS.map((s) => e('div', { key: s.id, style: { height: `${STEP_HEADER_HEIGHT}px`, display: 'flex', alignItems: 'center', gap: '12px', padding: '0 20px' } },
          bar({ width: '28px', height: '28px', borderRadius: '9999px', flexShrink: 0 }),
          bar({ height: '14px', width: '60%' })))),
      e('div', { style: PANEL_STYLE },
        bar({ height: '14px', width: '70%' }),
        e('div', { style: TILE_GRID },
          [0, 1, 2, 3].map((i) => e('div', {
            key: i, className: 'border border-line',
            style: { height: `${TILE_HEIGHT}px`, borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px' },
          },
            bar({ width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0 }),
            bar({ height: '14px', width: '50%' })))))));
}

module.exports = { GettingStarted, GettingStartedSkeleton, StepMarker, ServiceMark, GETTING_STARTED_STEPS: STEPS };
