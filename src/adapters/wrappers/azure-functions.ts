import type { InternalEvent, InternalResult, StreamCreator } from "@opennextjs/aws/types/open-next.js";
import type { Wrapper, WrapperHandler } from "@opennextjs/aws/types/overrides.js";
import { PassThrough, Writable } from "node:stream";
import { readFileSync } from "node:fs";

// HTTP status codes that should not have a response body
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// Fallback patterns when no asset manifest is present
const STATIC_ASSET_PATTERNS = [
    /^\/favicon\.ico$/,
    /^\/robots\.txt$/,
    /^\/sitemap\.xml$/,
    /^\/[^/]+\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/,
];

// App Router metadata routes are rendered by the server, not uploaded to
// blob storage, so they must not be redirected even though they look like
// asset paths.
const METADATA_ROUTE_PATTERN = /^\/(opengraph-image|twitter-image|icon\d*|apple-icon\d*|manifest)\.[a-z0-9]+$/;

// Root-level files actually uploaded to the assets container, written by
// the build into static-assets.json next to this bundle. Filename patterns
// can't tell an uploaded public/sitemap.xml from a server-rendered
// app/sitemap.ts; the manifest can.
let uploadedRootAssets: Set<string> | null = null;
try {
    const manifest = JSON.parse(readFileSync("static-assets.json", "utf8"));
    if (Array.isArray(manifest)) {
        uploadedRootAssets = new Set(manifest);
    }
} catch {
    // No manifest (older build): fall back to pattern matching.
}

function isStaticAssetRequest(pathname: string): boolean {
    if (pathname.startsWith("/_next/static/")) {
        return true;
    }
    if (uploadedRootAssets) {
        const isRootLevel = pathname.startsWith("/") && !pathname.slice(1).includes("/");
        return isRootLevel && uploadedRootAssets.has(pathname.slice(1));
    }
    if (METADATA_ROUTE_PATTERN.test(pathname)) {
        return false;
    }
    return STATIC_ASSET_PATTERNS.some(pattern => pattern.test(pathname));
}

/**
 * Parses a Set-Cookie header string into the structured Cookie object the
 * Azure Functions v3 http output binding expects (`context.res.cookies`).
 * The v3 model has no other way to emit multiple Set-Cookie headers, and
 * comma-joining them corrupts cookies (RFC 6265).
 */
export function parseSetCookie(setCookie: string): Record<string, unknown> | null {
    const parts = setCookie.split(";");
    const [nameValue, ...attrs] = parts;
    const eq = nameValue.indexOf("=");
    if (eq === -1) return null;
    const cookie: Record<string, unknown> = {
        name: nameValue.slice(0, eq).trim(),
        value: nameValue.slice(eq + 1).trim(),
    };
    for (const attr of attrs) {
        const [rawKey, ...rawVal] = attr.split("=");
        const key = rawKey.trim().toLowerCase();
        const value = rawVal.join("=").trim();
        switch (key) {
            case "expires": {
                // An Invalid Date or NaN would fail the worker's RPC
                // conversion and 500 the whole response; drop the bad
                // attribute instead.
                const expires = new Date(value);
                if (!Number.isNaN(expires.getTime())) {
                    cookie.expires = expires;
                }
                break;
            }
            case "max-age": {
                const maxAge = Number(value);
                if (!Number.isNaN(maxAge)) {
                    cookie.maxAge = maxAge;
                }
                break;
            }
            case "domain":
                cookie.domain = value;
                break;
            case "path":
                cookie.path = value;
                break;
            case "samesite": {
                // The platform's cookie serializer throws on values outside
                // this set, which would fail the whole response.
                const sameSite = { lax: "Lax", strict: "Strict", none: "None" }[value.toLowerCase()];
                if (sameSite) {
                    cookie.sameSite = sameSite;
                }
                break;
            }
            case "secure":
                cookie.secure = true;
                break;
            case "httponly":
                cookie.httpOnly = true;
                break;
        }
    }
    return cookie;
}

/**
 * Azure Functions wrapper for OpenNext (v4 programming model).
 *
 * The handler receives (request, context) and returns an HttpResponseInit.
 * With enableHttpStream on (set in the generated entry file), the response
 * body is a stream: headers go out as soon as OpenNext writes them and the
 * body streams while Next renders, so SSR/RSC responses have real
 * time-to-first-byte instead of waiting for the full render.
 */
const handler: WrapperHandler<InternalEvent, InternalResult> =
    async (handler, converter) =>
    async (request: any, context: any): Promise<Record<string, unknown>> => {
        let internalEvent: InternalEvent;
        try {
            internalEvent = await converter.convertFrom(request);
        } catch (error) {
            return errorResponse(error);
        }

        // Redirect static assets directly to blob storage.
        // Without the account name the redirect target would be
        // https://undefined.blob..., so fall through to the server.
        if (isStaticAssetRequest(internalEvent.rawPath) && process.env.AZURE_STORAGE_ACCOUNT_NAME) {
            const blobUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/assets${internalEvent.rawPath}`;

            const cacheControl = internalEvent.rawPath.startsWith("/_next/static/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=0, must-revalidate";

            return {
                status: 301,
                headers: {
                    Location: blobUrl,
                    "Cache-Control": cacheControl,
                },
            };
        }

        return await new Promise<Record<string, unknown>>(resolve => {
            let resolved = false;
            let bodyStream: PassThrough | null = null;
            // Best-effort abort: the platform gives no client-disconnect
            // signal, so this only fires when the response stream dies
            // abnormally on our side.
            const abortController = new AbortController();

            const streamCreator: StreamCreator = {
                abortSignal: abortController.signal,
                writeHeaders(prelude: {
                    statusCode: number;
                    cookies: string[];
                    headers: Record<string, string>;
                }): Writable {
                    const { statusCode, cookies, headers } = prelude;

                    const responseHeaders: Record<string, string> = { ...headers };
                    // Set-Cookie cannot be comma-folded into one header
                    // (RFC 6265); the binding takes structured cookies.
                    const responseCookies = cookies.map(parseSetCookie).filter(Boolean);

                    if (NULL_BODY_STATUSES.has(statusCode)) {
                        resolved = true;
                        resolve({
                            status: statusCode,
                            headers: responseHeaders,
                            ...(responseCookies.length > 0 ? { cookies: responseCookies } : {}),
                        });

                        return new Writable({
                            write(chunk, encoding, callback) {
                                callback();
                            },
                        });
                    }

                    // Hand the platform a live stream: the response starts
                    // now, and OpenNext keeps writing into it. No backpressure:
                    // the platform proxy reads at producer speed, so a slow
                    // client buffers the body in worker memory.
                    bodyStream = new PassThrough();
                    bodyStream.on("close", () => {
                        if (bodyStream && !bodyStream.writableFinished) {
                            abortController.abort();
                        }
                    });
                    resolved = true;
                    resolve({
                        status: statusCode,
                        headers: responseHeaders,
                        ...(responseCookies.length > 0 ? { cookies: responseCookies } : {}),
                        body: bodyStream,
                    });

                    return bodyStream;
                },
                retainChunks: false,
            };

            handler(internalEvent, { streamCreator })
                .then(() => {
                    if (!resolved) {
                        // writeHeaders never ran (known HEAD-request race in
                        // the core): send an empty 200.
                        resolved = true;
                        resolve({
                            status: 200,
                            headers: { "content-type": "text/html" },
                            body: "",
                        });
                    } else if (bodyStream && !bodyStream.writableEnded && !bodyStream.destroyed) {
                        // The handler finished without ending the stream (a
                        // destroyed source doesn't end its pipe target). An
                        // unended stream holds the invocation open until the
                        // host timeout.
                        bodyStream.end();
                    }
                })
                .catch(error => {
                    if (!resolved) {
                        resolved = true;
                        resolve(errorResponse(error));
                    } else if (bodyStream && !bodyStream.writableEnded && !bodyStream.destroyed) {
                        // Headers are gone. End (not destroy) the stream: the
                        // platform flushes a truncated body and completes the
                        // invocation; destroying leaves its reader dangling.
                        bodyStream.end();
                    }
                });
        });
    };

function errorResponse(error: unknown): Record<string, unknown> {
    // Fail closed: details only when explicitly in development, not
    // whenever NODE_ENV isn't the exact string "production".
    const showDetails = process.env.NODE_ENV === "development";
    return {
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            error: "Internal Server Error",
            ...(!showDetails
                ? {}
                : {
                      message: error instanceof Error ? error.message : String(error),
                      stack: error instanceof Error ? error.stack : undefined,
                  }),
        }),
    };
}

export default {
    wrapper: handler,
    name: "azure-functions",
    supportStreaming: true,
} satisfies Wrapper;
