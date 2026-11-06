import type { ComponentType } from 'react';
export type WorkbenchView = 'explorer' | 'search' | 'git';
export interface BottomPanelProps {
    sessionId: string;
    cwd: string;
    visible: boolean;
    colorScheme: 'dark' | 'light';
}
export interface BottomPanelContribution {
    id: string;
    title: string;
    component: ComponentType<BottomPanelProps>;
}
export interface WorkbenchCommand {
    id: string;
    run(): void;
}
export interface WorkbenchSnapshot {
    visible: boolean;
    view: WorkbenchView;
    bottomPanel?: string;
}
interface WorkbenchStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): unknown;
}
/** Client service exposed by the workbench to small feature adapters. */
export interface VscodeWorkbench {
    show(view?: WorkbenchView): void;
    hide(): void;
    registerBottomPanel(contribution: BottomPanelContribution): () => void;
    registerCommand(command: WorkbenchCommand): () => void;
    toggleBottomPanel(id: string): void;
    runCommand(id: string): void;
    getSnapshot(): WorkbenchSnapshot;
    getPanels(): readonly BottomPanelContribution[];
    subscribe(listener: () => void): () => void;
}
export declare class WorkbenchController implements VscodeWorkbench {
    private snapshot;
    private readonly storage;
    private readonly listeners;
    private readonly panels;
    private panelSnapshot;
    private readonly commands;
    constructor(storage?: WorkbenchStorage | undefined);
    show(view?: WorkbenchView): void;
    hide(): void;
    toggleBottomPanel(id: string): void;
    registerBottomPanel(value: BottomPanelContribution): () => void;
    registerCommand(value: WorkbenchCommand): () => void;
    runCommand(id: string): void;
    getSnapshot(): WorkbenchSnapshot;
    getPanels(): readonly BottomPanelContribution[];
    subscribe(listener: () => void): () => void;
    private update;
    private refreshPanels;
    private emit;
}
export {};
