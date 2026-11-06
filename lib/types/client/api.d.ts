export declare class ApiError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function api<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
