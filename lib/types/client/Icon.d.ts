export type CodiconName = 'add' | 'check' | 'check-all' | 'chevron-down' | 'chevron-right' | 'close' | 'close-all' | 'cloud-upload' | 'code' | 'color-mode' | 'edit' | 'diff' | 'diff-sidebyside' | 'diff-single' | 'discard' | 'file' | 'file-code' | 'file-media' | 'file-pdf' | 'file-zip' | 'files' | 'folder' | 'folder-opened' | 'git-branch' | 'git-commit' | 'graph' | 'home' | 'list-tree' | 'new-file' | 'layout-sidebar-right' | 'layout-sidebar-right-off' | 'new-folder' | 'preview' | 'refresh' | 'remove' | 'search' | 'settings' | 'source-control' | 'sparkle' | 'split-horizontal' | 'terminal' | 'trash';
/** Render one glyph from Microsoft's VS Code Codicon font. */
export declare function Icon({ name, className }: {
    name: CodiconName;
    className?: string;
}): import("react").JSX.Element;
/** Select a Codicon for a file name without depending on a file-icon theme. */
export declare function fileIcon(name: string): CodiconName;
