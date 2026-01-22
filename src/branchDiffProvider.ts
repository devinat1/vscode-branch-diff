import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, ChangedFile, FileStatus } from './gitService';
import { createBaseFileUri } from './diffContentProvider';

type TreeItemType = FolderItem | FileItem;

class FolderItem extends vscode.TreeItem {
  children: TreeItemType[] = [];

  constructor(
    public readonly folderPath: string,
    public readonly label: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'folder';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly file: ChangedFile,
    public readonly repoPath: string,
    private readonly mergeBase: string,
    private readonly baseBranch: string
  ) {
    super(path.basename(file.path), vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'changedFile';
    this.description = this.getStatusLabel(file.status);
    this.iconPath = this.getStatusIcon(file.status);
    this.tooltip = this.getTooltip();
    this.resourceUri = vscode.Uri.file(path.join(repoPath, file.path));

    // Set command to open diff on click
    this.command = {
      command: 'branchDiff.openDiff',
      title: 'Open Diff',
      arguments: [this]
    };
  }

  private getStatusLabel(status: FileStatus): string {
    switch (status) {
      case 'A': return 'Added';
      case 'M': return 'Modified';
      case 'D': return 'Deleted';
      case 'R': return 'Renamed';
      case 'C': return 'Copied';
      case 'U': return 'Unmerged';
      default: return 'Unknown';
    }
  }

  private getStatusIcon(status: FileStatus): vscode.ThemeIcon {
    switch (status) {
      case 'A': return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'M': return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
      case 'D': return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
      case 'R': return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
      case 'C': return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'U': return new vscode.ThemeIcon('diff-ignored', new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'));
      default: return new vscode.ThemeIcon('file');
    }
  }

  private getTooltip(): string {
    const status = this.getStatusLabel(this.file.status);
    if (this.file.oldPath) {
      return `${status}: ${this.file.oldPath} → ${this.file.path}`;
    }
    return `${status}: ${this.file.path}`;
  }

  getMergeBase(): string {
    return this.mergeBase;
  }

  getBaseBranch(): string {
    return this.baseBranch;
  }
}

export class BranchDiffProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemType | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private changedFiles: ChangedFile[] = [];
  private mergeBase: string = '';
  private _baseBranch: string = 'main';
  private rootItems: TreeItemType[] = [];
  private isLoading = false;
  private statusMessage: string | undefined;

  constructor(private gitService: GitService) {}

  get baseBranch(): string {
    return this._baseBranch;
  }

  getChangedFiles(): ChangedFile[] {
    return this.changedFiles;
  }

  getMergeBase(): string {
    return this.mergeBase;
  }

  async setBaseBranch(branch: string): Promise<void> {
    this._baseBranch = branch;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.statusMessage = undefined;

    try {
      // Auto-detect base branch if not set
      if (!this._baseBranch) {
        const detected = await this.gitService.getBaseBranch();
        if (detected) {
          this._baseBranch = detected;
        } else {
          this.statusMessage = 'No main or master branch found';
          this.changedFiles = [];
          this.rootItems = [];
          this._onDidChangeTreeData.fire();
          return;
        }
      }

      // Get merge base
      const mergeBase = await this.gitService.getMergeBase(this._baseBranch);
      if (!mergeBase) {
        this.statusMessage = `Cannot find merge-base with ${this._baseBranch}`;
        this.changedFiles = [];
        this.rootItems = [];
        this._onDidChangeTreeData.fire();
        return;
      }

      this.mergeBase = mergeBase;

      // Get changed files
      this.changedFiles = await this.gitService.getChangedFiles(mergeBase);

      // Build tree structure
      this.rootItems = this.buildTree();

      if (this.changedFiles.length === 0) {
        this.statusMessage = `No changes from ${this._baseBranch}`;
      }
    } catch (error) {
      console.error('Failed to refresh:', error);
      this.statusMessage = 'Failed to load changes';
      this.changedFiles = [];
      this.rootItems = [];
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: TreeItemType): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItemType): TreeItemType[] {
    if (!element) {
      // Root level
      if (this.statusMessage && this.rootItems.length === 0) {
        // Return a message item
        const messageItem = new vscode.TreeItem(this.statusMessage);
        messageItem.iconPath = new vscode.ThemeIcon('info');
        return [messageItem as TreeItemType];
      }
      return this.rootItems;
    }

    // Return children of folder
    if (element instanceof FolderItem) {
      return element.children;
    }

    return [];
  }

  private buildTree(): TreeItemType[] {
    const repoPath = this.gitService.getRepoPath();
    if (!repoPath) {
      return [];
    }

    // Group files by directory
    const folderMap = new Map<string, TreeItemType[]>();
    const rootFiles: TreeItemType[] = [];

    for (const file of this.changedFiles) {
      const fileItem = new FileItem(file, repoPath, this.mergeBase, this._baseBranch);
      const dir = path.dirname(file.path);

      if (dir === '.' || dir === '') {
        rootFiles.push(fileItem);
      } else {
        if (!folderMap.has(dir)) {
          folderMap.set(dir, []);
        }
        folderMap.get(dir)!.push(fileItem);
      }
    }

    // Build folder hierarchy
    const rootItems: TreeItemType[] = [];
    const processedFolders = new Set<string>();

    // Sort folders and create nested structure
    const sortedFolders = Array.from(folderMap.keys()).sort();

    for (const folderPath of sortedFolders) {
      const parts = folderPath.split(path.sep);
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        currentPath = i === 0 ? parts[i] : path.join(currentPath, parts[i]);

        if (!processedFolders.has(currentPath)) {
          processedFolders.add(currentPath);

          const folder = new FolderItem(currentPath, parts[i]);

          // Find parent folder and add as child
          const parentPath = path.dirname(currentPath);
          if (parentPath === '.' || parentPath === '') {
            rootItems.push(folder);
          } else {
            const parent = this.findFolder(rootItems, parentPath);
            if (parent) {
              parent.children.push(folder);
            }
          }
        }
      }
    }

    // Add files to their folders
    for (const [folderPath, files] of folderMap) {
      const folder = this.findFolder(rootItems, folderPath);
      if (folder) {
        folder.children.push(...files);
        // Sort children: folders first, then files
        folder.children.sort((a, b) => {
          const aIsFolder = a instanceof FolderItem;
          const bIsFolder = b instanceof FolderItem;
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a.label!.toString().localeCompare(b.label!.toString());
        });
      }
    }

    // Add root files
    rootItems.push(...rootFiles);

    // Sort root items: folders first, then files
    rootItems.sort((a, b) => {
      const aIsFolder = a instanceof FolderItem;
      const bIsFolder = b instanceof FolderItem;
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a.label!.toString().localeCompare(b.label!.toString());
    });

    return rootItems;
  }

  private findFolder(items: TreeItemType[], folderPath: string): FolderItem | undefined {
    for (const item of items) {
      if (item instanceof FolderItem) {
        if (item.folderPath === folderPath) {
          return item;
        }
        const found = this.findFolder(item.children, folderPath);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }
}

export { FileItem, FolderItem };
