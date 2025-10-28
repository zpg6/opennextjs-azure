import type { InternalEvent, InternalResult, StreamCreator } from "@opennextjs/aws/types/open-next.js";
import type { Wrapper, WrapperHandler } from "@opennextjs/aws/types/overrides.js";
import { Writable } from "node:stream";

// HTTP status codes that should not have a response body
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Azure Functions wrapper for OpenNext (v3 model - function.json based).
 *
 * Adapts the Azure Functions runtime to work with OpenNext's internal event/result format.
 * Uses v3 signature: async (context, request) with context.res for response.
 */
const handler: WrapperHandler<InternalEvent, InternalResult> =
    async (handler, converter) =>
    async (context: any, request: any): Promise<void> => {
        try {
            const internalEvent = await converter.convertFrom(request);

            const streamCreator: StreamCreator = {
                writeHeaders(prelude: {
                    statusCode: number;
                    cookies: string[];
                    headers: Record<string, string>;
                }): Writable {
                    const { statusCode, cookies, headers } = prelude;

                    const responseHeaders: Record<string, string> = { ...headers };

                    if (cookies.length > 0) {
                        responseHeaders["set-cookie"] = cookies.join(", ");
                    }

                    if (NULL_BODY_STATUSES.has(statusCode)) {
                        context.res = {
                            status: statusCode,
                            headers: responseHeaders,
                        };

                        return new Writable({
                            write(chunk, encoding, callback) {
                                callback();
                            },
                        });
                    }

                    const chunks: Buffer[] = [];

                    return new Writable({
                        write(chunk: Buffer, encoding, callback) {
                            chunks.push(chunk);
                            callback();
                        },
                        final(callback) {
                            const body = Buffer.concat(chunks);
                            const bodyString = body.toString("utf8");

                            context.res = {
                                status: statusCode,
                                headers: responseHeaders,
                                body: bodyString,
                            };

                            callback();
                        },
                    });
                },
                retainChunks: true,
            };

            await handler(internalEvent, { streamCreator });

            if (!context.res) {
                context.res = {
                    status: 200,
                    headers: { "content-type": "text/html" },
                    body: "",
                };
            }
        } catch (error) {
            console.error("[OpenNextJS Azure] Handler error:", error);
            context.res = {
                status: 500,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    error: "Internal Server Error",
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                }),
            };
        }
    };

export default {
    wrapper: handler,
    name: "azure-functions",
    supportStreaming: true,
} satisfies Wrapper;
