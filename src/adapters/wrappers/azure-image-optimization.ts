import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next.js";
import type { WrapperHandler } from "@opennextjs/aws/types/overrides.js";
import { Writable, Readable } from "node:stream";
import { createHash } from "node:crypto";
import { BlobServiceClient, BlockBlobClient } from "@azure/storage-blob";

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const { AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_ACCOUNT_NAME } = process.env;
const CACHE_CONTAINER = "optimized-images";

function getBlobClient(key: string): BlockBlobClient {
    if (!AZURE_STORAGE_CONNECTION_STRING && !AZURE_STORAGE_ACCOUNT_NAME) {
        throw new Error("Azure Storage connection string or account name must be defined");
    }

    const blobServiceClient = AZURE_STORAGE_CONNECTION_STRING
        ? BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING)
        : new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`);

    const containerClient = blobServiceClient.getContainerClient(CACHE_CONTAINER);
    return containerClient.getBlockBlobClient(key);
}

function computeCacheKey(event: InternalEvent): string {
    const { query } = event;
    const url = Array.isArray(query?.url) ? query.url[0] : query?.url || "";
    const width = Array.isArray(query?.w) ? query.w[0] : query?.w || "0";
    const quality = Array.isArray(query?.q) ? query.q[0] : query?.q || "75";

    const hash = createHash("sha256").update(url).digest("hex").substring(0, 16);

    return `${hash}/w${width}_q${quality}.cache`;
}

async function getCachedImage(cacheKey: string): Promise<Buffer | null> {
    try {
        const blobClient = getBlobClient(cacheKey);
        const exists = await blobClient.exists();

        if (!exists) {
            return null;
        }

        const downloadResponse = await blobClient.download();

        if (!downloadResponse.readableStreamBody) {
            return null;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    } catch (error) {
        return null;
    }
}

async function setCachedImage(cacheKey: string, buffer: Buffer, contentType: string): Promise<void> {
    try {
        const blobClient = getBlobClient(cacheKey);
        await blobClient.upload(buffer, buffer.length, {
            blobHTTPHeaders: {
                blobContentType: contentType,
                blobCacheControl: "public,max-age=31536000,immutable",
            },
        });
        process.stderr.write(`[ImageCache] ✓ Cached ${buffer.length} bytes\n`);
    } catch (error: any) {
        process.stderr.write(`[ImageCache] ✗ Cache failed: ${error.message}\n`);
    }
}

/**
 * Azure Functions wrapper for Image Optimization (v3 model - function.json based).
 *
 * Adapts the Azure Functions runtime to work with OpenNext's image optimization handler.
 * Uses v3 signature: async (context, request) with context.res for response.
 */
const handler: WrapperHandler<InternalEvent, InternalResult> =
    async (handler, converter) =>
    async (context: any, request: any): Promise<void> => {
        try {
            const internalEvent = await converter.convertFrom(request);

            // Check cache first
            const cacheKey = computeCacheKey(internalEvent);
            const cachedBuffer = await getCachedImage(cacheKey);
            if (cachedBuffer) {
                process.stderr.write(`[ImageCache] ✓ Cache HIT\n`);
                context.res = {
                    status: 200,
                    headers: {
                        "Content-Type": "image/webp",
                        "Cache-Control": "public,max-age=31536000,immutable",
                    },
                    body: cachedBuffer,
                };
                return;
            }

            process.stderr.write(`[ImageCache] Cache MISS - processing...\n`);

            let streamFinished: Promise<void> | null = null;
            let resolveStream: (() => void) | null = null;
            let processedBuffer: Buffer | null = null;
            let responseContentType = "image/webp";

            const streamCreator = {
                writeHeaders(prelude: {
                    statusCode: number;
                    cookies: string[];
                    headers: Record<string, string>;
                }): Writable {
                    const { statusCode, cookies, headers } = prelude;

                    responseContentType = headers["Content-Type"] || headers["content-type"] || "image/webp";

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
                            write(_chunk, _encoding, callback) {
                                callback();
                            },
                        });
                    }

                    streamFinished = new Promise(resolve => {
                        resolveStream = resolve;
                    });

                    const chunks: Buffer[] = [];
                    const writable = new Writable({
                        write(chunk, _encoding, callback) {
                            chunks.push(Buffer.from(chunk));
                            callback();
                        },
                        final(callback) {
                            const body = Buffer.concat(chunks);
                            processedBuffer = body;
                            context.res = {
                                status: statusCode,
                                headers: responseHeaders,
                                body,
                            };
                            callback();
                            resolveStream?.();
                        },
                    });

                    return writable;
                },
            };

            await handler(internalEvent, { streamCreator });

            if (streamFinished) {
                await streamFinished;
            }

            // Cache the processed image
            if (processedBuffer && responseContentType) {
                await setCachedImage(cacheKey, processedBuffer, responseContentType);
            }
        } catch (error: any) {
            console.error("Image optimization error:", error);
            context.res = {
                status: 500,
                headers: {
                    "Content-Type": "text/plain",
                },
                body: "Internal server error",
            };
        }
    };

export default {
    name: "azure-image-optimization",
    wrapper: handler,
    supportStreaming: true,
};
