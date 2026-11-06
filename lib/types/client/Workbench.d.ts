import type { FileDocument, GitCommit, GitDiff } from '../types.ts';
import type { VscodeWorkbench } from './service.ts';
import { type DocumentPreviewKind } from './documentPreview.tsx';
interface Tab extends FileDocument {
    dirty: boolean;
    draft: string;
    loaded?: boolean;
    line?: number;
    column?: number;
    external?: boolean;
    preview?: boolean;
    title?: string;
    diff?: GitDiff;
    diffMode?: 'inline' | 'split';
    diffSourcePath?: string;
    imageUrl?: string;
    documentPreview?: DocumentPreviewKind;
    documentUrl?: string;
}
type ResizeDirection = 1 | -1;
/** Calculate a panel width from a horizontal pointer movement. */
export declare function resizedPanelWidth(startWidth: number, startX: number, nextX: number, direction: ResizeDirection, min: number, max: number): number;
/** Restore tab headers without reading their file contents. */
export declare function restoreTabPaths(paths: string[]): Tab[];
/** Return whether file changes require reloading one visible directory. */
export declare function directoryAffected(directory: string, changedPaths: string[]): boolean;
/** Return the basename shown in a tab while preserving its full internal path. */
export declare function tabLabel(tab: Pick<Tab, 'path' | 'title' | 'diffSourcePath'>): string;
/** Return the workspace-relative directory used by the file picker. */
export declare function uploadDestination(selectedDirectory?: string): string;
/** Join an inline-created entry name to the currently selected Explorer directory. */
export declare function createdEntryPath(directory: string, name: string): string;
/** Replace the final path component while preserving its workspace-relative directory. */
export declare function renamedPath(path: string, name: string): string;
export interface GraphTrack {
    hash: string;
    color: number;
}
export interface GraphRow {
    commit: GitCommit;
    lane: number;
    before: GraphTrack[];
    after: GraphTrack[];
    parentLanes: number[];
}
export declare function graphRows(commits: GitCommit[]): GraphRow[];
/** Draw a fixed-radius, orthogonal transition between two graph lanes. */
export declare function graphTrackPath(from: number, to: number, startY: number, endY: number, bendY: number): string;
export declare function Launcher({ service }: {
    service: VscodeWorkbench;
}): import("react").JSX.Element;
export declare function Workbench({ service, useSessions }: {
    service: VscodeWorkbench;
    useSessions: (selector: (state: any) => any) => any;
}): import("react").JSX.Element | null;
export {};
