// Parachord Browser Extension - Inline Send Buttons
// Adds "Send to Parachord" buttons next to supported music links and embeds on any webpage

(function () {
  'use strict';

  // -- Constants --
  const ATTR = 'data-parachord-btn';
  const BTN_CLASS = 'parachord-send-btn';
  const MAX_BUTTONS = 200;

  // Supported link URL patterns
  const LINK_PATTERNS = [
    /^https?:\/\/open\.spotify\.com\/(intl-[^/]+\/)?(track|album|playlist)\/[a-zA-Z0-9]+/,
    /^https?:\/\/music\.apple\.com\/[^/]+\/(album|playlist|song)\//,
    /^https?:\/\/(www\.)?youtube\.com\/watch\?/,
    /^https?:\/\/youtu\.be\/[a-zA-Z0-9_-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/playlist\?/,
    /^https?:\/\/[^.]+\.bandcamp\.com\/(track|album)\//,
    /^https?:\/\/soundcloud\.com\/[^/]+\/[^/]+/,
  ];

  // Embed iframe patterns with URL extractors
  const EMBED_PATTERNS = [
    {
      re: /^https?:\/\/(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
      url: (m) => `https://www.youtube.com/watch?v=${m[2]}`,
    },
    {
      re: /^https?:\/\/open\.spotify\.com\/embed\/(track|album|playlist)\/([a-zA-Z0-9]+)/,
      url: (m) => `https://open.spotify.com/${m[1]}/${m[2]}`,
    },
    {
      re: /^https?:\/\/embed\.music\.apple\.com(\/[^?]+)/,
      url: (m) => `https://music.apple.com${m[1]}`,
    },
  ];

  // Skip links inside these elements (inserting buttons here would break layout/semantics)
  const SKIP_SELECTOR = 'button, select, option, textarea, input, svg, math, canvas, video, audio, picture, pre, code, script, style, noscript';

  // -- State --
  let enabled = true;
  let buttonCount = 0;
  let observer = null;
  let stylesInjected = false;

  // -- Init: check settings then start --
  chrome.storage.local.get(['inlineButtonsEnabled'], (result) => {
    enabled = result.inlineButtonsEnabled !== false;
    if (enabled) start();
  });

  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local' || !('inlineButtonsEnabled' in changes)) return;
    enabled = changes.inlineButtonsEnabled.newValue !== false;
    if (enabled) {
      start();
    } else {
      stop();
    }
  });

  // -- URL matching --
  function matchLink(href) {
    return LINK_PATTERNS.some((p) => p.test(href));
  }

  function matchEmbed(src) {
    for (const { re, url } of EMBED_PATTERNS) {
      const m = src.match(re);
      if (m) return url(m);
    }
    return null;
  }

  // -- DOM helpers --
  function shouldSkip(el) {
    return !!el.closest(SKIP_SELECTOR);
  }

  function createButton(targetUrl) {
    const btn = document.createElement('span');
    btn.className = BTN_CLASS;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Send to Parachord');
    btn.title = 'Send to Parachord';

    // Inline Parachord "p" icon
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.style.cssText = 'pointer-events:none;display:block;';
    svg.innerHTML =
      '<g transform="translate(16,10) scale(.75)" fill="white">' +
      '<path d="M104 52c0 18.8-12.2 35.5-31 35.5S40 70.8 40 52s14.3-34.5 33-34.5S104 33.2 104 52z" fill="#1f2937"/>' +
      '<path d="M72.5 4.5c24.2 0 45 20.8 45 48s-20.8 48-45 48-45-20.8-45-48 20.8-48 45-48z" stroke="white" stroke-width="27" fill="none"/>' +
      '<rect x="14" y="50" width="25" height="95"/>' +
      '<path d="M29.3 92c.9 2.1 3.7 2.4 5.1.6L72 43.3V158H-31V-13h14.4L29.3 92z"/>' +
      '</g>';
    btn.appendChild(svg);

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      send(targetUrl, btn);
    };
    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });

    buttonCount++;
    return btn;
  }

  function send(url, btn) {
    btn.classList.add('sending');
    try {
      chrome.runtime.sendMessage(
        { type: 'sendToParachord', url, source: 'inline-button' },
        (resp) => {
          btn.classList.remove('sending');
          if (chrome.runtime.lastError) {
            flash(btn, 'error', 'Extension error');
          } else if (resp?.sent) {
            flash(btn, 'sent', 'Sent!');
          } else {
            flash(btn, 'queued', 'Queued');
          }
        }
      );
    } catch {
      btn.classList.remove('sending');
      flash(btn, 'error', 'Extension error');
    }
  }

  function flash(btn, cls, title) {
    btn.classList.add(cls);
    btn.title = title;
    setTimeout(() => {
      btn.classList.remove(cls);
      btn.title = 'Send to Parachord';
    }, 2500);
  }

  // -- Scanning --
  function scan(root) {
    if (!enabled || !root || buttonCount >= MAX_BUTTONS) return;

    // Process the root element itself if it's a link or iframe
    if (root.tagName === 'A' && root.href && !root.hasAttribute(ATTR)) {
      processLink(root);
    } else if (root.tagName === 'IFRAME' && root.src && !root.hasAttribute(ATTR)) {
      processEmbed(root);
    }

    // Process descendants
    if (!root.querySelectorAll) return;

    for (const a of root.querySelectorAll(`a[href]:not([${ATTR}])`)) {
      if (buttonCount >= MAX_BUTTONS) break;
      processLink(a);
    }

    for (const iframe of root.querySelectorAll(`iframe[src]:not([${ATTR}])`)) {
      if (buttonCount >= MAX_BUTTONS) break;
      processEmbed(iframe);
    }
  }

  function processLink(a) {
    a.setAttribute(ATTR, '');
    try {
      if (matchLink(a.href) && !shouldSkip(a)) {
        a.after(createButton(a.href));
      }
    } catch {}
  }

  function processEmbed(iframe) {
    iframe.setAttribute(ATTR, '');
    try {
      const url = matchEmbed(iframe.src);
      if (url && !shouldSkip(iframe)) {
        iframe.after(createButton(url));
      }
    } catch {}
  }

  // -- Lifecycle --
  function start() {
    if (observer) return;
    injectStyles();
    scan(document.body);

    observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            !node.classList?.contains(BTN_CLASS)
          ) {
            scan(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    for (const btn of document.querySelectorAll(`.${BTN_CLASS}`)) btn.remove();
    for (const el of document.querySelectorAll(`[${ATTR}]`)) {
      el.removeAttribute(ATTR);
    }
    buttonCount = 0;
  }

  // -- Styles --
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const s = document.createElement('style');
    s.textContent =
      `.${BTN_CLASS}{` +
        'display:inline-flex;align-items:center;justify-content:center;' +
        'width:20px;height:20px;margin-left:4px;padding:0;' +
        'border:none;border-radius:4px;background:#1f2937;' +
        'cursor:pointer;opacity:.55;' +
        'transition:opacity .15s,background .15s,transform .1s;' +
        'vertical-align:middle;position:relative;line-height:1;' +
        'box-shadow:0 0 0 1px rgba(255,255,255,.12)' +
      '}' +
      `.${BTN_CLASS}:hover{opacity:1;transform:scale(1.15)}` +
      `.${BTN_CLASS}:active{transform:scale(.92)}` +
      `.${BTN_CLASS}:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}` +
      `.${BTN_CLASS}.sending{opacity:.35;pointer-events:none}` +
      `.${BTN_CLASS}.sent{background:#22c55e;opacity:1}` +
      `.${BTN_CLASS}.queued{background:#f59e0b;opacity:1}` +
      `.${BTN_CLASS}.error{background:#ef4444;opacity:1}`;
    (document.head || document.documentElement).appendChild(s);
  }
})();
