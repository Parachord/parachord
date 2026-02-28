/**
 * Search history service — stores recent search queries and selected results.
 *
 * Mirrors the IPC-based search history from main.js but as a service
 * backed by the server Store.
 */

const MAX_HISTORY = 50;

class SearchHistoryService {
  constructor(store) {
    this.store = store;
  }

  /**
   * Load all search history entries (most recent first).
   */
  load() {
    return this.store.get('search_history', []);
  }

  /**
   * Save a search history entry. Updates existing entries (case-insensitive match)
   * or adds a new one at the front.
   *
   * @param {{ query: string, selectedResult?: object }} entry
   * @returns {{ success: boolean, error?: string }}
   */
  save(entry) {
    if (!entry || typeof entry.query !== 'string' || !entry.query.trim()) {
      return { success: false, error: 'Invalid entry: missing or empty query' };
    }

    const history = this.store.get('search_history', []);

    const existingIndex = history.findIndex(h =>
      h.query?.toLowerCase() === entry.query.toLowerCase()
    );

    if (existingIndex >= 0) {
      history[existingIndex] = {
        ...history[existingIndex],
        ...entry,
        timestamp: Date.now()
      };
    } else {
      history.unshift({
        ...entry,
        timestamp: Date.now()
      });
    }

    const trimmed = history.slice(0, MAX_HISTORY);
    trimmed.sort((a, b) => b.timestamp - a.timestamp);

    this.store.set('search_history', trimmed);
    return { success: true };
  }

  /**
   * Clear a single entry by query (case-insensitive) or all entries.
   *
   * @param {string} [entryQuery] - Query to remove, or omit to clear all
   * @returns {{ success: boolean }}
   */
  clear(entryQuery) {
    if (entryQuery) {
      const history = this.store.get('search_history', []);
      const filtered = history.filter(h =>
        h.query?.toLowerCase() !== entryQuery.toLowerCase()
      );
      this.store.set('search_history', filtered);
    } else {
      this.store.set('search_history', []);
    }
    return { success: true };
  }
}

module.exports = SearchHistoryService;
