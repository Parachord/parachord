// Parachord Browser Extension - Vibeset Content Script
// Scrapes setlists from vibeset.ai setlist view pages

(function() {
  'use strict';

  console.log('[Parachord] Vibeset content script loaded');

  // Wait for an element matching a selector to appear in the DOM
  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) { resolve(existing); return; }

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Timeout waiting for ' + selector));
      }, timeout);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
  }

  // Convert duration_ms (milliseconds) to seconds
  function msToSeconds(ms) {
    if (!ms) return 0;
    const num = parseInt(ms, 10);
    return isNaN(num) ? 0 : Math.round(num / 1000);
  }

  // Parse "M:SS" or "H:MM:SS" time strings to seconds
  function parseTimeString(str) {
    if (!str) return 0;
    const cleaned = str.trim();
    const parts = cleaned.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  // Extract setlist title from the page
  function getSetlistTitle() {
    // Look for a prominent heading that contains the setlist name
    // Try various selectors: h1, h2, or elements that look like titles
    const candidates = [
      'h1',
      'h2',
      '[class*="title" i]',
      '[class*="Title" i]'
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = el.textContent.trim();
        // Skip loading messages and nav items
        if (text && text.length > 0 && text.length < 200 &&
            !text.includes('Fetching setlist') &&
            !text.includes('Please wait') &&
            !text.includes('Vibeset') &&
            el.offsetParent !== null) { // Visible
          return text;
        }
      }
    }
    return document.title.replace(/\s*[-–|]\s*Vibeset\s*$/i, '').trim() || 'Vibeset Setlist';
  }

  // Primary strategy: find the React Aria table with aria-label="Setlist tracks"
  function scrapeFromTable() {
    const tracks = [];

    // The table uses React Aria with aria-label="Setlist tracks"
    const table = document.querySelector('[aria-label="Setlist tracks"]') ||
                  document.querySelector('table') ||
                  document.querySelector('[role="grid"]') ||
                  document.querySelector('[role="table"]');

    if (!table) return null;

    // Find all rows in the table body
    // React Aria renders: <div role="row"> inside <div role="rowgroup">
    const rows = table.querySelectorAll('[role="row"]:not([role="row"] [role="columnheader"])');
    // Filter out header rows
    const bodyRows = [];
    for (const row of rows) {
      // Skip rows that contain columnheader cells (header rows)
      if (row.querySelector('[role="columnheader"]')) continue;
      // Skip rows that are inside a thead or header rowgroup
      const parent = row.parentElement;
      if (parent && parent.getAttribute('role') === 'rowgroup') {
        // Check if it's the first rowgroup (header) - header comes first
        const allRowgroups = table.querySelectorAll('[role="rowgroup"]');
        if (allRowgroups.length > 1 && parent === allRowgroups[0]) continue;
      }
      bodyRows.push(row);
    }

    // Also try standard tr elements if no role="row" found
    const rowElements = bodyRows.length > 0 ? bodyRows : table.querySelectorAll('tbody tr');

    rowElements.forEach((row, index) => {
      const cells = row.querySelectorAll('[role="gridcell"], [role="cell"], td');
      if (cells.length < 3) return; // Need at least index, track, artist

      // The Vibeset table columns (based on analysis):
      // 0: index (40px), 1: checkbox (44px), 2: Track, 3: Artist, 4: Time,
      // 5: Genre, 6: Mood, 7: Energy/Year, 8: Key, 9: BPM, 10: Insights
      //
      // However, the exact cell indices depend on which columns are visible.
      // Try to extract by looking for cells with specific classes or content patterns.

      let trackTitle = '';
      let artist = '';
      let duration = 0;

      // Strategy 1: Look for cells with known classes
      const trackCell = row.querySelector('.track-cell');
      if (trackCell) {
        trackTitle = trackCell.textContent.trim();
      }

      // Strategy 2: Use cell positions
      // Cells array - skip the first 2 (index + checkbox) if we have enough cells
      if (!trackTitle && cells.length >= 4) {
        // Cell 2 is typically Track, Cell 3 is typically Artist
        trackTitle = cells[2]?.textContent?.trim() || '';
        artist = cells[3]?.textContent?.trim() || '';

        // Cell 4 is typically Time (formatted as M:SS)
        if (cells[4]) {
          const timeText = cells[4].textContent.trim();
          if (/^\d+:\d{2}/.test(timeText)) {
            duration = parseTimeString(timeText);
          }
        }
      }

      // Strategy 3: If only 3+ cells without checkbox column
      if (!trackTitle && cells.length >= 3 && cells.length < 4) {
        trackTitle = cells[1]?.textContent?.trim() || '';
        artist = cells[2]?.textContent?.trim() || '';
      }

      // If we found a track cell via class but not the artist, try the next cell
      if (trackCell && !artist) {
        const allCells = Array.from(cells);
        const trackIdx = allCells.indexOf(trackCell);
        if (trackIdx >= 0 && allCells[trackIdx + 1]) {
          artist = allCells[trackIdx + 1].textContent.trim();
        }
        // Also try to find duration from subsequent cells
        for (let i = trackIdx + 2; i < allCells.length && !duration; i++) {
          const text = allCells[i].textContent.trim();
          if (/^\d+:\d{2}$/.test(text)) {
            duration = parseTimeString(text);
          }
        }
      }

      // Clean up - remove any leading numbers that might be track indices
      trackTitle = trackTitle.replace(/^\d+\.\s*/, '');

      if (trackTitle) {
        tracks.push({
          title: trackTitle,
          artist: artist || 'Unknown Artist',
          duration: duration,
          position: index + 1
        });
      }
    });

    return tracks.length > 0 ? tracks : null;
  }

  // Fallback strategy: find repeated elements that look like track rows
  function scrapeFromRepeatedElements() {
    const tracks = [];

    // Look for elements with setlist-body-cell class (known from Vibeset's CSS)
    const bodyCells = document.querySelectorAll('.setlist-body-cell');
    if (bodyCells.length > 0) {
      // Group cells by parent row
      const rowMap = new Map();
      bodyCells.forEach(cell => {
        const row = cell.closest('[role="row"], tr, [class*="row"]') || cell.parentElement;
        if (!rowMap.has(row)) rowMap.set(row, []);
        rowMap.get(row).push(cell);
      });

      let position = 0;
      rowMap.forEach((cells) => {
        position++;
        // Find the track-cell within this row's cells
        const trackCell = cells.find(c => c.classList.contains('track-cell'));
        const trackIdx = trackCell ? cells.indexOf(trackCell) : 2;

        const trackTitle = (trackCell || cells[Math.min(trackIdx, cells.length - 1)])?.textContent?.trim() || '';
        const artist = cells[trackIdx + 1]?.textContent?.trim() || '';
        let duration = 0;
        for (let i = trackIdx + 2; i < cells.length; i++) {
          const text = cells[i].textContent.trim();
          if (/^\d+:\d{2}$/.test(text)) {
            duration = parseTimeString(text);
            break;
          }
        }

        if (trackTitle) {
          tracks.push({
            title: trackTitle.replace(/^\d+\.\s*/, ''),
            artist: artist || 'Unknown Artist',
            duration: duration,
            position: position
          });
        }
      });

      return tracks.length > 0 ? tracks : null;
    }

    return null;
  }

  // Main scrape function
  async function scrape() {
    console.log('[Parachord] Scraping Vibeset setlist...');

    // Wait for the setlist table to appear (the page shows "Fetching setlist..." initially)
    try {
      await waitForElement('[aria-label="Setlist tracks"], .setlist-body-cell, [role="grid"], table', 15000);
      // Give React a moment to finish rendering all rows
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log('[Parachord] Timed out waiting for setlist table:', e.message);
    }

    const title = getSetlistTitle();

    // Try primary table scraping
    let tracks = scrapeFromTable();

    // Fallback to cell-based scraping
    if (!tracks) {
      tracks = scrapeFromRepeatedElements();
    }

    if (!tracks || tracks.length === 0) {
      console.log('[Parachord] No tracks found on Vibeset page');
      return null;
    }

    console.log(`[Parachord] Scraped Vibeset setlist: ${title} (${tracks.length} tracks)`);

    return {
      type: 'playlist',
      name: title,
      tracks: tracks,
      url: window.location.href,
      scrapedAt: new Date().toISOString()
    };
  }

  // Listen for scrape requests from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'scrapePlaylist' || message.type === 'scrapeVibeset') {
      console.log('[Parachord] Received scrape request for Vibeset');
      scrape().then(result => {
        sendResponse(result);
      }).catch(err => {
        console.error('[Parachord] Scrape error:', err);
        sendResponse(null);
      });
      return true; // Keep channel open for async response
    }
  });

})();
