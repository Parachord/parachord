# Repository Sync

This monorepo contains components that are also published to dedicated repositories for standalone distribution. Changes made here are automatically synced to those repos.

## Synced Components

| Component | Source Path | Dedicated Repo |
|-----------|-------------|----------------|
| Browser Extension | `parachord-extension/` | [Parachord/parachord-browser-extension](https://github.com/Parachord/parachord-browser-extension) |
| Raycast Extension | `raycast-extension/` | [Parachord/parachord-raycast](https://github.com/Parachord/parachord-raycast) |
| Plug-ins (marketplace) | `plugins/*.axe` and `marketplace-manifest.json` | [Parachord/parachord-plugins](https://github.com/Parachord/parachord-plugins) |

## How It Works

The `.github/workflows/sync-repos.yml` workflow automatically syncs changes:

1. **On push to main/master**: If any files in the synced paths change, the workflow triggers
2. **Manual dispatch**: Can be triggered manually from the Actions tab

The workflow:
- Detects which files changed
- Clones the target repo
- Copies updated files from the source path
- Commits with a reference to the source commit
- Pushes to the dedicated repo

### Plug-ins

The `sync-plugins` job in the same workflow runs when a push touches `plugins/**` or `marketplace-manifest.json`. It diffs the whole push range (not just the top commit), copies every `plugins/*.axe` into `Parachord/parachord-plugins` without deleting community-contributed plug-ins there, and merges `marketplace-manifest.json` into that repo's `manifest.json`: entries that exist here replace theirs, new entries are appended, and community-only entries are kept. The `.axe` files are generated from `plugins-src/<id>/` by `node scripts/build-axes.js`, so a plug-in change reaches the marketplace only after the regenerated `.axe` (with a bumped version) is committed. See [docs/architecture/plugins.md](../architecture/plugins.md).

## Reverse Sync

`.github/workflows/reverse-sync.yml` runs daily at 6 AM UTC (and on manual dispatch) and brings changes made in the dedicated repos back here as pull requests, one job each for the browser extension, the Raycast extension and the plug-ins. The plug-ins job is version-aware: it adopts a `parachord-plugins` `.axe` only when this repo has no copy yet (a community contribution) or the remote version is strictly greater, so a lagging forward sync cannot propose a downgrade (see #754). A reverse-synced `.axe` then has to be absorbed into `plugins-src/` with `node scripts/build-axes.js --import --plugin <id>` before the drift test passes (see [docs/architecture/plugins.md](../architecture/plugins.md)).

## Setup Requirements

### REPO_SYNC_TOKEN Secret

A Personal Access Token (PAT) with `repo` scope must be added as a repository secret named `REPO_SYNC_TOKEN`.

To create the token:
1. Go to GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)
2. Generate a new token with `repo` scope
3. Add it as a repository secret in this repo's Settings > Secrets and variables > Actions

### Target Repository Setup

The dedicated repos should:
1. Exist and be accessible with the REPO_SYNC_TOKEN
2. Have a `main` or `master` branch
3. Allow pushes from the token owner

## Manual Sync

To manually trigger a sync:
1. Go to Actions > Sync to Dedicated Repos (or Reverse Sync from Dedicated Repos)
2. Click "Run workflow"
3. Select which components to sync (browser extension, Raycast extension, plug-ins)
4. Click "Run workflow"

## Adding New Synced Components

To add a new component to sync:

1. Add a new path filter in `sync-repos.yml`:
   ```yaml
   paths:
     - 'parachord-extension/**'
     - 'new-component/**'  # Add new path
   ```

2. Add a new job for the component (copy the `sync-browser-extension` job and modify paths/repo)

3. Update this documentation

## Troubleshooting

### "REPO_SYNC_TOKEN secret is not set"
Add the PAT secret as described in Setup Requirements.

### "No changes to sync"
The target repo already has the same content. This is normal if the sync already ran.

### Push fails with 403
The REPO_SYNC_TOKEN doesn't have permission to push to the target repo. Ensure the token has `repo` scope and the owner has write access to the target repo.
