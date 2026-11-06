/** Locate the resident DSH conversation without depending on generated CSS module names. */
export declare function findDshConversationRoot(documentRoot?: Document): HTMLElement | null;
/** Keep the official conversation mounted while presenting it in the workbench's right column. */
export declare function DshConversationPanel({ visible, width, statusHeight }: {
    visible: boolean;
    width: number;
    statusHeight: number;
}): null;
/** Temporarily align the official DSH palette with a fixed workbench palette. */
export declare function DshConversationTheme({ visible, colorScheme, followDsh }: {
    visible: boolean;
    colorScheme: 'dark' | 'light';
    followDsh: boolean;
}): null;
