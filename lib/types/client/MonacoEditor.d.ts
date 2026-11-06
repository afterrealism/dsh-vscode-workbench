type Monaco = typeof import('monaco-editor');
declare global {
    interface Window {
        require?: {
            (ids: string[], done: () => void): void;
            config(value: unknown): void;
        };
        monaco?: Monaco;
    }
}
/** Monaco chrome used by both editors so only the narrow native scrollbar remains. */
export declare const WORKBENCH_EDITOR_CHROME: {
    readonly minimap: {
        readonly enabled: false;
    };
    readonly renderOverviewRuler: false;
    readonly overviewRulerLanes: 0;
    readonly hideCursorInOverviewRuler: true;
    readonly scrollbar: {
        readonly verticalScrollbarSize: 10;
        readonly horizontalScrollbarSize: 10;
    };
};
export declare function loadMonaco(): Promise<Monaco>;
export declare function MonacoDiffEditor(props: {
    uri: string;
    original: string;
    modified: string;
    mode: 'inline' | 'split';
    theme: 'dark' | 'light';
}): import("react").JSX.Element;
export declare function MonacoEditor(props: {
    uri: string;
    value: string;
    theme: 'dark' | 'light';
    line?: number;
    column?: number;
    onChange(value: string): void;
    onSave(): void;
}): import("react").JSX.Element;
export {};
