import * as vscode from 'vscode';
import { GitService } from './gitService';

export const DIFF_SCHEME = 'git-base';

/**
 * Provides virtual document content for files at a specific git commit.
 *
 * URI format: git-base://<commit>/<filepath>
 * Example: git-base://abc123/src/index.ts
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private gitService: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // URI format: git-base://<commit>/<filepath>
    const commit = uri.authority;
    const filePath = uri.path.substring(1); // Remove leading /

    try {
      return await this.gitService.getFileAtCommit(commit, filePath);
    } catch {
      // File didn't exist at that commit (new file)
      return '';
    }
  }

  /**
   * Refresh a specific document by firing the onDidChange event
   */
  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Create a URI for a file at a specific commit
 */
export function createBaseFileUri(commit: string, filePath: string): vscode.Uri {
  return vscode.Uri.parse(`${DIFF_SCHEME}://${commit}/${filePath}`);
}
