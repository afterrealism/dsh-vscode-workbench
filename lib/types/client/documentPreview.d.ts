export type DocumentPreviewKind = 'pdf' | 'docx' | 'download';
/** Bound PDF zoom to values that remain usable in the workbench viewport. */
export declare function clampPdfScale(scale: number): number;
/** Return the in-workbench preview supported for a document path. */
export declare function documentPreviewKind(path: string): DocumentPreviewKind | undefined;
/** Render an in-workbench preview for PDF and Word documents. */
export declare function DocumentPreview({ kind, src, path }: {
    kind: DocumentPreviewKind;
    src: string;
    path: string;
}): import("react").JSX.Element;
