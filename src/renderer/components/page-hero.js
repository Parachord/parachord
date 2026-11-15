// src/renderer/components/page-hero.js: the page hero, the coloured banner at
// the top of a page (Collection, Playlists, History and a friend's history,
// Recommendations, Pop of the Tops, Fresh Drops, Critical Darlings, Concerts).
//
// Each page had its own copy of the same banner: 320px tall, collapsing to an
// 80px bar once the content scrolls (headerCollapseDecision); the page's
// gradient and pattern (lib/page-colors.js); the page title in light,
// tracked capitals (CSS uppercase: the title is written in words), centred
// over whatever the page shows under it, or at the left of the bar when
// collapsed. Right-clicking the title copies the page's link.
//
// Props:
//   collapsed        the page's collapse state
//   page             the PAGE_COLORS key (its gradient and pattern)
//   title            the page title; null when the page draws its own (a
//                    friend's page leads with the avatar)
//   onTitleContextMenu  (event) => void (copyParachordLink)
//   expanded         what shows under the title in the full hero (tabs, a
//                    count, the one-line description)
//   collapsedContent what follows the title in the bar (tabs, a count)
// Props-driven; loads under plain Node.

const { PAGE_COLORS } = require('../lib/page-colors');

const EXPANDED_TITLE_STYLE = { textShadow: '0 2px 20px rgba(0,0,0,0.5)', letterSpacing: '0.3em', textTransform: 'uppercase' };
const COLLAPSED_TITLE_STYLE = { textShadow: '0 2px 10px rgba(0,0,0,0.5)', letterSpacing: '0.2em', textTransform: 'uppercase' };
const HERO_HEIGHT = 320;
const HERO_COLLAPSED_HEIGHT = 80;

function PageHero({ collapsed, page, title, onTitleContextMenu, expanded, collapsedContent }) {
  const e = React.createElement;
  const colors = PAGE_COLORS[page] || PAGE_COLORS.home;
  return e('div', {
    className: 'relative',
    style: { height: `${collapsed ? HERO_COLLAPSED_HEIGHT : HERO_HEIGHT}px`, flexShrink: 0, transition: 'height 300ms ease-out', overflow: 'hidden' },
  },
    e('div', { className: `absolute inset-0 ${colors.hero}` }),
    colors.pattern && e('div', { className: 'absolute inset-0', style: { opacity: colors.patternOpacity, backgroundImage: colors.pattern } }),
    collapsed
      ? e('div', { className: 'hero-bar absolute inset-0 flex items-center px-6 z-10' },
          title && e('h1', { className: 'text-2xl font-light text-white mr-6', style: COLLAPSED_TITLE_STYLE, onContextMenu: onTitleContextMenu }, title),
          collapsedContent)
      : e('div', { className: 'absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10' },
          title && e('h1', { className: 'hero-title font-light text-white', style: EXPANDED_TITLE_STYLE, onContextMenu: onTitleContextMenu }, title),
          expanded));
}

module.exports = { PageHero, HERO_HEIGHT, HERO_COLLAPSED_HEIGHT };
