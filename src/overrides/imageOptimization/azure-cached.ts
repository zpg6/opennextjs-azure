import { createHash } from "node:crypto";
import { BlobServiceClient, BlockBlobClient } from "@azure/storage-blob";
import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next.js";
import type { OpenNextHandler, OpenNextHandlerOptions } from "@opennextjs/aws/types/overrides.js";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";

/**
 * Azure Blob Image Optimization Cache
 *
 * Caches optimized images in blob storage to avoid re-processing on subsequent requests.
 *
 * First Request Flow:
 *   User → /_next/image?url=/photo.jpg&w=640&q=75
 *   → Azure Function
 *   → Load source from "assets" container
 *   → Process with sharp
 *   → Cache in "optimized-images" container
 *   → Return optimized image
 *
 * Subsequent Request Flow:
 *   User → /_next/image?url=/photo.jpg&w=640&q=75
 *   → Azure Function
 *   → Cache hit in "optimized-images"
 *   → Return cached image (no processing!)
 *
 * Cache Key Format: {sha256(url).substring(0,16)}/w{width}_q{quality}.cache
 * Example: a1b2c3d4e5f6g7h8/w640_q75.cache
 */

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

async function getCachedImage(cacheKey: string): Promise<InternalResult | null> {
    try {
        const blobClient = getBlobClient(cacheKey);
        const exists = await blobClient.exists();

        if (!exists) {
            return null;
        }

        const downloadResponse = await blobClient.download();
        const properties = await blobClient.getProperties();

        if (!downloadResponse.readableStreamBody) {
            return null;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        return {
            type: "core",
            statusCode: 200,
            headers: {
                "Content-Type": properties.contentType || "image/webp",
                "Cache-Control": properties.cacheControl || "public,max-age=31536000,immutable",
                Vary: "Accept",
            },
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(buffer);
                    controller.close();
                },
            }),
            isBase64Encoded: true,
        };
    } catch (error) {
        return null;
    }
}

async function setCachedImage(cacheKey: string, result: InternalResult): Promise<void> {
    try {
        if (!result.body) {
            return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of result.body) {
            chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        const blobClient = getBlobClient(cacheKey);
        const contentTypeRaw = result.headers?.["Content-Type"] || result.headers?.["content-type"];
        const contentType = Array.isArray(contentTypeRaw) ? contentTypeRaw[0] : contentTypeRaw || "image/webp";
        const cacheControlRaw = result.headers?.["Cache-Control"] || result.headers?.["cache-control"];
        const cacheControl = Array.isArray(cacheControlRaw)
            ? cacheControlRaw[0]
            : cacheControlRaw || "public,max-age=31536000,immutable";

        await blobClient.upload(buffer, buffer.length, {
            blobHTTPHeaders: {
                blobContentType: contentType,
                blobCacheControl: cacheControl,
            },
        });
    } catch (error) {
        console.error("Failed to cache optimized image:", error);
    }
}

export function createCachedImageOptimizationHandler(
    defaultHandler: OpenNextHandler<InternalEvent, InternalResult>
): OpenNextHandler<InternalEvent, InternalResult> {
    return async (event: InternalEvent, options?: OpenNextHandlerOptions): Promise<InternalResult> => {
        const cacheKey = computeCacheKey(event);

        const cached = await getCachedImage(cacheKey);
        if (cached) {
            return cached;
        }

        const result = await defaultHandler(event, options);

        if (result.statusCode === 200 && result.body) {
            const chunks: Buffer[] = [];
            for await (const chunk of result.body) {
                chunks.push(Buffer.from(chunk));
            }
            const buffer = Buffer.concat(chunks);

            const resultWithBuffer = {
                ...result,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(buffer);
                        controller.close();
                    },
                }),
            };

            await setCachedImage(cacheKey, resultWithBuffer);

            return resultWithBuffer;
        }

        return result;
    };
}
