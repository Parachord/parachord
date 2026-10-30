// src/renderer/lib/home-suggestions-refresh.js — whether opening Home asks the
// AI provider for new Album and Artist Suggestions.
//
// By default the suggestions on screen stay until the user presses Refresh;
// the "Refresh Home suggestions on every visit" setting
// (`home_suggestions_auto_refresh`) brings back a new batch per visit. With
// no albums to show there is no Refresh button (it sits on the Album
// Suggestions row), so Home fetches on its own in that case either way.

function shouldAutoRefreshHomeSuggestions({ autoRefresh, suggestions } = {}) {
  if (autoRefresh) return true;
  return !(suggestions && Array.isArray(suggestions.albums) && suggestions.albums.length > 0);
}

module.exports = { shouldAutoRefreshHomeSuggestions };
