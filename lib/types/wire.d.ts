import type { IncomingMessage, ServerResponse } from 'node:http';
export declare class WorkbenchError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status?: number);
}
export declare function readBody(req: IncomingMessage): Promise<Record<string, unknown>>;
/** Read a binary upload while enforcing a fixed request limit. */
export declare function readBinaryBody(req: IncomingMessage, limit?: number): Promise<Buffer>;
export declare function stringField(body: Record<string, unknown>, key: string): string;
export declare function send(res: ServerResponse, status: number, value: unknown): void;
export declare function sendError(res: ServerResponse, error: unknown): void;
export declare function trusted(req: IncomingMessage, allowed: readonly string[]): boolean;
