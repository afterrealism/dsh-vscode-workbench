/** Values cleared before another workspace starts loading. */
export interface EmptyWorkspaceDocuments<T> {
    tabs: T[];
    active: undefined;
    error: undefined;
}
/** Remove editor state that belongs to the previous workspace. */
export declare function resetWorkspaceDocuments<T>(): EmptyWorkspaceDocuments<T>;
/** Identifies responses that still belong to the active workspace request. */
export declare class WorkspaceRequestScope {
    private epoch;
    /** Begin loading another workspace and invalidate earlier work. */
    begin(): number;
    /** Return the active workspace request identifier. */
    current(): number;
    /** Invalidate an active request while preserving any newer request. */
    invalidate(epoch: number): void;
    /** Return whether a response may update the current workspace. */
    isCurrent(epoch: number): boolean;
}
