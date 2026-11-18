// src/renderer/components/provider-menu.js: the AI provider picker on the
// always-dark Shuffleupagus chat panel ("Powered by").
//
// The one-shot prompt panel (removed in #1020) had a native <select> and the
// chat panel the shared Menu: one choice, two controls (design audit §4.9).
// Both became this: the shared
// Menu (components/menu.js) of the AI plug-ins, each with its logo and a
// check on the current one, behind a small dark secondary button.
//
// Props:
//   label     names the menu ("AI provider", "Chat provider")
//   services  [{ id, name, icon? }] the plug-ins to choose from
//   value     the current one's id
//   onChange  (id, service) when another one is picked
// Props-driven; loads under plain Node.

const { Menu } = require('./menu');
const { buttonClassName } = require('./button');
const Icons = require('./icons');
const { transition } = require('../lib/motion');
const { SERVICE_LOGOS } = require('./brand-logos');

const nameOf = (s) => (s && (s.name || (s.manifest && s.manifest.name))) || '';

function ProviderLogo({ service }) {
  const e = React.createElement;
  const logo = SERVICE_LOGOS[service.id];
  if (logo) {
    return e('span', { style: { width: '14px', height: '14px', display: 'inline-flex', flexShrink: 0 } },
      React.cloneElement(logo, { className: '', style: { width: '14px', height: '14px' } }));
  }
  return e('span', { style: { fontSize: '12px' } }, service.icon || (service.manifest && service.manifest.icon) || '🤖');
}

function ProviderMenu({ label = 'AI provider', services, value, onChange }) {
  const e = React.createElement;
  const list = services || [];
  const current = list.find((s) => s.id === value);
  return e(Menu, {
    label,
    align: 'right',
    minWidth: 140,
    items: list.map((service) => ({
      key: service.id,
      label: nameOf(service),
      icon: e(ProviderLogo, { service }),
      checked: service.id === value,
      onSelect: () => { if (service.id !== value && onChange) onChange(service.id, service); },
    })),
    renderTrigger: (t) => e('button', Object.assign({}, t, {
      type: 'button',
      'aria-label': `${label}: ${nameOf(current) || 'none'}`,
      // The shared small secondary button, dark tone.
      className: buttonClassName({ variant: 'secondary', size: 'sm', tone: 'dark' }),
    }),
    current ? e(ProviderLogo, { service: current }) : null,
    nameOf(current) || 'Select',
    e(Icons.ChevronDown, { size: 10, style: { transform: t.open ? 'rotate(180deg)' : 'rotate(0deg)', transition: transition('transform', 'base') } })),
  });
}

module.exports = { ProviderMenu };
