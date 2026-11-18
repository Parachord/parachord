// src/renderer/components/first-run-tutorial.js: the welcome tour, shown on
// first launch (tutorial_completed) and from Settings › About › Show welcome
// tour. It explains Parachord and asks you to set up nothing (#1493): one
// idea per screen, each with a small picture made of the app's own pieces
// and a line or two. The last screen's Get started hands over to Home's
// getting-started layout, where the setup is.
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and memos by value, plain functions through useStableHandlers
// (FIRST_RUN_TUTORIAL_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// window is read only inside handlers.

const Icons = require('./icons');
const { ParachordWordmark, ParachordAppIcon, SERVICE_LOGOS, BRAND_COLORS } = require('./brand-logos');
const { Modal } = require('./modal');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { ReasonMark } = require('./reason-badge');
const { LISTENER_HEXAGON } = require('./listener-card');
const { ServiceMark } = require('./home-getting-started');
const { PAGE_COLORS } = require('../lib/page-colors');
const { PAGE_ICONS } = require('../lib/page-icons');
const { stepOnePlugins } = require('../lib/getting-started');

const e = React.createElement;

const FIRST_RUN_TUTORIAL_HANDLERS = [
  'getTrackArt',
  'navigateTo',
  'startGettingStarted',
];

// The song the Friends screen's playbar is playing; its cover comes from the
// album-art pipeline (getTrackArt), never a stored URL.
const FRIEND_SONG = { artist: 'Quarantine Angst', title: 'Lopped Off' };

// The plug-ins that play here, from the registry: services first, then the
// no-account ones (never a list of names).
const playingPlugins = (loadedResolvers) => {
  const p = stepOnePlugins(loadedResolvers);
  // Every service that needs an account (Plex among them once installed), then a no-account one.
  return p.services.slice(0, 6).concat(p.free.slice(0, 1));
};

const PICTURE_STYLE = {
  height: '120px', borderRadius: '12px', backgroundColor: 'var(--bg-secondary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '24px',
};

const pageMark = (page) => {
  const Icon = Icons[PAGE_ICONS[page]] || Icons.Music;
  return e('span', {
    key: page,
    style: {
      width: '44px', height: '44px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--card-bg)', color: PAGE_COLORS[page] ? PAGE_COLORS[page].color : 'var(--accent-primary)', boxShadow: 'var(--card-shadow)',
    },
  }, e(Icon, { size: 22 }));
};

// The playbar's now-playing block in small, on the player's dark surface:
// cover (or a note), title, artist (with `artistExtra` after it), then
// `extra` on the right. Concerts, Friends, links and buying draw it.
function MiniPlaybar({ art, onArtError, title, artist, artistExtra, extra }) {
  return e('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '12px',
      backgroundColor: 'var(--surface-dark)', boxShadow: 'var(--card-shadow)',
    },
  },
    e('span', { style: { width: '44px', height: '44px', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--surface-dark-placeholder)', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-dark-tertiary)' } },
      art ? e('img', { src: art, alt: '', width: 44, height: 44, style: { objectFit: 'cover' }, onError: onArtError }) : e(Icons.Music, { size: 18 })),
    e('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '110px' } },
      e('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--on-dark-primary)' } }, title),
      e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--on-dark-secondary)' } }, artist, artistExtra)),
    extra);
}

// A service's link as the registry spells it (its first URL pattern, the
// wildcards as an ellipsis): what a dragged link reads in the picture.
const linkText = (r) => {
  const patterns = (r && Array.isArray(r.urlPatterns) && r.urlPatterns) || [];
  // A song's link reads best; else the plug-in's first.
  const pattern = patterns.find((p) => /\/(track|song)s?\//.test(p)) || patterns[0] || '';
  return pattern.replace(/^https?:\/\//, '').replace(/\/\*.*$/, '/…');
};

// One entry per screen: its title, its line, `needs` (the caveat: what the
// feature needs before it works, an honest expectation, never a question;
// shown in italics), and its picture. A screen describes what
// a feature does rather than naming it: a new person doesn't know the
// pages' names yet.
const TOUR_SCREENS = [
  {
    id: 'welcome',
    title: 'One player for all your music',
    body: 'Spotify, Apple Music, Bandcamp, your Plex server, your own files: Parachord finds a song wherever you have it and plays it here.',
    picture: ({ loadedResolvers }) => e(React.Fragment, null,
      playingPlugins(loadedResolvers).map((r) => e(ServiceMark, { key: r.id, resolver: r })),
      e('span', {
        style: {
          width: '36px', height: '36px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)',
        },
      }, e(Icons.Folder, { size: 18 })),
      e(Icons.ArrowRight, { size: 20, className: 'text-ink-tertiary' }),
      e(ParachordAppIcon, { size: 48 })),
  },
  {
    id: 'collection',
    title: 'Your collection and playlists, everywhere',
    body: 'Import playlists and liked songs from any service, and keep a playlist in sync across the services you use.',
    picture: ({ loadedResolvers }) => e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' } },
      e('span', { className: 'text-ink-primary', style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 } },
        e(Icons.ListMusic, { size: 18 }), 'Road trip'),
      e('div', { style: { display: 'flex', gap: '6px' } },
        stepOnePlugins(loadedResolvers).services.slice(0, 3).map((r) => e(Badge, { key: r.id, color: r.color || undefined }, r.name)))),
  },
  {
    id: 'discover',
    title: 'Find new music',
    body: 'New releases from artists you follow, the albums critics love most, what’s most played right now, and picks made from your listening.',
    needs: 'New releases and picks fill in once you connect a service or bring in your music.',
    picture: () => ['new-releases', 'critics-picks', 'discover', 'recommendations'].map(pageMark),
  },
  {
    // The playbar's Spinoff button (playbar.js, startSpinoff in
    // use-playback-engine.js): songs like the one playing, from Last.fm's
    // similar tracks; your queue is kept and comes back when you stop.
    id: 'spinoff',
    title: 'Follow where a song leads',
    body: 'Like what’s playing? Press the spin-off button in the player and Parachord keeps playing songs like it. Your queue waits: press it again and you’re back where you left off.',
    picture: ({ friendArt, onFriendArtError }) => e(MiniPlaybar, {
      art: friendArt, onArtError: onFriendArtError, title: FRIEND_SONG.title, artist: FRIEND_SONG.artist,
      extra: e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', marginLeft: '16px', fontSize: '12px', color: 'var(--on-dark-secondary)' } },
        e('span', { style: { display: 'inline-flex', color: 'var(--playbar-accent)' } }, e(Icons.Spinoff, { className: 'w-5 h-5' })),
        'Playing songs like this'),
    }),
  },
  {
    id: 'concerts',
    title: 'Never miss a show',
    body: 'See upcoming concerts near you from the artists you listen to, with tickets a click away. When an artist you’re playing is on tour near you, a dot appears beside their name in the player; click it for their dates.',
    needs: 'Works once you add a tickets plug-in and set your location.',
    // The playbar with its on-tour dot (playbar.js) in the Concerts colour.
    picture: () => e(MiniPlaybar, {
      title: 'Now playing', artist: 'The artist',
      artistExtra: e('span', { style: { width: '7px', height: '7px', borderRadius: '9999px', backgroundColor: PAGE_COLORS.concerts.color } }),
      extra: e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '8px', fontSize: '12px', color: 'var(--on-dark-secondary)' } },
        e(Icons.Ticket, { size: 14 }), 'On tour near you'),
    }),
  },
  {
    // What the chat can do comes from its DJ tools (tools/dj-tools.js): play,
    // search, queue, shuffle, make and edit playlists, block a pick.
    id: 'shuffleupagus',
    title: 'Chat with your AI DJ',
    body: 'Its name is Shuffleupagus. Ask for a mood or a moment, and it plays it. Ask it to queue more like what’s on, make a playlist or add to one, skip or shuffle, steer your recommendations, or answer a question about the music.',
    needs: 'Works once you add an AI plug-in, from an online service or one that runs on your computer.',
    // A chat exchange in small: your ask, and the DJ answering with its mark.
    picture: () => e('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '78%' } },
      e('span', {
        style: { alignSelf: 'flex-end', padding: '8px 12px', borderRadius: '12px', fontSize: '13px', backgroundColor: 'var(--accent-fill)', color: 'var(--on-accent)' },
      }, 'Something for a rainy Sunday'),
      e('span', {
        className: 'text-ink-primary',
        style: { alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '12px', fontSize: '13px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' },
      }, e(ReasonMark, { size: 22 }), 'Slow and warm: playing 20 tracks')),
  },
  {
    id: 'friends',
    title: 'Friends',
    body: 'See what your friends are playing, in whatever app they use, and listen along. While you do, their badge sits on your queue button: their queue decides what plays next.',
    needs: 'Works once you connect Last.fm or ListenBrainz.',
    // The playbar listening along: a friend's song playing, and their
    // avatar hexagon on the queue button (playbar.js's listen-along badge),
    // since their queue decides what's next.
    picture: ({ friendArt, onFriendArtError }) => e(MiniPlaybar, {
      art: friendArt, onArtError: onFriendArtError, title: FRIEND_SONG.title, artist: FRIEND_SONG.artist,
      extra: e(React.Fragment, null,
        e('span', { style: { position: 'relative', marginLeft: '16px', display: 'inline-flex', color: 'var(--on-dark-primary)' } },
          e(Icons.List, { size: 18, style: { opacity: 0.4 } }),
          e('span', {
            style: {
              position: 'absolute', top: '-8px', right: '-10px', width: '20px', height: '20px', clipPath: LISTENER_HEXAGON,
              backgroundColor: 'var(--accent-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 600, color: 'var(--on-accent)',
            },
          }, 'A')),
        e('span', { style: { marginLeft: '12px', fontSize: '12px', color: 'var(--on-dark-secondary)' } }, 'Listening along with Alex')),
    }),
  },
  {
    // A link from another service, dropped on the player or the queue
    // (handleUrlDrop in app.js; DropZoneOverlay), plays from your own
    // services. The link in the picture is a service plug-in's own pattern.
    id: 'links',
    title: 'Play any link someone sends you',
    body: 'Someone shared a song, album or playlist from a service you don’t use? Drag the link onto the player to play it now, or onto the queue to play it next. Parachord finds it on the services you use. Links from Achordion work too.',
    needs: 'To send a page from your web browser instead, add the browser extension.',
    picture: ({ loadedResolvers }) => {
      const services = stepOnePlugins(loadedResolvers).services;
      const r = services.find((p) => /\/(track|song)s?\//.test(linkText(p))) || services.find((p) => linkText(p));
      return e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
        r && e('span', {
          className: 'text-ink-primary',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', fontSize: '12px',
            backgroundColor: 'var(--card-bg)', boxShadow: 'var(--shadow-popover)', transform: 'rotate(-3deg)',
          },
        }, e(Icons.Link, { size: 14 }), linkText(r)),
        e(Icons.ArrowRight, { size: 18, className: 'text-ink-tertiary' }),
        // The drop overlay (drop-zone-overlay.js) over the player, in small.
        e('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderRadius: '12px',
            backgroundColor: 'var(--surface-dark)', border: '2px dashed var(--accent-primary-alpha-50)',
            color: 'var(--accent-tertiary)', fontSize: '14px', fontWeight: 600,
          },
        }, e(Icons.Play, { size: 18 }), 'Drop to play now'));
    },
  },
  {
    // The playbar's buy button (playbar.js): a confident match on a store
    // plug-in (capabilities.purchase, Bandcamp today), whatever source plays.
    id: 'buy',
    title: 'Buy the music you love',
    body: 'When a song you’re playing is for sale on Bandcamp, a cart appears in the player, whatever service it’s playing from. Click it to buy straight from the artist.',
    picture: ({ friendArt, onFriendArtError }) => e(MiniPlaybar, {
      art: friendArt, onArtError: onFriendArtError, title: FRIEND_SONG.title, artist: FRIEND_SONG.artist,
      extra: e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '16px', fontSize: '12px', color: 'var(--on-dark-success)' } },
        e(Icons.ShoppingCart, { size: 14 }), 'Buy on Bandcamp'),
    }),
  },
  {
    // Achordion (achordion.xyz) is the web companion: Copy link on a song,
    // album, artist or playlist makes an Achordion link (app.js), which
    // anyone can open and play on the service they use.
    id: 'achordion',
    title: 'Share music with anyone',
    body: 'Achordion is Parachord’s companion on the web, for finding music and sharing what you listen to. Copy a link to any song, album, artist or playlist, and it opens on Achordion, where anyone can listen, whatever service they use. They don’t need Parachord.',
    picture: ({ loadedResolvers }) => e(React.Fragment, null,
      SERVICE_LOGOS.achordion && React.cloneElement(SERVICE_LOGOS.achordion, { className: undefined, style: { width: '48px', height: '48px' } }),
      e(Icons.Link, { size: 20, className: 'text-ink-tertiary' }),
      stepOnePlugins(loadedResolvers).services.slice(0, 3).map((r) => e(ServiceMark, { key: r.id, resolver: r }))),
  },
  {
    // Raycast (its extension, raycast-info-dialog.js) and AI assistants
    // through Parachord's MCP server (Settings › General, McpSettingsSection).
    id: 'apps',
    title: 'Use it from your other apps',
    body: 'Search, play and queue from Raycast without switching windows. Or ask an AI assistant to play something, build a queue or skip a song, and it does it in Parachord.',
    needs: 'Add the Raycast extension (on a Mac), or connect your assistant in Settings › General.',
    // A launcher command and an assistant's ask, each with its mark.
    picture: () => {
      const row = (mark, text) => e('span', {
        className: 'text-ink-primary',
        style: { display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '12px', fontSize: '13px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' },
      }, mark, text);
      // The assistant row is the MCP server, which any assistant that speaks
      // MCP can use, so it shows a neutral sparkle, never an in-app chat
      // plug-in's logo: Ollama or ChatGPT in Parachord's own chat can't drive
      // Parachord over MCP. (#1530 had it show the first chat plug-in set
      // up; before that it was Claude's by id.)
      return e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } },
        row(e('span', { style: { width: '24px', height: '24px', borderRadius: '6px', background: BRAND_COLORS.raycastGradient, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)' } }, e(Icons.Search, { size: 14 })),
          'Play Lopped Off'),
        row(e(Icons.Sparkles, { size: 16 }),
          'Queue three more like this'));
    },
  },
];

const FirstRunTutorial = React.memo(function FirstRunTutorial(props) {
  const {
    firstRunTutorial,
    getTrackArt,
    loadedResolvers,
    navigateTo,
    setFirstRunTutorial,
    startGettingStarted,
  } = props;
  // The Friends screen's cover, asked for once while the tour is open.
  const [friendArt, setFriendArt] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    Promise.resolve(getTrackArt(FRIEND_SONG.artist, FRIEND_SONG.title))
      .then((url) => { if (live) setFriendArt(url || null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const index = Math.max(0, TOUR_SCREENS.findIndex((s) => s.id === firstRunTutorial.step));
  const screen = TOUR_SCREENS[index];
  const last = index === TOUR_SCREENS.length - 1;
  const go = (i) => setFirstRunTutorial((prev) => ({ ...prev, step: TOUR_SCREENS[i].id }));
  const close = async (setup) => {
    await window.electron.store.set('tutorial_completed', true);
    setFirstRunTutorial((prev) => ({ ...prev, open: false, step: 'welcome' }));
    if (setup) startGettingStarted();
    else navigateTo('home');
  };

  return React.createElement(Modal, {
    bare: true, label: 'Welcome to Parachord', scrimClassName: 'z-50', dismissible: false,
    panelProps: {
      className: 'relative w-full max-w-xl mx-4 overflow-hidden',
      style: {
        // Never taller than the window: the body scrolls instead.
        maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
        backgroundColor: 'var(--card-bg)', borderRadius: '16px', boxShadow: 'var(--shadow-dialog)',
      },
    },
  },
    e('div', { style: { height: '4px', backgroundColor: 'var(--accent-primary)' } }),
    // One height for every screen, so Back and Next stay put as you step.
    e('div', { style: { padding: '32px 32px 24px', minHeight: '360px' } },
      index === 0 && e('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '20px' } },
        e(ParachordWordmark, { fill: 'var(--text-primary)', height: 40 })),
      e('div', { 'aria-hidden': 'true', style: PICTURE_STYLE }, screen.picture({ loadedResolvers, friendArt, onFriendArtError: () => setFriendArt(null) })),
      e('h2', { className: 'text-ink-primary', style: { fontSize: '20px', fontWeight: 600, margin: '0 0 8px' } }, screen.title),
      e('p', { className: 'text-ink-secondary', style: { fontSize: '14px', lineHeight: 1.6, margin: 0 } }, screen.body),
      // The caveat (what a feature needs before it works), set apart in italics.
      screen.needs && e('p', { className: 'text-ink-tertiary', style: { fontSize: '13px', lineHeight: 1.5, margin: '8px 0 0', fontStyle: 'italic' } }, screen.needs)),
    e('div', {
      style: { padding: '16px 32px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' },
    },
      last
        ? e(Button, { variant: 'text', size: 'sm', onClick: () => close(false) }, 'Not now')
        : e(Button, { variant: 'text', size: 'sm', onClick: () => close(false) }, 'Skip tour'),
      // Where you are in the tour: dots, and the same in words for a screen reader.
      e('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        e('span', { className: 'sr-only' }, `Screen ${index + 1} of ${TOUR_SCREENS.length}`),
        TOUR_SCREENS.map((s, i) => e('span', {
          key: s.id, 'aria-hidden': 'true',
          style: { width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: i === index ? 'var(--accent-primary)' : 'var(--border-default)' },
        }))),
      e('div', { style: { display: 'flex', gap: '8px' } },
        index > 0 && e(Button, { variant: 'secondary', onClick: () => go(index - 1) }, 'Back'),
        last
          ? e(Button, { variant: 'primary', onClick: () => close(true) }, 'Get started')
          : e(Button, { variant: 'primary', onClick: () => go(index + 1) }, 'Next'))));
});

module.exports = { FirstRunTutorial, FIRST_RUN_TUTORIAL_HANDLERS, TOUR_SCREENS };
