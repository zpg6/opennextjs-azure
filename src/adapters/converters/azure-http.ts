import type { HttpRequest } from "@azure/functions";
import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next.js";
import type { Converter } from "@opennextjs/aws/types/overrides.js";
import { Buffer } from "node:buffer";

/**
 * Converts Azure HTTP requests to OpenNext InternalEvent format
 */
async function convertFromAzureHttp(request: HttpRequest): Promise<InternalEvent> {
    const url = new URL(request.url);
    let pathname = url.pathname;

    pathname = normalizePath(pathname);

    const query: Record<string, string | string[]> = {};
    url.searchParams.forEach((value, key) => {
        const existing = query[key];
        if (existing) {
            query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
        } else {
            query[key] = value;
        }
    });

    const headers: Record<string, string> = {};
    // v4 model exposes a WHATWG Headers object (no enumerable own properties);
    // the v3 (function.json) model exposes a plain object.
    const headerEntries =
        typeof (request.headers as any)?.entries === "function"
            ? ((request.headers as any).entries() as Iterable<[string, string]>)
            : Object.entries(request.headers as unknown as Record<string, string>);
    for (const [key, value] of headerEntries) {
        if (value) {
            headers[key.toLowerCase()] = value;
        }
    }

    const cookies: Record<string, string> = {};
    const cookieHeader = headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(";").forEach(cookie => {
            const [key, ...valueParts] = cookie.trim().split("=");
            if (key) {
                cookies[key] = valueParts.join("=");
            }
        });
    }

    const body = request.method !== "GET" && request.method !== "HEAD" ? await readRequestBody(request) : undefined;

    // x-forwarded-for may be a comma-separated proxy chain; the client is the first hop
    const remoteAddress = (headers["x-forwarded-for"] || headers["x-real-ip"] || "::1").split(",")[0].trim();

    return {
        type: "core",
        method: request.method,
        rawPath: pathname,
        url: request.url,
        body,
        headers,
        query,
        cookies,
        remoteAddress,
    };
}

/**
 * Reads the request body across programming models: v4 exposes arrayBuffer(),
 * the v3 (function.json) model exposes bufferBody/rawBody instead.
 */
async function readRequestBody(request: HttpRequest): Promise<Buffer | undefined> {
    const req = request as any;
    if (typeof req.arrayBuffer === "function") {
        return Buffer.from(await req.arrayBuffer());
    }
    if (req.bufferBody != null) {
        return Buffer.isBuffer(req.bufferBody) ? req.bufferBody : Buffer.from(req.bufferBody);
    }
    if (req.rawBody != null) {
        return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
    }
    // No JSON.stringify fallback for a parsed body object: re-serializing
    // changes the original bytes and breaks webhook signature verification.
    return undefined;
}

function normalizePath(pathname: string): string {
    if (!pathname || pathname === "/" || pathname === "") {
        return "/";
    }

    if (!pathname.startsWith("/")) {
        pathname = "/" + pathname;
    }

    return pathname;
}

/**
 * Converts OpenNext InternalResult to Azure HTTP response
 */
async function convertToAzureHttp(result: InternalResult): Promise<{
    status: number;
    headers: Record<string, string>;
    cookies: string[];
    body?: Buffer;
}> {
    // Normalize response headers. Set-Cookie must not be comma-folded
    // (RFC 6265), so it is returned separately for the wrapper to emit.
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    for (const [key, value] of Object.entries(result.headers)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (key.toLowerCase() === "set-cookie") {
            cookies.push(...(Array.isArray(value) ? value.map(String) : [String(value)]));
        } else if (Array.isArray(value)) {
            headers[key] = value.join(", ");
        } else {
            headers[key] = String(value);
        }
    }

    // Read the response body stream
    let body: Buffer | undefined;
    if (result.body) {
        const chunks: Uint8Array[] = [];
        const reader = result.body.getReader();

        try {
            let done = false;
            while (!done) {
                const result = await reader.read();
                done = result.done;
                if (result.value) {
                    chunks.push(result.value);
                }
            }
        } finally {
            reader.releaseLock();
        }

        body = Buffer.concat(chunks);
    }

    return {
        status: result.statusCode,
        headers,
        cookies,
        body,
    };
}

export default {
    convertFrom: convertFromAzureHttp,
    convertTo: convertToAzureHttp,
    name: "azure-http",
} satisfies Converter;
