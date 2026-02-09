import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { BranchDiffProvider, FileItem } from './branchDiffProvider';
import { DiffContentProvider, DIFF_SCHEME, createBaseFileUri } from './diffContentProvider';
import { GutterDecorationProvider } from './gutterDecorationProvider';

let gitService: GitService;
let treeProvider: BranchDiffProvider;
let gutterProvider: GutterDecorationProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Branch Diff extension is activating...');

  // Initialize git service
  gitService = new GitService();
  const initialized = await gitService.initialize();

  if (!initialized) {
    console.log('No git repository found, extension will wait for one to open');
  }

  // Create diff content provider for virtual documents
  const diffContentProvider = new DiffContentProvider(gitService);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
  );

  // Create tree provider
  treeProvider = new BranchDiffProvider(gitService);

  // Create tree view
  const treeView = vscode.window.createTreeView('branchDiffView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  // Create gutter decoration provider
  gutterProvider = new GutterDecorationProvider(gitService);
  gutterProvider.registerListeners();
  context.subscriptions.push(gutterProvider);

  // Helper to sync gutter provider with tree provider's merge-base
  const syncGutter = () => {
    const mergeBase = treeProvider.getMergeBase();
    const changed = gutterProvider.setMergeBase(mergeBase);
    if (changed) {
      gutterProvider.refreshAll();
    } else {
      // Merge base didn't change — just decorate any newly visible editors
      gutterProvider.decorateVisible();
    }
  };

  // Update tree view title with base branch
  const updateTitle = () => {
    const branch = treeProvider.baseBranch;
    const fileCount = treeProvider.getChangedFiles().length;
    if (fileCount > 0) {
      treeView.title = `Changed Files (${fileCount})`;
      treeView.description = `vs ${branch}`;
    } else {
      treeView.title = 'Changed Files';
      treeView.description = `vs ${branch}`;
    }
  };

  // Register commands
  context.subscriptions.push(
    // Refresh command
    vscode.commands.registerCommand('branchDiff.refresh', async () => {
      await treeProvider.refresh();
      updateTitle();
      syncGutter();
    }),

    // Open diff command
    vscode.commands.registerCommand('branchDiff.openDiff', async (fileItem: FileItem) => {
      await openDiff(fileItem);
    }),

    // Open file command
    vscode.commands.registerCommand('branchDiff.openFile', async (fileItem: FileItem) => {
      const repoPath = gitService.getRepoPath();
      if (!repoPath) {
        return;
      }
      const fileUri = vscode.Uri.file(path.join(repoPath, fileItem.file.path));
      await vscode.window.showTextDocument(fileUri);
    }),

    // Change base branch command
    vscode.commands.registerCommand('branchDiff.changeBaseBranch', async () => {
      const branches = await gitService.getAllBranches();
      const currentBranch = gitService.getCurrentBranch();

      // Filter out current branch and sort
      const filteredBranches = branches
        .filter(b => b !== currentBranch)
        .sort((a, b) => {
          // Prioritize main and master
          if (a === 'main' || a === 'master') return -1;
          if (b === 'main' || b === 'master') return 1;
          return a.localeCompare(b);
        });

      const selected = await vscode.window.showQuickPick(filteredBranches, {
        placeHolder: 'Select base branch to compare against',
        title: 'Change Base Branch'
      });

      if (selected) {
        await treeProvider.setBaseBranch(selected);
        updateTitle();
        syncGutter();
        vscode.window.showInformationMessage(`Now comparing against: ${selected}`);
      }
    })
  );

  // Set up auto-refresh on git state changes
  const config = vscode.workspace.getConfiguration('branchDiff');
  if (config.get<boolean>('autoRefresh', true)) {
    const stateChangeDisposable = gitService.onDidChangeState(async () => {
      // Debounce rapid changes
      await new Promise(resolve => setTimeout(resolve, 500));
      await treeProvider.refresh();
      updateTitle();
      syncGutter();
    });
    context.subscriptions.push(stateChangeDisposable);
  }

  // Register toggle gutter command
  context.subscriptions.push(
    vscode.commands.registerCommand('branchDiff.toggleGutterIndicators', () => {
      gutterProvider.toggle();
    })
  );

  // Initial refresh
  await treeProvider.refresh();
  updateTitle();
  syncGutter();

  console.log('Branch Diff extension activated');
}

async function openDiff(fileItem: FileItem): Promise<void> {
  const repoPath = gitService.getRepoPath();
  if (!repoPath) {
    vscode.window.showErrorMessage('No repository found');
    return;
  }

  const file = fileItem.file;
  const mergeBase = fileItem.getMergeBase();
  const baseBranch = fileItem.getBaseBranch();

  // Create URIs
  const oldPath = file.oldPath || file.path;
  const leftUri = createBaseFileUri(mergeBase, oldPath);
  const rightUri = vscode.Uri.file(path.join(repoPath, file.path));

  const title = `${path.basename(file.path)} (${baseBranch} ↔ Current)`;

  switch (file.status) {
    case 'A':
      // Added file - just open it (no diff needed)
      await vscode.window.showTextDocument(rightUri);
      break;

    case 'D':
      // Deleted file - show the old version
      await vscode.window.showTextDocument(leftUri);
      break;

    case 'R':
      // Renamed file - show diff with old path
      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        `${path.basename(oldPath)} → ${path.basename(file.path)} (${baseBranch} ↔ Current)`
      );
      break;

    default:
      // Modified, Copied, etc. - show diff
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
      break;
  }
}

export function deactivate() {
  console.log('Branch Diff extension deactivated');
}
