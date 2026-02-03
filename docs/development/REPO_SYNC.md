# Repository Sync

This monorepo contains components that are also published to dedicated repositories for standalone distribution. Changes made here are automatically synced to those repos.

## Synced Components

| Component | Source Path | Dedicated Repo |
|-----------|-------------|----------------|
| Browser Extension | `parachord-extension/` | [Parachord/parachord-browser-extension](https://github.com/Parachord/parachord-browser-extension) |

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
1. Go to Actions > Sync to Dedicated Repos
2. Click "Run workflow"
3. Select which components to sync
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
