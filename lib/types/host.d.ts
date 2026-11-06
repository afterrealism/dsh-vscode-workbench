import type { HostContext } from './context.ts';
import type { FileDocument, FileEntry, GitStatus, SearchMatch, SearchRequest } from './types.ts';
export declare function cwdFor(ctx: HostContext, sessionId: string): string;
/** Resolve a caller-relative path and reject traversal and symlink escape. */
export declare function workspacePath(cwd: string, raw: string, create?: boolean): Promise<{
    root: string;
    absolute: string;
}>;
export declare function listFiles(cwd: string, path: string): Promise<FileEntry[]>;
export declare function readDocument(cwd: string, path: string): Promise<FileDocument>;
export declare function saveDocument(cwd: string, path: string, content: string, expected: string): Promise<FileDocument>;
export declare function createEntry(cwd: string, path: string, kind: 'file' | 'directory'): Promise<void>;
/** Write an uploaded file into an existing workspace directory without overwriting files. */
export declare function uploadFile(cwd: string, directory: string, name: string, content: Buffer): Promise<FileEntry>;
export declare function renameEntry(cwd: string, path: string, nextPath: string): Promise<void>;
export declare function deleteEntry(cwd: string, path: string): Promise<void>;
/** Resolve an image inside the workspace for protected browser preview. */
export declare function workspaceImage(cwd: string, path: string): Promise<{
    path: string;
    type: string;
}>;
/** Resolve a supported preview file inside the workspace. */
export declare function workspacePreviewFile(cwd: string, path: string): Promise<{
    path: string;
    type: string;
}>;
/** Resolve the PDF.js worker shipped with this plugin's runtime dependency. */
export declare function pdfWorkerAsset(): {
    path: string;
    type: string;
};
interface ProcessResult {
    stdout: string;
    stderr: string;
    code: number;
}
export declare function run(command: string, args: string[], cwd: string, timeout?: number, signal?: AbortSignal): Promise<ProcessResult>;
export declare function searchWorkspace(cwd: string, request: SearchRequest, signal?: AbortSignal): Promise<{
    matches: SearchMatch[];
    limited: boolean;
}>;
export declare function gitStatus(cwd: string): Promise<GitStatus>;
export declare function gitAction(cwd: string, action: string, path?: string, value?: string): Promise<unknown>;
/** Resolve the official VS Code Codicon font shipped by @vscode/codicons. */
export declare function codiconAsset(): {
    path: string;
    type: string;
};
export declare function monacoAsset(raw: string): {
    path: string;
    type: string;
};
export {};
