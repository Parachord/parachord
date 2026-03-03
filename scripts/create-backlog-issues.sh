#!/usr/bin/env bash
# Creates GitHub Issues for all undone TODO items and adds them as Backlog
# items to the Parachord project board.
#
# Prerequisites:
#   gh auth login
#
# Usage:
#   ./scripts/create-backlog-issues.sh
#
# Set DRY_RUN=1 to preview without creating anything:
#   DRY_RUN=1 ./scripts/create-backlog-issues.sh

set -euo pipefail

REPO="Parachord/parachord"
PROJECT_NUMBER=1
ORG="Parachord"

# ---------- pre-flight checks ------------------------------------------------

# Warn (but don't block) if the token is missing 'project' scope
if ! gh project list --owner "$ORG" --limit 1 &>/dev/null; then
  echo "⚠ Warning: Cannot access project board (missing 'project' scope?)."
  echo "  Issues will still be created, but won't be added to the project."
  echo "  To fix: gh auth refresh -s project"
  echo ""
fi

# ---------- helpers ----------------------------------------------------------

create_issue_and_add() {
  local title="$1"
  local body="$2"
  local label="$3"
  local priority="$4"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "[dry-run] Would create: $title  [$label, $priority]"
    return
  fi

  # Idempotency: skip if an open issue with the same title already exists
  local existing
  existing=$(gh issue list --repo "$REPO" --search "\"$title\" in:title" --state open --json number,title --jq ".[] | select(.title == \"$title\") | .number" 2>/dev/null || true)

  if [[ -n "$existing" ]]; then
    echo "Skipping (already exists as #$existing): $title"
    local url="https://github.com/$REPO/issues/$existing"
  else
    echo "Creating issue: $title"
    local url
    url=$(gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$label" 2>&1)
    echo "  -> $url"
  fi

  # Add to project board as Backlog (non-fatal if scopes are missing)
  local item_id
  item_id=$(gh project item-add "$PROJECT_NUMBER" --owner "$ORG" --url "$url" --format json 2>/dev/null | jq -r '.id' 2>/dev/null) || true

  if [[ -z "$item_id" || "$item_id" == "null" ]]; then
    echo "  ⚠ Could not add to project board (missing 'project' scope? run: gh auth refresh -s project)"
    echo ""
    return
  fi
  echo "  -> Added to project (item $item_id)"

  # Cache project metadata on first call to avoid repeated API requests
  if [[ -z "${_PROJECT_ID:-}" ]]; then
    _PROJECT_ID=$(gh project list --owner "$ORG" --format json 2>/dev/null | jq -r ".projects[] | select(.number == $PROJECT_NUMBER) | .id" 2>/dev/null) || true

    if [[ -n "$_PROJECT_ID" ]]; then
      local fields_json
      fields_json=$(gh project field-list "$PROJECT_NUMBER" --owner "$ORG" --format json 2>/dev/null) || true

      _STATUS_FIELD_ID=$(echo "$fields_json" | jq -r '.fields[] | select(.name == "Status") | .id' 2>/dev/null) || true
      _BACKLOG_OPTION_ID=$(echo "$fields_json" | jq -r '.fields[] | select(.name == "Status") | .options[]? | select(.name == "Backlog") | .id' 2>/dev/null) || true
      _PRIORITY_FIELD_ID=$(echo "$fields_json" | jq -r '.fields[] | select(.name == "Priority") | .id' 2>/dev/null) || true
      _PRIORITY_OPTIONS_JSON=$(echo "$fields_json" | jq -c '.fields[] | select(.name == "Priority") | .options // []' 2>/dev/null) || true
    fi
  fi

  # Set status to Backlog
  if [[ -n "${_PROJECT_ID:-}" && -n "${_STATUS_FIELD_ID:-}" && -n "${_BACKLOG_OPTION_ID:-}" ]]; then
    gh project item-edit --project-id "$_PROJECT_ID" --id "$item_id" --field-id "$_STATUS_FIELD_ID" --single-select-option-id "$_BACKLOG_OPTION_ID" 2>/dev/null || true
    echo "  -> Status set to Backlog"
  fi

  # Set priority field if present
  if [[ -n "${_PROJECT_ID:-}" && -n "${_PRIORITY_FIELD_ID:-}" && "$priority" != "none" ]]; then
    local priority_option_id
    priority_option_id=$(echo "$_PRIORITY_OPTIONS_JSON" | jq -r ".[]? | select(.name == \"$priority\") | .id" 2>/dev/null) || true

    if [[ -n "$priority_option_id" ]]; then
      gh project item-edit --project-id "$_PROJECT_ID" --id "$item_id" --field-id "$_PRIORITY_FIELD_ID" --single-select-option-id "$priority_option_id" 2>/dev/null || true
      echo "  -> Priority set to $priority"
    fi
  fi

  echo ""
}

# ---------- ensure labels exist -----------------------------------------------

ensure_labels() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then return; fi

  for label in "resolver" "playlist" "library" "social" "ux" "playback" "platform" "integration" "developer" "maintenance" "bug"; do
    gh label create "$label" --repo "$REPO" --force 2>/dev/null || true
  done
}

ensure_labels

# ---------- High Priority -----------------------------------------------------

create_issue_and_add \
  "Tidal resolver — hi-res streaming" \
  "Add a Tidal content resolver plugin (\`.axe\`) to enable hi-res streaming from Tidal as a playback source.

### Requirements
- Tidal OAuth or device-code authentication
- Track search and resolution
- Hi-res/lossless stream URL extraction
- Integration with the existing resolver priority system

### Context
From TODO.md — High Priority / Resolvers" \
  "resolver" \
  "High"

create_issue_and_add \
  "Deezer resolver — additional streaming source" \
  "Add a Deezer content resolver plugin (\`.axe\`) to provide an additional streaming source.

### Requirements
- Deezer OAuth authentication
- Track search and resolution
- Stream URL extraction
- Integration with the existing resolver priority system

### Context
From TODO.md — High Priority / Resolvers" \
  "resolver" \
  "High"

create_issue_and_add \
  "Qobuz full streaming — user authentication" \
  "Add full Qobuz streaming support with user authentication. Currently Qobuz is listed as a resolver but lacks authenticated streaming.

### Requirements
- Qobuz user authentication flow
- Authenticated stream URL retrieval (hi-res/lossless)
- Library sync support

### Context
From TODO.md — High Priority / Resolvers" \
  "resolver" \
  "High"

create_issue_and_add \
  "Smart playlists — auto-generate from listening history" \
  "Implement smart/dynamic playlists that auto-generate and update based on listening history, genre preferences, and configurable rules (similar to smarterplaylists.com).

### Requirements
- Rule-based playlist generation (genre, era, play count, recency, etc.)
- Auto-refresh when new listening data arrives
- Integration with existing AI playlist generation

### Context
From TODO.md — High Priority / Playlists" \
  "playlist" \
  "High"

# ---------- Medium Priority ---------------------------------------------------

create_issue_and_add \
  "Import/export library — backup and restore" \
  "Allow users to export their full library (collection, playlists, listening history, settings) to a portable format and import/restore from that backup.

### Requirements
- Export to JSON or ZIP archive
- Import with merge/overwrite options
- Include playlists, collection, history, and settings

### Context
From TODO.md — Medium Priority / Library" \
  "library" \
  "Medium"

create_issue_and_add \
  "Collaborative playlists — multi-user editing" \
  "Enable multiple users to collaboratively edit the same playlist in real-time or near-real-time.

### Requirements
- Shared playlist links with edit permissions
- Conflict resolution for concurrent edits
- Activity feed showing who added what

### Context
From TODO.md — Medium Priority / Social" \
  "social" \
  "Medium"

create_issue_and_add \
  "Listening parties — synchronized group listening" \
  "Allow groups of users to listen to the same music simultaneously in a shared session.

### Requirements
- Session creation and invite links
- Synchronized playback across participants
- Chat or reactions during the session
- Host controls (play/pause/skip)

### Context
From TODO.md — Medium Priority / Social" \
  "social" \
  "Medium"

create_issue_and_add \
  "Themes — light/dark mode toggle" \
  "Add a light theme and a toggle to switch between light and dark modes. Currently only dark mode is available.

### Requirements
- Light theme CSS/design tokens
- System preference detection (prefers-color-scheme)
- Manual toggle in Settings
- Persistent preference

### Context
From TODO.md — Medium Priority / Accessibility & UX" \
  "ux" \
  "Medium"

create_issue_and_add \
  "Tour dates/tickets — Bandsintown/Songkick integration" \
  "Show upcoming tour dates and ticket links on Artist Pages using data from Bandsintown, Songkick, or similar APIs.

### Requirements
- Fetch upcoming shows for the displayed artist
- Display dates, venues, and ticket links
- Integrate into existing Artist Page layout

### Context
From TODO.md — Medium Priority / Artist Pages" \
  "integration" \
  "Medium"

# ---------- Future Considerations ---------------------------------------------

create_issue_and_add \
  "Mobile apps — iOS/Android" \
  "Explore building mobile companion apps for iOS and Android.

### Considerations
- React Native or native implementation
- Subset of desktop features vs. full parity
- Sync with desktop app state
- Push notifications for friend activity

### Context
From TODO.md — Future Considerations / Platform & Distribution" \
  "platform" \
  "Low"

create_issue_and_add \
  "DMG installer background — custom drag-to-Applications artwork" \
  "Add a custom background image to the macOS DMG installer with a drag arrow pointing to the Applications folder.

### Context
From TODO.md — Future Considerations / Platform & Distribution" \
  "platform" \
  "Low"

create_issue_and_add \
  "Repeat modes — repeat one, repeat all, no repeat" \
  "Implement repeat/loop modes for the playback queue.

### Requirements
- Repeat Off (default)
- Repeat All (loop entire queue)
- Repeat One (loop current track)
- Visual indicator in transport controls

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Gapless playback — seamless track transitions" \
  "Eliminate the gap between consecutive tracks for a seamless listening experience, particularly for live albums and concept albums.

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Crossfade — configurable fade between tracks" \
  "Add audio crossfading with a configurable duration (e.g., 0–12 seconds) for smooth transitions between tracks.

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Lyrics display — synced lyrics from LRC files" \
  "Display time-synced lyrics alongside the currently playing track using LRC files or a lyrics API.

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Equalizer — adjustable EQ bands" \
  "Add a graphical equalizer with adjustable frequency bands and presets.

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Sleep timer — auto-stop after duration" \
  "Add a sleep timer that automatically stops playback after a configurable duration or number of tracks.

### Context
From TODO.md — Future Considerations / Playback" \
  "playback" \
  "Low"

create_issue_and_add \
  "Backend server — optional server for advanced features" \
  "Explore an optional backend server component for features that benefit from server-side processing (e.g., collaborative features, cross-device sync, smart link enrichment).

### Context
From TODO.md — Future Considerations / Advanced Features" \
  "platform" \
  "Low"

create_issue_and_add \
  "Discord Rich Presence — show now playing" \
  "Integrate with Discord Rich Presence to display the currently playing track, album art, and playback status in the user's Discord profile.

### Context
From TODO.md — Future Considerations / Advanced Features" \
  "integration" \
  "Low"

create_issue_and_add \
  "Community features — Matrix.org integration" \
  "Explore community features using Matrix.org for decentralized chat and social interaction between Parachord users.

### Context
From TODO.md — Future Considerations / Advanced Features" \
  "social" \
  "Low"

create_issue_and_add \
  "TypeScript migration — type safety" \
  "Incrementally migrate the codebase from JavaScript to TypeScript for improved type safety and developer experience.

### Approach
- Start with new files and shared modules
- Add \`.d.ts\` declarations for existing modules
- Gradual migration of critical paths

### Context
From TODO.md — Future Considerations / Developer" \
  "developer" \
  "Low"

# ---------- Maintenance -------------------------------------------------------

create_issue_and_add \
  "Rotate MusicKit .p8 key (437JVHZMMK exposed in git history)" \
  "The old MusicKit private key (\`437JVHZMMK\`) was exposed in git history. While it has been removed from the tree and is now injected via GitHub Actions secret, the old key should be revoked and replaced.

### Steps
1. Log into Apple Developer Portal
2. Revoke the old key (\`437JVHZMMK\`)
3. Generate a new MusicKit private key
4. Update the \`MUSICKIT_PRIVATE_KEY\` GitHub Actions secret
5. Update the key ID reference in \`main.js\`

### Context
From TODO.md — Maintenance" \
  "maintenance" \
  "Medium"

# ---------- Known Issues (bugs) -----------------------------------------------

create_issue_and_add \
  "Bug: Bandcamp embedded player autoplay unreliable" \
  "The Bandcamp embedded player's autoplay is unreliable — tracks sometimes don't start playing automatically when resolved to Bandcamp.

### Context
From TODO.md — Known Issues" \
  "bug" \
  "Medium"

create_issue_and_add \
  "Bug: Apple Music playlist extraction — serialized-server-data parsing incomplete" \
  "Parsing of Apple Music's \`serialized-server-data\` format is incomplete, which prevents full playlist extraction from Apple Music URLs.

### Context
From TODO.md — Known Issues" \
  "bug" \
  "Medium"

echo "Done! All backlog items created."
