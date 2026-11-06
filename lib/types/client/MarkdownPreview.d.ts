export interface MarkdownHeading {
    depth: number;
    text: string;
    index: number;
}
/** Extract navigable ATX headings from Markdown source. */
export declare function markdownHeadings(source: string): MarkdownHeading[];
export declare function markdownWorkspacePath(basePath: string, source: string): string | undefined;
/** Render sanitized workspace Markdown with protected relative images and heading anchors. */
export declare function MarkdownPreview({ source, sessionId, path }: {
    source: string;
    sessionId: string;
    path: string;
}): import("react").JSX.Element;
