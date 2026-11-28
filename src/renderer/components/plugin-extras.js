// src/renderer/components/plugin-extras.js: the shared sections of a
// plug-in's settings dialog that only some plug-ins have (#1498 step 5,
// "Extras by capability"; docs/plans/2026-11-17-plugin-settings-audit.md).
//
// The dialog used to draw a hand-built section per service, chosen by its id
// (Spotify's, SoundCloud's, Local Files' …). Each section here is chosen by a
// capability or a manifest field instead, so a new plug-in that declares the
// same thing gets the same section with no dialog change:
//
//   ServiceAccount   settings.account.type 'sign-in': a sign-in the app
//                    itself runs (Spotify, SoundCloud, Apple Music); its
//                    state comes from the host's account for the plug-in
//                    (app.js `hostAccounts`)
//   ClientKeys       settings.clientKeys: the client ID (and secret) you
//                    bring to sign in, with setup steps and redirect URIs
//   UsernameAccount  settings.account.type 'username': an account read from
//                    a username, no sign-in (Last.fm, ListenBrainz)
//   AdvancedKeys     configurable fields marked `advanced`: optional keys,
//                    under one Advanced section, always last
//   LibrarySync      capabilities.librarySync
//   StartupRow       settings.startup: open the service's app at startup
//   InstallCallout   settings.installCallout: software to install first
//   WatchFolders     settings.watchFolders: folders the plug-in reads
//   PluginSwitches   settings.switches: the plug-in's own on/off options
//                    that need its sign-in, nested under the account and
//                    its keys (Subsonic's "Report plays to your server",
//                    #1546)
//   LovedTracks      the manifest's `loves` field (lib/love-providers.js,
//                    #1559): Import, "Push loves to X" and "Send N loved
//                    tracks to X", for Last.fm, ListenBrainz and a server's
//                    stars alike
//   PlaybackQualityRow  a music plug-in's "Playback quality" line: it
//                    follows Settings › General › Playback Quality, or where
//                    its quality is set (lib/playback-quality-line.js: by
//                    capability, settings.playbackQuality and the host's
//                    hostPlayback; #1608)
//
// The layout is the dialog's one order (CLAUDE.md, "Every plug-in's settings
// are one layout"): on/off, the account, the keys it signs in with, what
// needs the sign-in, other settings, Advanced last. A plug-in that needs a
// sign-in to work puts its account and keys before on/off (#1614). Flat rows divided by
// lines, from the shared parts only. Props-driven; hooks are qualified; loads
// under plain Node (window is read only inside handlers).

const Icons = require('./icons');
const { Button } = require('./button');
const { HelpLink, SecretField, SettingRow, StackedField, Switch, TextField } = require('./fields');
const { AccountRow } = require('./account-row');
const { Disclosure } = require('./disclosure');
const { ProgressBar } = require('./progress-bar');
const { EmptyState } = require('./states');
const { librarySyncState } = require('../lib/library-sync-state');
const { countOf } = require('../lib/plural');
const { timeAgo } = require('../lib/time-ago');

// The port the built-in sign-ins are registered on (main-process/auth-port.js).
const DEFAULT_AUTH_PORT = 8888;

// A section of the dialog: a line above it, then its rows.
const SECTION = { padding: '16px 0', borderTop: '1px solid var(--border-subtle)' };
// A block inside a section, divided from what's above it by a line.
const BLOCK = { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' };
const NOTE = { fontSize: '11px', lineHeight: '1.5' };
const TONE = { success: 'var(--text-success)', secondary: 'var(--text-secondary)', warning: 'var(--text-warning)' };

// The plug-in's settings block. The loader also flattens authType and
// configurable onto the plug-in, so read both.
const settingsOf = (plugin) => (plugin && plugin.settings) || {};
const configurableOf = (plugin) => settingsOf(plugin).configurable || (plugin && plugin.configurable) || {};
const authTypeOf = (plugin) => settingsOf(plugin).authType || (plugin && plugin.authType) || 'none';
const accountOf = (plugin) => settingsOf(plugin).account || null;

// A label in the middle of a sentence: "Client ID and secret" → "client ID and secret".
const midSentence = (label) => {
  const s = String(label || '');
  return /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
};

const openExternal = (url) => {
  if (window.electron?.shell?.openExternal) window.electron.shell.openExternal(url);
  else window.open(url, '_blank');
};

// The configurable fields marked `advanced`, minus the client keys (those
// have their own section).
function advancedFieldsOf(plugin) {
  const keys = (settingsOf(plugin).clientKeys && settingsOf(plugin).clientKeys.fields) || [];
  return Object.entries(configurableOf(plugin)).filter(([k, f]) => f && f.advanced && !keys.includes(k));
}

// ServiceAccount: a sign-in the app runs for the plug-in (OAuth, MusicKit).
//   account   the host's account for it: { signedIn, signIn, signOut,
//             status? }. status is the row's line when the host knows more
//             than the manifest (how it plays on this computer); signIn is
//             omitted when this computer has no way to sign in (no button).
//   keysMissing  the client keys it signs in with aren't saved yet
//   children  the keys section, drawn right under the sign-in
function ServiceAccount({ plugin, account, color, keysMissing = false, keysLabel, children }) {
  const e = React.createElement;
  const a = accountOf(plugin) || {};
  const status = account.status
    || (account.signedIn ? 'Signed in'
      : keysMissing ? `Add your ${midSentence(keysLabel || 'keys')} below first`
      : a.signInHint || `Sign in to use ${plugin.name}`);
  return e('div', { style: SECTION },
    e(AccountRow, {
      name: plugin.name, color, signedIn: !!account.signedIn, status,
      onSignIn: account.signIn || undefined, onSignOut: account.signOut,
      signInDisabled: keysMissing,
    }),
    children,
    account.signedIn && a.signedInNote && e('p', { className: 'text-ink-tertiary', style: { ...NOTE, marginTop: '12px' } }, a.signedInNote));
}

// ClientKeys: settings.clientKeys, the client ID (and secret) a person
// brings to sign in. Open, not folded, until they're saved (it can't sign in
// without them), then folded under their own name (CLAUDE.md invariant).
//   keys  the host's: { source: 'user'|'env'|'none', values: { [field]: v },
//         setValue(field, v), save(), clear(), canClear, open?, setOpen? }
function ClientKeys({ plugin, keys, authPort, showToast }) {
  const e = React.createElement;
  // Open or closed: the host's when it opens it from elsewhere (a sign-in
  // that needs the keys), else this section's own.
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = keys.setOpen ? !!keys.open : ownOpen;
  const setOpen = keys.setOpen || setOwnOpen;
  const ck = settingsOf(plugin).clientKeys || {};
  const configurable = configurableOf(plugin);
  const fields = (ck.fields || []).map((k) => [k, configurable[k] || {}]);
  const label = ck.label || (fields[0] && fields[0][1].label) || 'Client ID';
  const source = keys.source || 'none';
  const saved = source !== 'none';
  const port = authPort || DEFAULT_AUTH_PORT;
  const uris = (ck.redirectUris || []).map((u) => u.replace(/\{port\}/g, String(port)));
  const redirectHint = (port !== DEFAULT_AUTH_PORT && ck.redirectHintOtherPort ? ck.redirectHintOtherPort : ck.redirectHint || '').replace(/\{port\}/g, String(port));
  const filled = fields.every(([k]) => String(keys.values?.[k] || '').trim());
  const copy = (uri) => { navigator.clipboard.writeText(uri); showToast('Copied to clipboard', 'success'); };
  return e(Disclosure, { label, alwaysOpen: !saved, open, onToggle: () => setOpen(!open) },
    source === 'none'
      ? e('div', { style: { marginBottom: '12px' } },
        e('p', { style: { ...NOTE, color: TONE.secondary } },
          ck.help || `${plugin.name} needs your own ${midSentence(label)} before you can sign in.`),
        ck.helpUrl && e('div', { style: { textAlign: 'right', marginTop: '6px' } },
          e(HelpLink, { url: ck.helpUrl }, ck.helpLinkLabel || `Get your ${midSentence(label)}`)))
      : e('p', { style: { ...NOTE, color: TONE.success, marginBottom: '12px' } },
        source === 'env' ? `Using the ${midSentence(label)} from an environment variable.` : `Using your own ${midSentence(label)}.`),
    source === 'none' && ck.steps && ck.steps.length > 0 && e('ol', {
      className: 'text-ink-secondary',
      style: { ...NOTE, listStyle: 'decimal', paddingLeft: '20px', marginBottom: '12px' },
    }, ck.steps.map((step) => e('li', { key: step }, step))),
    fields.map(([k, f]) => e(StackedField, { key: k, label: f.label || k },
      e(SecretField, {
        value: keys.values?.[k] || '',
        onChange: (_v, ev) => keys.setValue(k, ev.target.value),
        placeholder: f.placeholder || '',
        'aria-label': f.placeholder || f.label || k,
        className: 'w-full',
      }))),
    uris.length > 0 && e(StackedField, { label: uris.length > 1 ? 'Redirect URIs' : 'Redirect URI', description: redirectHint, style: { marginBottom: '12px' } },
      uris.map((uri, i) => e('div', { key: uri, style: { display: 'flex', gap: '6px', marginTop: i ? '6px' : 0 } },
        e(TextField, { 'aria-label': `${plugin.name} redirect URI${uris.length > 1 ? ` ${i + 1}` : ''}`, value: uri, readOnly: true, className: 'flex-1' }),
        e(Button, { variant: 'secondary', 'aria-label': 'Copy redirect URI', 'data-tooltip': 'Copy', onClick: () => copy(uri) },
          e(Icons.Copy, { className: 'w-4 h-4' }))))),
    e('div', { className: 'flex gap-2' },
      e(Button, { variant: 'primary', size: 'sm', onClick: () => keys.save(), disabled: !filled }, 'Save'),
      keys.canClear && e(Button, { variant: 'secondary', size: 'sm', onClick: () => keys.clear() }, 'Clear')));
}

// AdvancedKeys: the configurable fields marked `advanced` (an optional API
// key, a developer token), under the one Advanced section, always last.
//   values / setValue   what's typed
//   saved               your own are saved (the line says so)
//   onSave / onClear    omitted where the keys are saved another way (with
//                       the username, before it's saved)
//   readOnly            show the saved values only
//   justSaved           the Save button reads "Saved" for a moment
//   open / setOpen      the host's, when it opens the section from elsewhere
//   notice              the host's line about the saved keys, shown in
//                       place of the hint (Last.fm turned the key down, #1538)
function AdvancedKeys({ plugin, values, setValue, saved = false, onSave, onClear, readOnly = false, justSaved = false, open: hostOpen, setOpen: hostSetOpen, notice }) {
  const e = React.createElement;
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = hostSetOpen ? !!hostOpen : ownOpen;
  const setOpen = hostSetOpen || setOwnOpen;
  const fields = advancedFieldsOf(plugin);
  if (fields.length === 0) return null;
  const a = accountOf(plugin) || {};
  const hint = notice || (saved && a.advancedSavedHint ? a.advancedSavedHint : a.advancedHint);
  const tone = notice ? TONE.warning : saved && a.advancedSavedHint ? TONE.success : TONE.secondary;
  return e(Disclosure, { open, onToggle: () => setOpen(!open) },
    hint && e('p', { style: { ...NOTE, color: tone, marginBottom: '12px' } }, hint),
    fields.map(([k, f]) => e(StackedField, { key: k, label: f.label || k, description: f.description, link: !readOnly && f.helpUrl ? { url: f.helpUrl, label: `Get your ${midSentence(f.label || k)}` } : undefined },
      readOnly
        ? e(SecretField, { 'aria-label': `${plugin.name} ${midSentence(f.label || k)}`, defaultValue: values[k] || '', readOnly: true, className: 'w-full' })
        : e(SecretField, {
          value: values[k] || '',
          onChange: (_v, ev) => setValue(k, ev.target.value),
          placeholder: f.placeholder || '',
          'aria-label': f.placeholder || `${plugin.name} ${midSentence(f.label || k)}`,
          className: 'w-full',
        }))),
    !readOnly && onSave && e('div', { className: 'flex gap-2', style: { marginTop: '2px' } },
      e(Button, { variant: 'primary', size: 'sm', onClick: onSave }, justSaved ? 'Saved' : 'Save'),
      onClear && saved && e(Button, { variant: 'secondary', size: 'sm', onClick: onClear }, 'Clear')));
}

// What an Advanced key field shows, and so what Save stores: what's typed,
// else what's saved. Saving only the typed values stored an untouched field
// as empty, so pressing Save (say after buying Last.fm Pro) cleared the keys;
// Clear is the one way to remove them.
function shownKeyValues(fields, typed, saved) {
  const t = typed || {};
  const s = saved || {};
  return Object.fromEntries((fields || []).map(([k]) => [k, t[k] || s[k] || '']));
}

// UsernameAccount: settings.account.type 'username', an account read from a
// username with no sign-in (Last.fm, ListenBrainz): its history,
// recommendations and similar listeners. "Save" / "Remove", never "Signed
// in" (the sign-in is Scrobbling's, nested under Enable).
//   config   the plug-in's saved settings (config.username once saved)
//   account  the host's: { connect(values) → true when saved, remove(),
//            saveAdvanced?(values), clearAdvanced?(), advancedOpen?,
//            setAdvancedOpen?, advancedNotice? (a line about the saved
//            keys, in place of the Advanced hint) }
//   children what needs a sign-in on top of the username (the nested
//            Scrobbling section): after the account, before Advanced
function UsernameAccount({ plugin, config, account, color, children }) {
  const e = React.createElement;
  const [values, setValues] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const setValue = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));
  const a = accountOf(plugin) || {};
  const label = (configurableOf(plugin).username && configurableOf(plugin).username.label) || `${plugin.name} username`;
  const c = config || {};
  if (c.username) {
    const fields = advancedFieldsOf(plugin);
    const savedAny = fields.some(([k]) => c[k]);
    const shownAdvanced = shownKeyValues(fields, values, c);
    return e('div', { style: SECTION },
      e(AccountRow, {
        name: plugin.name, label, color, signedIn: true,
        status: a.usage ? `${c.username} · ${a.usage}` : c.username,
        onSignOut: account.remove, signOutLabel: 'Remove',
      }),
      children,
      account.saveAdvanced
        ? e(AdvancedKeys, {
          plugin,
          // What's typed, else what's saved: what the fields show.
          values: shownAdvanced,
          setValue,
          saved: savedAny,
          open: account.advancedOpen, setOpen: account.setAdvancedOpen,
          notice: account.advancedNotice,
          // Save what the fields show, not only what was typed: a field left
          // as it was keeps its saved value instead of saving as empty
          // (pressing Save after buying Last.fm Pro cleared the keys). Clear
          // is the one way to remove them.
          onSave: async () => { await account.saveAdvanced(shownAdvanced); setValues({}); },
          onClear: account.clearAdvanced ? async () => { setValues({}); await account.clearAdvanced(); } : undefined,
        })
        // Saved with the username: shown, not edited here.
        : savedAny && e(AdvancedKeys, { plugin, values: c, readOnly: true, saved: true, open: account.advancedOpen, setOpen: account.setAdvancedOpen, notice: account.advancedNotice }));
  }
  // Keys saved before the username was removed stay saved (Remove keeps
  // them): the fields show them, and saving the username keeps them.
  const keyFields = advancedFieldsOf(plugin);
  const shownKeys = shownKeyValues(keyFields, values, c);
  const connect = async () => {
    setBusy(true);
    try {
      if (await account.connect({ ...values, ...shownKeys, username: values.username || '' })) setValues({});
    } finally {
      setBusy(false);
    }
  };
  return e('div', { style: SECTION },
    e('div', { style: { marginBottom: '16px' } },
      e(AccountRow, {
        name: plugin.name, label, color, signedIn: false,
        status: `Enter your ${plugin.name} username below`, signInLabel: 'Save',
        onSignIn: connect, signInDisabled: !String(values.username || '').trim(), busy,
      })),
    e(StackedField, { label: 'Username', style: { marginBottom: 0 } },
      e(TextField, { value: values.username || '', onChange: (_v, ev) => setValue('username', ev.target.value), placeholder: `Your ${plugin.name} username`, 'aria-label': `Your ${plugin.name} username`, className: 'w-full' })),
    children,
    // Optional keys, saved with the username.
    e(AdvancedKeys, { plugin, values: { ...values, ...shownKeys }, setValue, saved: keyFields.some(([k]) => c[k]), open: account.advancedOpen, setOpen: account.setAdvancedOpen, notice: account.advancedNotice }));
}

// LibrarySync: capabilities.librarySync, the service's saved music and
// playlists in the Collection. Under the account it needs (a sync can't run
// signed out). lib/library-sync-state.js says what it's doing: a paused sync
// used to offer "Set up", and a lapsed sign-in read "Active".
function LibrarySync({ plugin, settings, signedOut, openSyncSetupModal, setProviderSyncEnabled, setStopSyncDialog }) {
  const e = React.createElement;
  const id = plugin.id;
  const state = librarySyncState(settings, signedOut);
  if (state === 'setup') {
    return e('div', { style: BLOCK }, e(SettingRow, { label: 'Sync your library', hint: 'Bring your saved music and playlists into your Collection', style: { padding: 0 } },
      e(Button, { variant: 'secondary', onClick: () => openSyncSetupModal(id), 'aria-label': 'Set up library sync' }, 'Set up')));
  }
  const last = settings?.lastSyncAt ? `Last synced ${new Date(settings.lastSyncAt).toLocaleString()}` : 'Not synced yet';
  const hint = state === 'paused' ? `Paused. Your synced music stays. ${last}`
    : state === 'signed-out' ? 'Signed out. Sign in above to sync again.'
    : last;
  return e('div', { style: { ...BLOCK, display: 'flex', flexDirection: 'column', gap: '12px' } },
    e(SettingRow, { label: 'Sync your library', hint, style: { padding: 0 } },
      e(Switch, {
        // On only while it syncs, as the Collection's Sync menu shows it;
        // turning a signed-out one on asks for the sign-in.
        checked: state === 'active',
        onToggle: () => setProviderSyncEnabled(id, state !== 'active'),
        'aria-label': 'Sync your library',
      })),
    e('div', { style: { display: 'flex', gap: '8px' } },
      e(Button, { variant: 'secondary', onClick: () => openSyncSetupModal(id) }, 'Manage sync'),
      // Ends sync for good (the switch above pauses it); works signed out,
      // so a service can be dropped without signing in again.
      e(Button, { variant: 'quietDestructive', onClick: () => setStopSyncDialog({ open: true, providerId: id }) }, 'Remove sync…')));
}

// StartupRow: settings.startup, for a service that plays through its own
// app (Spotify Connect): open that app in the background at startup, so
// there's a device to play on.
//   startup  the host's: { on, toggle() }
function StartupRow({ plugin, startup }) {
  const e = React.createElement;
  return e('div', { style: BLOCK },
    e(SettingRow, { label: `Open ${plugin.name} at startup`, hint: settingsOf(plugin).startup.hint, style: { padding: 0 } },
      e(Switch, { checked: !!startup.on, onToggle: startup.toggle, 'aria-label': `Open ${plugin.name} in the background at startup` })));
}

// A music plug-in's "Playback quality" line (#1608): `line` is
// playbackQualityLine's { follows, summary }. One that follows the global
// setting has a button to it; one whose quality is set elsewhere says where.
function PlaybackQualityRow({ line, onOpenSettings }) {
  const e = React.createElement;
  return e('div', { style: SECTION },
    e(SettingRow, { label: 'Playback quality', hint: line.summary, style: { padding: 0 } },
      line.follows && onOpenSettings
        ? e(Button, { variant: 'text', size: 'sm', onClick: onOpenSettings, 'aria-label': 'Change Playback Quality in Settings' }, 'Change')
        : null));
}

// The plug-in's own on/off options (settings.switches: { key: { label,
// hint, default } }), in manifest order. Each one is a choice someone might
// want off while the rest of the plug-in stays on, saved in the plug-in's
// config under its key (true or false), which the plug-in reads. Outside
// `configurable` on purpose: the mobile apps and older desktops draw every
// configurable field as a text box, and ignore a settings field they don't
// know.
function switchesOf(plugin) {
  const switches = settingsOf(plugin).switches;
  if (!switches || typeof switches !== 'object' || Array.isArray(switches)) return [];
  return Object.entries(switches).filter(([, sw]) => sw && typeof sw.label === 'string' && sw.label.trim());
}

// Whether a switch is on: what's saved, else its default (off unless the
// manifest says true).
const switchOn = (sw, config, key) => (config && typeof config[key] === 'boolean' ? config[key] : sw.default === true);

// PluginSwitches: settings.switches, while the plug-in is on. They need
// its sign-in (Subsonic's reports go to the server it signs in to), so the
// dialog draws them in "what needs the sign-in": after the account and the
// keys it signs in with, each a nested row with a small switch tying it to
// the account above, the way "Play from X" sits under "Enable X" (#1505).
// No line of their own: they belong to the section above.
//   config  the plug-in's saved config
//   onSet   (key, on) saves it
function PluginSwitches({ plugin, config, onSet }) {
  const e = React.createElement;
  const rows = switchesOf(plugin);
  if (rows.length === 0) return null;
  // Part of the section above: its 16px bottom padding is taken back, so
  // the rows sit as close under the last field (a field keeps 12px under
  // it) as "Play from X" sits under "Enable X", and the padding moves below.
  return e('div', { 'data-section': 'plugin-switches', style: { marginTop: '-16px', paddingBottom: '16px' } }, ...rows.map(([key, sw]) => {
    const on = switchOn(sw, config, key);
    return e(SettingRow, {
      key,
      label: sw.label,
      hint: sw.hint || undefined,
      nested: true,
      style: { padding: '6px 0' },
    }, e(Switch, { size: 'sm', checked: on, onToggle: () => onSet(key, !on) }));
  }));
}

// LovedTracks: a love provider's rows (the manifest's `loves`, #1559), one
// layout for every plug-in, signed in or not: Import (only when it can list
// your loves; it needs an account to read, not a sign-in), "Push loves to
// X" (off and locked until it's signed in or set up, #1614; the saved
// choice is kept) and "Send N loved tracks to X" (signed in, with something
// unsent). The words come from the manifest's verb (loveWords). It was drawn
// inside Last.fm's and ListenBrainz's scrobbling card, so no other plug-in
// could have it.
//   name, words         the plug-in's name; loveWords(verb)
//   canImport           the manifest says it can list your loves
//   state               loveRowState: { signedIn, importReady, signedOutHint, importHint }
//   pushEnabled, onSetPush
//   onImport, importRunning, importProgress, hasImported
//   onSend, sendRunning, sendProgress, unpushedCount
//   inAccount           drawn inside a username account, above its
//                       Advanced: no padding under it (Advanced has its own)
function LovedTracks({
  name, words, canImport, state,
  pushEnabled, onSetPush,
  onImport, importRunning, importProgress, hasImported,
  onSend, sendRunning, sendProgress, unpushedCount = 0,
  inAccount = false,
}) {
  const e = React.createElement;
  const w = words || { verb: 'Love', plural: 'loves', past: 'loved', tracksNoun: 'loved tracks' };
  const signedIn = !!(state && state.signedIn);
  const importHint = importRunning && importProgress
    ? (importProgress.phase === 'confirm' ? 'Waiting for confirmation…'
      : importProgress.phase === 'lookup'
        ? `Looking up names… ${importProgress.done} of ${importProgress.total}`
        : `Importing… ${importProgress.done} of ${importProgress.total}`)
    : state && state.importReady ? `Add your ${name} ${w.plural} to your Collection`
    : (state && state.importHint) || `Set up ${name} first`;
  const pluralCap = w.plural.charAt(0).toUpperCase() + w.plural.slice(1);
  // Inside an account it's a section under the account's line; otherwise a
  // block like its neighbours in "what needs the sign-in" (LibrarySync,
  // StartupRow), so it keeps their spacing after any of them.
  return e('div', { 'data-section': 'loved-tracks', style: { ...(inAccount ? { ...SECTION, paddingBottom: 0 } : BLOCK), display: 'flex', flexDirection: 'column', gap: '12px' } },
    canImport && onImport && e(SettingRow, { label: `Import ${w.tracksNoun}`, hint: importHint, style: { padding: 0 } },
      e(Button, { variant: 'secondary', size: 'sm', onClick: onImport, busy: !!importRunning, disabled: !(state && state.importReady) },
        hasImported ? 'Import new' : 'Import')),
    onSetPush && e(SettingRow, {
      label: `Push ${w.plural} to ${name}`,
      hint: signedIn ? `${w.verb} it on ${name} when you love it here` : ((state && state.signedOutHint) || `Set up ${name} first`),
      style: { padding: 0 },
    },
      e(Switch, { checked: signedIn && !!pushEnabled, disabled: !signedIn, onToggle: (v) => onSetPush(v), 'aria-label': `Push ${w.plural} to ${name}` })),
    signedIn && onSend && unpushedCount > 0 && e(SettingRow, {
      label: `Send ${countOf(unpushedCount, `${w.past} track`)} to ${name}`,
      hint: sendRunning && sendProgress
        ? `Sending… ${sendProgress.done} of ${sendProgress.total}`
        : `${pluralCap} from before you turned this on. ${name} dates them today.`,
      style: { padding: 0 },
    },
      e(Button, { variant: 'secondary', size: 'sm', onClick: onSend, busy: !!sendRunning }, 'Send')));
}

// InstallCallout: settings.installCallout { title, text, url, linkLabel },
// software the plug-in needs that Parachord can't install (Ollama).
function InstallCallout({ plugin }) {
  const e = React.createElement;
  const c = settingsOf(plugin).installCallout;
  return e('div', { style: SECTION },
    e(SettingRow, { label: c.title, hint: c.text, style: { padding: 0 } },
      c.url ? e(Button, { variant: 'secondary', size: 'sm', onClick: () => openExternal(c.url) }, c.linkLabel || 'Download') : e('span', null)));
}

// WatchFolders: settings.watchFolders, a plug-in that reads music from
// folders on this computer (Local Files): the folders, the scan and the
// library's own actions, as flat rows.
function WatchFolders({ watchFolders, isScanning, scanProgress, localFilesStats, onAddFolder, onRescanFolder, onRemoveFolder, onRescanAll, onRemoveMissing }) {
  const e = React.createElement;
  return e('div', { style: SECTION },
    e(SettingRow, { label: 'Watch folders', hint: 'Parachord adds the music in these folders and keeps watching them for changes', style: { padding: 0 } },
      e(Button, { variant: 'secondary', size: 'sm', onClick: onAddFolder, disabled: isScanning, 'aria-label': 'Add a watch folder' }, e(Icons.Plus, { className: 'w-4 h-4' }), 'Add folder')),

    // One row per folder: its path and track count, rescan and remove.
    e('div', { style: { marginTop: '8px' } },
      watchFolders.length === 0
        ? e(EmptyState, { compact: true, align: 'start', title: 'No watch folders yet' })
        : watchFolders.map((folder) =>
          e(SettingRow, {
            key: folder.path,
            label: e('span', { className: 'block truncate', 'data-tooltip': folder.path }, folder.path),
            hint: countOf(folder.track_count || 0, 'track'),
            className: 'border-b border-line-light last:border-b-0',
          },
          e('div', { className: 'flex items-center gap-1' },
            e(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Rescan folder', onClick: () => onRescanFolder(folder.path), disabled: isScanning, 'data-tooltip': 'Rescan folder' }, e(Icons.RefreshCw, { className: 'w-4 h-4' })),
            e(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Remove folder', onClick: () => onRemoveFolder(folder.path), 'data-tooltip': 'Remove folder' }, e(Icons.X, { className: 'w-4 h-4' })))))),

    // Scan progress (components/progress-bar.js).
    isScanning && e('div', { style: { marginTop: '12px' } },
      e('div', { className: 'flex items-center gap-2 text-ink-secondary', style: { fontSize: '13px', marginBottom: '8px' } },
        e(Icons.Spinner, { className: 'w-4 h-4 text-accent' }), 'Scanning…'),
      e(ProgressBar, { value: scanProgress.current, max: scanProgress.total, label: 'Scanning folders' }),
      e('p', { className: 'truncate text-ink-tertiary', style: { fontSize: '11px', marginTop: '6px' } }, scanProgress.file || 'Preparing…')),

    // The library: what's in it and when it was last scanned, then its two
    // actions, each a row of its own.
    e('div', { style: BLOCK },
      e(SettingRow, {
        label: 'Library',
        hint: e('span', null,
          countOf(localFilesStats.totalTracks, 'track'), ' · ',
          e('span', { 'data-tooltip': localFilesStats.lastScan ? new Date(localFilesStats.lastScan).toLocaleString() : undefined },
            localFilesStats.lastScan ? `scanned ${timeAgo(localFilesStats.lastScan)}` : 'not scanned yet')),
        style: { padding: '0 0 10px' },
      },
      e(Button, { variant: 'secondary', size: 'sm', onClick: onRescanAll, disabled: isScanning || watchFolders.length === 0 }, 'Rescan all')),
      e(SettingRow, { label: 'Missing files', hint: 'Remove tracks whose files are no longer on disk', style: { padding: '10px 0 0' } },
        e(Button, { variant: 'secondary', size: 'sm', onClick: onRemoveMissing, disabled: isScanning || watchFolders.length === 0, 'aria-label': 'Remove missing files' }, 'Remove'))));
}

module.exports = {
  ServiceAccount, ClientKeys, AdvancedKeys, UsernameAccount, LibrarySync, StartupRow, InstallCallout, WatchFolders, PluginSwitches, PlaybackQualityRow, LovedTracks,
  switchesOf, switchOn, settingsOf, configurableOf, authTypeOf, accountOf, advancedFieldsOf, DEFAULT_AUTH_PORT, shownKeyValues };
