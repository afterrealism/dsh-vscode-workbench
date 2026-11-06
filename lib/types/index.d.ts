import type { HostContext } from './context.ts';
export { WorkbenchError } from './wire.ts';
export * from './types.ts';
export declare const name = "dsh-vscode-workbench";
export declare const inject: string[];
export declare function apply(ctx: HostContext): void;
