import type { IPty } from 'node-pty';
import type { HostContext } from './context.ts';
export interface TerminalInfo {
    id: string;
    title: string;
    cwd: string;
    running: boolean;
    exitCode?: number;
    sequence: number;
}
export interface TerminalOutput {
    sequence: number;
    data: string;
}
interface TerminalHandle {
    info: TerminalInfo;
    process: IPty;
    replay: string;
    listeners: Set<(output: TerminalOutput) => void>;
}
/** Remove credentials while retaining ordinary interactive-shell variables. */
export declare function sanitizedTerminalEnv(env: NodeJS.ProcessEnv): Record<string, string>;
/** Select the user's interactive shell with platform-specific fallbacks. */
export declare function defaultTerminalShell(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): {
    shell: string;
    args: string[];
};
/** Own interactive terminals by their canonical workspace directory. */
export declare class TerminalManager {
    private readonly workspaces;
    private workspace;
    list(cwd: string): TerminalInfo[];
    create(cwd: string, title?: string): TerminalInfo;
    get(cwd: string, id: string): TerminalHandle | undefined;
    close(cwd: string, id: string): void;
    rename(cwd: string, id: string, title: string): TerminalInfo;
    dispose(): void;
}
/** Register the private local terminal API and WebSocket transport. */
export declare function installTerminal(ctx: HostContext): void;
export {};
