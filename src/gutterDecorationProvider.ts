import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, LineChange } from './gitService';

export class GutterDecorationProvider implements vscode.Disposable {
  private addedDecoration: vscode.TextEditorDecorationType;
  private modifiedDecoration: vscode.TextEditorDecorationType;
  private deletedDecoration: vscode.TextEditorDecorationType;

  private cache = new Map<string, LineChange[]>();
  private mergeBase: string = '';
  private enabled: boolean;
  private togglingProgrammatically = false;
  private disposables: vscode.Disposable[] = [];

  constructor(private gitService: GitService) {
    this.enabled = vscode.workspace.getConfiguration('branchDiff')
      .get<boolean>('gutterIndicators', true);

    this.addedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('gitDecoration.addedResourceForeground')
    });

    this.modifiedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    });

    this.deletedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
    });
  }

  registerListeners(): void {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.updateDecorations(editor);
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('branchDiff.gutterIndicators') && !this.togglingProgrammatically) {
          this.enabled = vscode.workspace.getConfiguration('branchDiff')
            .get<boolean>('gutterIndicators', true);
          if (this.enabled) {
            this.refreshAll();
          } else {
            this.clearAllDecorations();
          }
        }
      })
    );
  }

  /** Returns true if the merge base actually changed. */
  setMergeBase(mergeBase: string): boolean {
    if (this.mergeBase !== mergeBase) {
      this.mergeBase = mergeBase;
      this.cache.clear();
      return true;
    }
    return false;
  }

  async updateDecorations(editor: vscode.TextEditor): Promise<void> {
    if (!this.enabled || !this.mergeBase) {
      this.clearDecorations(editor);
      return;
    }

    const uri = editor.document.uri;
    if (uri.scheme !== 'file') {
      return;
    }

    const relativePath = this.getRelativePath(uri);
    if (!relativePath) {
      return;
    }

    // Check cache or fetch
    let lineChanges = this.cache.get(relativePath);
    if (!lineChanges) {
      lineChanges = await this.gitService.getLineDiff(this.mergeBase, relativePath);
      this.cache.set(relativePath, lineChanges);
    }

    const addedRanges: vscode.DecorationOptions[] = [];
    const modifiedRanges: vscode.DecorationOptions[] = [];
    const deletedRanges: vscode.DecorationOptions[] = [];

    for (const change of lineChanges) {
      // Convert 1-based lines to 0-based ranges
      const startLine = Math.max(0, change.startLine - 1);
      const endLine = Math.max(0, change.endLine - 1);

      // Skip lines beyond document length
      if (startLine >= editor.document.lineCount) {
        continue;
      }
      const clampedEnd = Math.min(endLine, editor.document.lineCount - 1);
      const range = new vscode.Range(startLine, 0, clampedEnd, 0);

      switch (change.type) {
        case 'added':
          addedRanges.push({ range });
          break;
        case 'modified':
          modifiedRanges.push({ range });
          break;
        case 'deleted':
          deletedRanges.push({ range });
          break;
      }
    }

    editor.setDecorations(this.addedDecoration, addedRanges);
    editor.setDecorations(this.modifiedDecoration, modifiedRanges);
    editor.setDecorations(this.deletedDecoration, deletedRanges);
  }

  refreshAll(): void {
    this.cache.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateDecorations(editor);
    }
  }

  /** Apply decorations to visible editors using cached data when available. */
  decorateVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateDecorations(editor);
    }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    // Persist the setting; suppress the config-change listener to avoid double work
    this.togglingProgrammatically = true;
    vscode.workspace.getConfiguration('branchDiff')
      .update('gutterIndicators', this.enabled, vscode.ConfigurationTarget.Global)
      .then(() => { this.togglingProgrammatically = false; });

    if (this.enabled) {
      this.refreshAll();
    } else {
      this.clearAllDecorations();
    }
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.addedDecoration, []);
    editor.setDecorations(this.modifiedDecoration, []);
    editor.setDecorations(this.deletedDecoration, []);
  }

  private clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
  }

  private getRelativePath(uri: vscode.Uri): string | undefined {
    const repoPath = this.gitService.getRepoPath();
    if (!repoPath) {
      return undefined;
    }
    const filePath = uri.fsPath;
    if (!filePath.startsWith(repoPath + path.sep) && filePath !== repoPath) {
      return undefined;
    }
    return path.relative(repoPath, filePath);
  }

  dispose(): void {
    this.addedDecoration.dispose();
    this.modifiedDecoration.dispose();
    this.deletedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
