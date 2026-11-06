# Preparing Waypoint for public sharing

The source uses illustrative projects and paths. EIO oral exam preparation is the public example; actual task names, materials, chat links, timing, and history belong in the configured data directory. Run `node waypoint.cjs paths` to find that directory. Do not move or reset it to prepare a release.

## Check the snapshot

Review `git status --short`, `git diff`, and `git ls-files` before committing. The following must remain untracked: `data/`, `tasks/`, `waypoint.local.json`, `.test-output/`, logs, and exports containing personal history. If using a custom data directory inside the repository, add its path to `.gitignore` before creating files there. Ignore rules do not remove files already tracked.

Inspect tracked images as well as text. `docs/preview.png` contains example seminar data. Screenshots of real work belong in `.test-output/`. Commit author and committer identities are public metadata even when no email appears in source files.

## Set a public commit identity

In PowerShell, from the repository root, copy your exact GitHub-provided no-reply address from GitHub Settings → Emails. Choose a display name you are comfortable publishing. These commands affect this repository only:

```powershell
$WaypointPublicEmail = Read-Host 'Your exact GitHub no-reply email'
if ($WaypointPublicEmail -notmatch '^[^\s@]+@users\.noreply\.github\.com$') {
    throw 'Use the exact no-reply address shown in GitHub settings.'
}
$WaypointPublicName = Read-Host 'Public commit display name'
if ([string]::IsNullOrWhiteSpace($WaypointPublicName)) { throw 'A display name is required.' }
git config --local user.email $WaypointPublicEmail
if ($LASTEXITCODE -ne 0) { throw 'Could not set commit email.' }
git config --local user.name $WaypointPublicName
if ($LASTEXITCODE -ne 0) { throw 'Could not set commit name.' }
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Verify both identities before committing. Environment overrides can take precedence over Git configuration. Changing configuration does not change existing commits. See [GitHub's commit email guide](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).

Commit the reviewed cleanup locally. `git add -u` stages tracked changes only; the new guide is added explicitly. Review the staged diff before running the commit command:

```powershell
git add -u
git add -- docs/public-sharing.md
git diff --cached
git commit -m 'chore: replace personal references with public examples'
```

## Optional: replace main with a clean history root

A normal cleanup commit leaves older paths and identities in history. A new branch based on the existing main also inherits that history. If you want a fresh public history, create a root commit with the cleaned snapshot and no parent. This retains the repository URL and does not require deleting main or the repository.

Run these commands only after the cleanup commit, from local main, with no uncommitted changes. They prepare a local branch and an ignored private history backup; they do not publish anything:

```powershell
if ((git branch --show-current) -ne 'main') { throw 'Start on local main.' }
if (git status --porcelain) { throw 'Commit or otherwise resolve pending changes first.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'Remote main has diverged; review it before replacing history.' }
$WaypointExpectedMain = (git rev-parse origin/main).Trim()

New-Item -ItemType Directory -Force -Path '.test-output' | Out-Null
$WaypointHistoryBackup = Join-Path '.test-output' ('private-history-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bundle')
git bundle create $WaypointHistoryBackup --all
if ($LASTEXITCODE -ne 0) { throw 'History backup failed.' }

$WaypointPublicRoot = git commit-tree 'HEAD^{tree}' -m 'Initial public release of Waypoint'
if ($LASTEXITCODE -ne 0) { throw 'Root commit creation failed.' }
$WaypointPublicRoot = $WaypointPublicRoot.Trim()
git branch codex/public-release $WaypointPublicRoot
if ($LASTEXITCODE -ne 0) { throw 'Branch creation failed; choose an unused branch name.' }
git show --no-patch --format=fuller codex/public-release
git rev-list --count codex/public-release
git diff --exit-code HEAD codex/public-release
if ($LASTEXITCODE -ne 0) { throw 'The public snapshot differs from the cleaned commit.' }
```

The count must be **1**, the identities must be acceptable, and the diff must be empty. No checkout, deletion, or data migration occurs. Keep the bundle private: it deliberately retains the old history. This uses [git commit-tree](https://git-scm.com/docs/git-commit-tree) without a parent.

### Publish only after reviewing the prepared root

The next command replaces **remote main's history**. Coordinate with anyone using the repository first. Keep the same PowerShell session so the captured remote commit remains available:

```powershell
if (-not $WaypointExpectedMain) { throw 'Prepare and review the root first.' }
git push "--force-with-lease=refs/heads/main:$WaypointExpectedMain" origin 'codex/public-release:refs/heads/main'
if ($LASTEXITCODE -ne 0) { throw 'Push failed; do not retry with plain --force.' }
```

The explicit [force-with-lease](https://git-scm.com/docs/git-push) refuses to overwrite main if it changed after the fetch. Repository rules may reject the push; inspect the rejection before choosing an allowed publication route. Do not use `--all` or `--mirror`, which can publish other refs containing old history.

After a successful push, align local main with the new root so later work does not reintroduce old history. Verify the files still match first:

```powershell
if ((git branch --show-current) -ne 'main') { throw 'Expected local main.' }
if (git status --porcelain) { throw 'Resolve pending changes first.' }
git diff --exit-code HEAD codex/public-release
if ($LASTEXITCODE -ne 0) { throw 'Snapshots differ; stop and review.' }
git reset --soft codex/public-release
if ($LASTEXITCODE -ne 0) { throw 'Could not align local main.' }
git status --short
```

This moves the local branch pointer while leaving the index and working files intact, including ignored local configuration and data. Old objects can remain locally in reflogs and the private bundle. Existing collaborators should use a fresh clone or carefully rebase their work onto the new root, never merge the old history back.

## Limits of replacing history

Replacing main does not erase old commits from other branches, tags, pull requests, forks, cached views, or other people's clones. Review those separately. GitHub's [sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) explains these limits and when GitHub Support can help. A newly created public repository can also receive the parentless release branch, but deleting the old repository does not erase existing copies elsewhere.
