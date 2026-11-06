import type { TerminalInfo } from '../terminal.ts';
export interface TerminalConnection {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    close(): void;
    subscribe(listener: (output: {
        sequence: number;
        data: string;
        replay?: boolean;
    }) => void): () => void;
}
export interface TerminalWorkspaceSnapshot {
    terminals: readonly TerminalInfo[];
    loading: boolean;
    error?: string;
}
/** Browser client for the workbench's local terminal transport. */
export interface TerminalWorkspace {
    refresh(): Promise<void>;
    create(title?: string): Promise<TerminalInfo>;
    close(id: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    connect(id: string): TerminalConnection;
    getSnapshot(): TerminalWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;
}
/** Identify automatic terminal-emulator replies that must not be echoed during replay. */
export declare function isTerminalProtocolReply(data: string): boolean;
/** Maintain one terminal collection for a DSH session. */
export declare class TerminalWorkspaceController implements TerminalWorkspace {
    private readonly sessionId;
    private snapshot;
    private readonly listeners;
    constructor(sessionId: string);
    refresh(): Promise<void>;
    create(title?: string): Promise<TerminalInfo>;
    close(id: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    connect(id: string): TerminalConnection;
    getSnapshot(): TerminalWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;
    private set;
}
