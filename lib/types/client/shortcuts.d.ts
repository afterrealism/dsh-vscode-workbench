import type { VscodeWorkbench } from './service.ts';
/** Reveal the terminal panel supplied by a terminal adapter without toggling it closed. */
export declare function openTerminal(workbench: VscodeWorkbench): boolean;
/** Toggle the terminal panel from the activity bar. */
export declare function toggleTerminal(workbench: VscodeWorkbench): boolean;
/** Handle terminal shortcuts through contributions registered by a terminal adapter. */
export declare function handleTerminalShortcut(event: KeyboardEvent, workbench: VscodeWorkbench): boolean;
