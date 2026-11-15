// src/renderer/components/header-control.js: the controls in a page's header
// bar and the queue drawer's (#1385): Close, Edit, Cancel, Done, Save,
// Refresh, Unshuffle, Clear.
//
// They were their own small uppercase outlined style, the one place left
// with a second button family next to the shared Button (sentence-case
// Share, Import, Create on the same pages). They are Button now:
//   - an action is a small sentence-case Button: 'primary' tone → the fill
//     accent (Save, Done), anything else → secondary
//   - `close` is an icon-only ✕ (Button variant 'icon') at the far right,
//     named by its label ("Close") and with that as its tooltip, as dialogs
//     and the chat panel close
//   - 'dark' is the always-dark queue drawer (Button tone 'dark')
//
// Props: children (the label, and an icon if any), tone 'default' |
// 'primary' | 'dark', close, and anything else for the <button> (onClick,
// disabled, data-tooltip, aria-*). Props-driven; no hooks; loads under plain
// Node.

const Icons = require('./icons');
const { Button } = require('./button');

const labelOf = (children) => React.Children.toArray(children).filter((c) => typeof c === 'string').join(' ').trim();

function HeaderControl({ tone = 'default', close = false, className, children, ...rest }) {
  const e = React.createElement;
  const dark = tone === 'dark' ? 'dark' : undefined;
  if (close) {
    const label = rest['aria-label'] || labelOf(children) || 'Close';
    return e(Button, Object.assign({}, rest, {
      variant: 'icon', size: 'sm', tone: dark, className,
      'aria-label': label, 'data-tooltip': rest['data-tooltip'] || label,
    }), e(Icons.X, { size: 16 }));
  }
  return e(Button, Object.assign({}, rest, {
    variant: tone === 'primary' ? 'primary' : 'secondary', size: 'sm', tone: dark, className,
  }), children);
}

module.exports = { HeaderControl };
