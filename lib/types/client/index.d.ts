import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { VscodeWorkbench } from './service.ts';
export type { BottomPanelContribution, BottomPanelProps, VscodeWorkbench, WorkbenchCommand, WorkbenchSnapshot, WorkbenchView } from './service.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        vscodeWorkbench: VscodeWorkbench;
    }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotInjectMap {
        'dsh-vscode-workbench.overlay': {
            service: VscodeWorkbench;
        };
        'dsh-vscode-workbench.launcher': {
            service: VscodeWorkbench;
        };
    }
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
