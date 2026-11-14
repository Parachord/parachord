// src/renderer/components/fields.js: form fields (#1385 step 7).
//
// The audit counted 16 text-input recipes, 3 switch designs and settings
// rows in several type sizes. These are the one set:
//
//   SettingRow   a setting: its name (13px, 500) and an optional hint
//                (12px, secondary) on the left, the control on the right.
//                The name labels the control (htmlFor / aria-labelledby).
//   Select       a native <select> with the field look and a chevron.
//   TextField    a text, number, url or email input with the field look;
//                `invalid` + `error` show an inline error (aria-invalid,
//                aria-describedby).
//   SecretField  a TextField for keys and tokens with a Show/Hide button.
//   Switch       role="switch", aria-checked, the control tokens; onToggle
//                runs on click (the caller works out the next value).
//   RadioGroup   a role="radiogroup" of options with a label and a hint.
//
// The field look: 36px tall (32 for size="sm"), 13px text, 8px radius,
// --bg-elevated on a 1px --border-default line, the accent on focus.
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');

const FIELD = 'h-9 px-3 text-[13px] rounded-lg bg-surface-card text-ink-primary border border-line placeholder-ink-tertiary '
  + 'transition-colors hover:border-line-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent '
  + 'disabled:opacity-50 disabled:cursor-not-allowed';
const FIELD_SM = FIELD.replace('h-9 px-3', 'h-8 px-2.5');

function SettingRow({ label, hint, id, children, className, style }) {
  const e = React.createElement;
  const auto = React.useId();
  const labelId = `${id || auto}-label`;
  const hintId = hint ? `${id || auto}-hint` : undefined;
  // The control is the row's last child; give it the row's name and hint.
  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
      'aria-labelledby': children.props['aria-label'] ? undefined : labelId,
      'aria-describedby': hintId,
    })
    : children;
  return e('div', {
    className: ['flex items-center justify-between gap-4', className].filter(Boolean).join(' '),
    style: Object.assign({ padding: '10px 0' }, style),
  },
  e('div', { style: { minWidth: 0 } },
    e('div', { id: labelId, className: 'text-ink-primary', style: { fontSize: '13px', fontWeight: 500 } }, label),
    hint && e('div', { id: hintId, className: 'text-ink-secondary', style: { fontSize: '12px', marginTop: '2px', lineHeight: 1.45 } }, hint)),
  e('div', { className: 'flex-shrink-0' }, control));
}

function Select({ value, onChange, options, size = 'md', className, style, ...rest }) {
  const e = React.createElement;
  const full = /\bw-full\b/.test(className || '');
  return e('div', { className: full ? 'relative flex items-center w-full' : 'relative inline-flex items-center' },
    e('select', Object.assign({}, rest, {
      value,
      onChange: (ev) => onChange && onChange(ev.target.value, ev),
      className: [size === 'sm' ? FIELD_SM : FIELD, 'appearance-none pr-8 cursor-pointer', className].filter(Boolean).join(' '),
      style,
    }),
    (options || []).map((o) => e('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label))),
    e(Icons.ChevronDown, { className: 'w-4 h-4 text-ink-tertiary absolute right-2.5 pointer-events-none' }));
}

function TextField({ value, onChange, type = 'text', size = 'md', invalid = false, error, className, style, id, ...rest }) {
  const e = React.createElement;
  const auto = React.useId();
  const errId = error ? `${id || auto}-error` : undefined;
  const input = e('input', Object.assign({}, rest, {
    id,
    type,
    value,
    onChange: (ev) => onChange && onChange(ev.target.value, ev),
    'aria-invalid': invalid || error ? 'true' : undefined,
    'aria-describedby': [rest['aria-describedby'], errId].filter(Boolean).join(' ') || undefined,
    className: [size === 'sm' ? FIELD_SM : FIELD, invalid || error ? 'border-line-danger' : '', className].filter(Boolean).join(' '),
    style,
  }));
  if (!error) return input;
  return e('div', null, input,
    e('div', { id: errId, role: 'alert', className: 'text-ink-danger', style: { fontSize: '12px', marginTop: '4px' } }, error));
}

function SecretField(props) {
  const e = React.createElement;
  const [shown, setShown] = React.useState(false);
  return e('div', { className: 'relative flex items-center w-full' },
    e(TextField, Object.assign({}, props, { type: shown ? 'text' : 'password', className: ['pr-16 w-full', props.className].filter(Boolean).join(' '), autoComplete: 'off', spellCheck: false })),
    e('button', {
      type: 'button',
      onClick: () => setShown((s) => !s),
      'aria-pressed': shown ? 'true' : 'false',
      className: 'absolute right-1.5 px-2 h-6 text-xs font-medium rounded-md text-ink-secondary hover:text-ink-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    }, shown ? 'Hide' : 'Show'));
}

function Switch({ checked, onToggle, disabled = false, size = 'md', className, ...rest }) {
  const e = React.createElement;
  const sm = size === 'sm';
  return e('button', Object.assign({}, rest, {
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    disabled,
    onClick: (ev) => { if (!disabled && onToggle) onToggle(ev); },
    className: [
      'relative inline-flex flex-shrink-0 rounded-full transition-colors no-drag',
      sm ? 'w-9 h-5' : 'w-11 h-6',
      checked ? 'bg-accent-fill' : 'bg-control-off',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      className,
    ].filter(Boolean).join(' '),
  }),
  e('span', {
    'aria-hidden': 'true',
    className: `absolute top-0.5 left-0.5 rounded-full bg-control-knob shadow transition-transform ${sm ? 'w-4 h-4' : 'w-5 h-5'}`,
    style: { transform: checked ? `translateX(${sm ? 16 : 20}px)` : 'translateX(0)' },
  }));
}

function RadioGroup({ name, value, options, onChange, label }) {
  const e = React.createElement;
  return e('div', { role: 'radiogroup', 'aria-label': label, className: 'flex flex-col', style: { gap: '8px' } },
    (options || []).map((o) => e('label', {
      key: o.value,
      className: `flex items-start gap-3 rounded-lg cursor-pointer border ${value === o.value ? 'bg-accent-tint border-accent' : 'bg-surface-hover border-transparent hover:border-line-strong'}`,
      style: { padding: '12px' },
    },
    e('input', {
      type: 'radio', name, value: o.value, checked: value === o.value,
      onChange: () => onChange && onChange(o.value),
      className: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      style: { marginTop: '3px', accentColor: 'var(--accent-primary)' },
    }),
    e('span', null,
      e('span', { className: 'block text-ink-primary', style: { fontSize: '13px', fontWeight: 500 } }, o.label),
      o.hint && e('span', { className: 'block text-ink-secondary', style: { fontSize: '12px', marginTop: '2px' } }, o.hint)))));
}

module.exports = { SettingRow, Select, TextField, SecretField, Switch, RadioGroup, FIELD_CLASS: FIELD };
