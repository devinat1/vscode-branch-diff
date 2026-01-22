import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Types from VS Code's built-in git extension
interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

interface RepositoryState {
  HEAD: Branch | undefined;
  onDidChange: vscode.Event<void>;
}

interface Branch {
  name?: string;
  commit?: string;
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'U';

export interface ChangedFile {
  status: FileStatus;
  path: string;
  oldPath?: string; // For renames
}

export class GitService {
  private gitApi: GitAPI | undefined;
  private repository: Repository | undefined;

  async initialize(): Promise<boolean> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
      return false;
    }

    const git = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate();

    this.gitApi = git.getAPI(1);

    // Get the first repository (or active workspace repository)
    if (this.gitApi.repositories.length > 0) {
      this.repository = this.gitApi.repositories[0];
      return true;
    }

    // Wait for a repository to open
    return new Promise((resolve) => {
      const disposable = this.gitApi!.onDidOpenRepository((repo) => {
        this.repository = repo;
        disposable.dispose();
        resolve(true);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(false);
      }, 5000);
    });
  }

  getRepository(): Repository | undefined {
    return this.repository;
  }

  getRepoPath(): string | undefined {
    return this.repository?.rootUri.fsPath;
  }

  getCurrentBranch(): string | undefined {
    return this.repository?.state.HEAD?.name;
  }

  onDidChangeState(callback: () => void): vscode.Disposable {
    if (!this.repository) {
      return { dispose: () => {} };
    }
    return this.repository.state.onDidChange(callback);
  }

  async getBaseBranch(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('branchDiff');
    const configuredBranch = config.get<string>('defaultBaseBranch');

    if (configuredBranch) {
      // Verify the configured branch exists
      if (await this.branchExists(configuredBranch)) {
        return configuredBranch;
      }
    }

    // Auto-detect: try 'main' first, then 'master'
    if (await this.branchExists('main')) {
      return 'main';
    }
    if (await this.branchExists('master')) {
      return 'master';
    }

    return undefined;
  }

  private async branchExists(branch: string): Promise<boolean> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      return false;
    }

    try {
      await execAsync(`git rev-parse --verify ${branch}`, { cwd: repoPath });
      return true;
    } catch {
      return false;
    }
  }

  async getMergeBase(baseBranch: string): Promise<string | undefined> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      return undefined;
    }

    try {
      const { stdout } = await execAsync(
        `git merge-base HEAD ${baseBranch}`,
        { cwd: repoPath }
      );
      return stdout.trim();
    } catch (error) {
      console.error('Failed to get merge-base:', error);
      return undefined;
    }
  }

  async getChangedFiles(mergeBase: string): Promise<ChangedFile[]> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      return [];
    }

    try {
      const { stdout } = await execAsync(
        `git diff --name-status ${mergeBase}..HEAD`,
        { cwd: repoPath }
      );

      return this.parseDiffOutput(stdout);
    } catch (error) {
      console.error('Failed to get changed files:', error);
      return [];
    }
  }

  private parseDiffOutput(output: string): ChangedFile[] {
    const lines = output.trim().split('\n').filter(line => line.length > 0);
    const files: ChangedFile[] = [];

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) {
        continue;
      }

      const statusCode = parts[0];
      let status: FileStatus;
      let path: string;
      let oldPath: string | undefined;

      // Handle renames and copies (R100, C100, etc.)
      if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
        status = statusCode[0] as FileStatus;
        oldPath = parts[1];
        path = parts[2];
      } else {
        status = statusCode[0] as FileStatus;
        path = parts[1];
      }

      files.push({ status, path, oldPath });
    }

    return files;
  }

  async getFileAtCommit(commit: string, filePath: string): Promise<string> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      return '';
    }

    try {
      const { stdout } = await execAsync(
        `git show ${commit}:${filePath}`,
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large files
      );
      return stdout;
    } catch {
      // File might not exist at that commit (new file)
      return '';
    }
  }

  async getAllBranches(): Promise<string[]> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      return [];
    }

    try {
      const { stdout } = await execAsync(
        'git branch -a --format="%(refname:short)"',
        { cwd: repoPath }
      );

      return stdout
        .trim()
        .split('\n')
        .filter(branch => branch.length > 0)
        .map(branch => branch.replace(/^origin\//, ''))
        .filter((branch, index, self) => self.indexOf(branch) === index); // Dedupe
    } catch {
      return [];
    }
  }
}
