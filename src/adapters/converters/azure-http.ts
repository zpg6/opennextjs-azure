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
    for (const [key, value] of Object.entries(request.headers)) {
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

    const body =
        request.method !== "GET" && request.method !== "HEAD" ? Buffer.from(await request.arrayBuffer()) : undefined;

    return {
        type: "core",
        method: request.method,
        rawPath: pathname,
        url: request.url,
        body,
        headers,
        query,
        cookies,
        remoteAddress: headers["x-forwarded-for"] || headers["x-real-ip"] || "::1",
    };
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
    body?: string;
}> {
    // Normalize response headers
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.headers)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            headers[key] = value.join(", ");
        } else {
            headers[key] = String(value);
        }
    }

    // Read the response body stream
    let body: string | undefined;
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

        const buffer = Buffer.concat(chunks);
        body = result.isBase64Encoded ? buffer.toString("base64") : buffer.toString("utf8");
    }

    return {
        status: result.statusCode,
        headers,
        body,
    };
}

export default {
    convertFrom: convertFromAzureHttp,
    convertTo: convertToAzureHttp,
    name: "azure-http",
} satisfies Converter;
