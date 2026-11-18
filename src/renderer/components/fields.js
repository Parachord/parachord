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
//   Checkbox     a native checkbox in the accent (or a service's colour)
//                with the focus ring; the caller's <label> holds its text.
//   Slider       a native range input on one track-and-thumb look
//                (.slider in index.html); onChange gets a number.
//   StackedField a field with its name over it (12px, 500), an optional
//                action at the right of the name (a refresh button) and a
//                line under it (11px, tertiary): for values too long for a
//                SettingRow's right side (keys, URLs, usernames). Every
//                plug-in's keys and fields use it (#1498). Under the line,
//                `status` (left: "API key saved") and `link` ({ url, label },
//                right) share one row; the link is a HelpLink.
//   HelpLink     where to get a key or make an account: accent text with an
//                arrow, no underline, opened in the browser. The one style
//                for a field's help link ("Get your API key →", "Create a
//                Libre.fm account →").
//
// The field look: 36px tall (32 for size="sm", 48 for size="lg"), 13px text
// (16 for lg), 8px radius (12 for lg, full for `pill`), --bg-elevated on a
// 1px --border-default line, the accent ring on keyboard focus, never JS
// focus styling. tone="dark" is the same field on the always-dark panels
// (the Shuffleupagus prompt and chat), in the --on-dark-* tokens.
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');

const FIELD = 'h-9 px-3 text-[13px] rounded-lg bg-surface-card text-ink-primary border border-line placeholder-ink-tertiary '
  + 'transition-colors hover:border-line-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent '
  + 'disabled:opacity-50 disabled:cursor-not-allowed';
const FIELD_SM = FIELD.replace('h-9 px-3', 'h-8 px-2.5');

const SIZES = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-9 px-3 text-[13px]', lg: 'h-12 px-3.5 text-base' };
const TONES = {
  light: 'bg-surface-card text-ink-primary border border-line placeholder-ink-tertiary hover:border-line-strong '
    + 'focus-visible:border-accent focus-visible:ring-accent',
  dark: 'bg-[var(--on-dark-faint)] text-on-dark-primary border border-[var(--on-dark-border)] placeholder-on-dark-tertiary '
    + 'hover:border-[var(--on-dark-fill)] focus-visible:border-[var(--playbar-accent)] focus-visible:ring-[var(--playbar-accent)]',
};

// The class list for a field: size, tone, shape. `bare` drops the box (the
// Search page's big type, where the caret is the focus sign).
function fieldClassName({ size = 'md', tone = 'light', pill = false, bare = false, muted = false, invalid = false, className } = {}) {
  if (bare) {
    return ['bg-transparent border-none outline-none focus-visible:outline-none text-ink-primary placeholder-ink-tertiary', className].filter(Boolean).join(' ');
  }
  return [
    SIZES[size] || SIZES.md,
    pill ? 'rounded-full' : size === 'lg' ? 'rounded-xl' : 'rounded-lg',
    TONES[tone] || TONES.light,
    muted ? (tone === 'dark' ? '!text-on-dark-tertiary' : '!text-ink-tertiary') : '',
    'transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    invalid ? '!border-line-danger' : '',
    className,
  ].filter(Boolean).join(' ');
}

const NESTED_CLASS = 'border-l-2 border-line';
const NESTED_STYLE = { marginLeft: '4px', paddingLeft: '16px' };

// NestedSettings: a group of settings that only apply while the row above is
// on (a plug-in's Scrobbling, with its sign-in and loved tracks, under
// "Enable Last.fm"): indented under the same line as a nested SettingRow.
function NestedSettings({ children, style }) {
  return React.createElement('div', { className: NESTED_CLASS, style: Object.assign({}, NESTED_STYLE, style) }, children);
}

// nested: a setting that only applies while the row above is on ("Play
// from Spotify" under "Use Spotify"): indented, with a line on its left
// tying it to its parent. Give its switch size 'sm'.
function SettingRow({ label, hint, id, children, className, style, nested = false }) {
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
    className: ['flex items-center justify-between gap-4', nested ? NESTED_CLASS : '', className].filter(Boolean).join(' '),
    style: Object.assign({ padding: '10px 0' }, style, nested ? NESTED_STYLE : null),
  },
  e('div', { style: { minWidth: 0 } },
    e('div', { id: labelId, className: 'text-ink-primary', style: { fontSize: '13px', fontWeight: 500 } }, label),
    hint && e('div', { id: hintId, className: 'text-ink-secondary', style: { fontSize: '12px', marginTop: '2px', lineHeight: 1.45 } }, hint)),
  e('div', { className: 'flex-shrink-0' }, control));
}

function HelpLink({ url, children }) {
  return React.createElement('a', {
    href: '#',
    'data-help-link': '',
    onClick: (ev) => {
      ev.preventDefault();
      if (window.electron?.shell?.openExternal) window.electron.shell.openExternal(url);
      else window.open(url, '_blank');
    },
    style: { color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' },
  }, children, ' \u2192');
}

function StackedField({ label, action, description, status, link, children, style }) {
  const e = React.createElement;
  return e('div', { style: Object.assign({ marginBottom: '12px' }, style) },
    e('div', { className: 'flex items-center justify-between gap-2', style: { marginBottom: '4px' } },
      e('div', { className: 'text-ink-primary', style: { fontSize: '12px', fontWeight: 500 } }, label),
      action || null),
    children,
    description && e('div', { className: 'text-ink-tertiary', style: { fontSize: '11px', lineHeight: 1.5, marginTop: '4px' } }, description),
    (status || (link && link.url)) && e('div', { className: 'flex items-center justify-between gap-2', style: { marginTop: '6px', fontSize: '12px' } },
      status || e('span', null),
      link && link.url ? e(HelpLink, { url: link.url }, link.label) : null));
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

// TextField props beyond an <input>'s own: size ('sm' | 'md' | 'lg'), tone
// ('light' | 'dark'), pill, bare, muted (placeholder-coloured text: an
// example prompt), invalid + error, icon (a node at the left: a search
// glyph), trailing (a node inside at the right: a Send button), and
// wrapClassName (the wrapper's classes when icon / trailing / error wrap it:
// 'flex-1', 'w-full').
function TextField({ value, onChange, type = 'text', size = 'md', tone = 'light', pill = false, bare = false, muted = false,
  invalid = false, error, icon, trailing, wrapClassName, className, style, id, inputRef, ...rest }) {
  const e = React.createElement;
  const auto = React.useId();
  const errId = error ? `${id || auto}-error` : undefined;
  const input = e('input', Object.assign({}, rest, {
    id,
    ref: inputRef,
    type,
    value,
    onChange: (ev) => onChange && onChange(ev.target.value, ev),
    'aria-invalid': invalid || error ? 'true' : undefined,
    'aria-describedby': [rest['aria-describedby'], errId].filter(Boolean).join(' ') || undefined,
    className: fieldClassName({
      size, tone, pill, bare, muted, invalid: invalid || !!error,
      className: [icon ? (size === 'lg' ? 'pl-11' : 'pl-9') : '', trailing ? 'pr-12' : '', icon || trailing ? 'w-full' : '', className].filter(Boolean).join(' '),
    }),
    style,
  }));
  if (!error && !icon && !trailing) return input;
  const iconTone = tone === 'dark' ? 'text-on-dark-tertiary' : 'text-ink-tertiary';
  const field = icon || trailing
    ? e('div', { className: ['relative flex items-center', wrapClassName].filter(Boolean).join(' ') },
      icon && e('span', { 'aria-hidden': 'true', className: `absolute ${size === 'lg' ? 'left-4' : 'left-3'} flex items-center pointer-events-none ${iconTone}` }, icon),
      input,
      trailing && e('span', { className: 'absolute right-2 flex items-center' }, trailing))
    : input;
  if (!error) return field;
  return e('div', { className: wrapClassName }, field,
    e('div', { id: errId, role: 'alert', className: 'text-ink-danger', style: { fontSize: '12px', marginTop: '4px' } }, error));
}

function SecretField(props) {
  const e = React.createElement;
  const [shown, setShown] = React.useState(false);
  // Show/Hide only once there's something to show. A controlled field reads
  // its value; an uncontrolled one (defaultValue) tracks what's typed.
  const [typed, setTyped] = React.useState(!!props.defaultValue);
  const hasText = props.value !== undefined ? String(props.value || '').length > 0 : typed;
  const onChange = (v, ev) => {
    if (props.value === undefined) setTyped(String(v || '').length > 0);
    if (props.onChange) props.onChange(v, ev);
  };
  return e('div', { className: 'relative flex items-center w-full' },
    e(TextField, Object.assign({}, props, { onChange, type: shown ? 'text' : 'password', className: [hasText ? 'pr-16' : '', 'w-full', props.className].filter(Boolean).join(' '), autoComplete: 'off', spellCheck: false })),
    hasText && e('button', {
      type: 'button',
      onClick: () => setShown((s) => !s),
      'aria-pressed': shown ? 'true' : 'false',
      className: 'absolute right-1.5 px-2 h-6 text-xs font-medium rounded-md text-ink-secondary hover:text-ink-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    }, shown ? 'Hide' : 'Show'));
}

function Switch({ checked, onToggle, disabled = false, size = 'md', tone = 'light', className, ...rest }) {
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
      checked ? 'bg-accent-fill' : tone === 'dark' ? 'bg-[var(--on-dark-fill)]' : 'bg-control-off',
      tone === 'dark'
        ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--playbar-accent)]'
        : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page',
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

// Checkbox: a native checkbox, 16px (18 for size="md"), in the accent or
// `color` (a service's colour in the sync dialog), with the focus ring.
// onChange(checked, ev). Put it in a <label> with its text.
function Checkbox({ checked, onChange, color, size = 'sm', className, style, ...rest }) {
  const px = size === 'md' ? '18px' : '16px';
  return React.createElement('input', Object.assign({}, rest, {
    type: 'checkbox',
    checked: checked === undefined ? undefined : !!checked,
    onChange: (ev) => onChange && onChange(ev.target.checked, ev),
    className: ['flex-shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded', className].filter(Boolean).join(' '),
    style: Object.assign({ width: px, height: px, accentColor: color || 'var(--accent-fill)' }, style),
  }));
}

// Slider: a native range input on the one slider look (.slider in
// index.html: a 4px track, a 12px thumb). tone="dark" is the playbar's
// (the --on-dark track, the playbar accent); `color` sets the thumb (the
// Concerts page's teal). onChange(number, ev).
function Slider({ value, onChange, min = 0, max = 100, step = 1, tone = 'light', color, disabled = false, className, style, ...rest }) {
  return React.createElement('input', Object.assign({}, rest, {
    type: 'range',
    min, max, step, value, disabled,
    onChange: (ev) => onChange && onChange(Number(ev.target.value), ev),
    className: ['slider', tone === 'dark' ? 'slider-dark' : '', className].filter(Boolean).join(' '),
    style: Object.assign({}, color ? { '--slider-fill': color } : null, style),
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

// SegmentedChoice: a pick-one row of equal-width tiles, each with an icon
// and a label; the chosen one has an accent border and tint (Settings'
// theme picker). role="radiogroup", each tile role="radio".
//   options [{ value, label, icon }], value, onChange(value), label
function SegmentedChoice({ value, options, onChange, label }) {
  const e = React.createElement;
  return e('div', { role: 'radiogroup', 'aria-label': label, className: 'flex', style: { gap: '8px' } },
    (options || []).map((o) => {
      const on = value === o.value;
      return e('button', {
        key: o.value,
        type: 'button',
        role: 'radio',
        'aria-checked': on,
        onClick: () => onChange && onChange(o.value),
        className: 'flex-1 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent '
          + (on ? 'text-accent' : 'text-ink-secondary hover:bg-surface-hover'),
        style: {
          gap: '6px', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
          border: on ? '2px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
          backgroundColor: on ? 'var(--accent-primary-alpha-08)' : undefined,
        },
      }, o.icon && e('span', { 'aria-hidden': 'true' }, o.icon), o.label);
    }));
}

module.exports = { NestedSettings, SettingRow, StackedField, HelpLink, Select, TextField, SecretField, Switch, Checkbox, Slider, RadioGroup, SegmentedChoice, fieldClassName, FIELD_CLASS: FIELD };
