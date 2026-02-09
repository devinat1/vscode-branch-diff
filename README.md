# Branch Diff

A VS Code extension that shows the complete diff of your current branch compared to a base branch (e.g. `main`). It provides two views into your changes:

1. **Sidebar tree view** -- lists all changed files grouped by directory
2. **Gutter indicators** -- colored vertical bars in the editor showing exactly which lines were added, modified, or deleted

## Features

- Automatic detection of `main`/`master` as the base branch
- File tree grouped by directory with status icons (added, modified, deleted, renamed)
- Click any file to open a side-by-side diff
- Line-level gutter decorations: green (added), blue (modified), red (deleted)
- Toggle gutter indicators on/off via the eye icon or command palette
- Change the base branch at any time via the branch icon
- Auto-refresh when git state changes (new commits, rebases, etc.)

## Settings

| Setting | Default | Description |
|---|---|---|
| `branchDiff.defaultBaseBranch` | `""` (auto-detect) | Branch to compare against |
| `branchDiff.autoRefresh` | `true` | Refresh automatically on git state changes |
| `branchDiff.gutterIndicators` | `true` | Show colored gutter indicators for changed lines |

## Commands

| Command | Description |
|---|---|
| `Branch Diff: Refresh` | Manually refresh the file list and gutter decorations |
| `Branch Diff: Change Base Branch` | Pick a different branch to compare against |
| `Branch Diff: Toggle Gutter Indicators` | Turn gutter line indicators on/off |
