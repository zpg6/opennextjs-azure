import { BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import type {
    CacheEntryType,
    CacheValue,
    IncrementalCache,
    WithLastModified,
} from "@opennextjs/aws/types/overrides.js";
import { getAzureConfig } from "../../config/index.js";

/**
 * Retry policy for blob calls on the request hot path. The SDK's default
 * first retry waits 4s; fail fast instead and let cache layers treat
 * errors as misses. Shared with the image-optimization wrapper.
 */
export const BLOB_RETRY_OPTIONS = {
    retryOptions: { maxTries: 3, retryDelayInMs: 300, maxRetryDelayInMs: 2000, tryTimeoutInMs: 10000 },
};

/**
 * Azure Blob Storage implementation of IncrementalCache.
 *
 * Stores Next.js ISR cache entries in Azure Blob Storage.
 * Compatible with the S3 cache interface from @opennextjs/aws.
 */
class AzureBlobIncrementalCache implements IncrementalCache {
    name = "azure-blob";
    private containerClient!: ContainerClient;

    constructor() {
        const { storage } = getAzureConfig();
        const connectionString = storage.connectionString;
        const accountName = storage.accountName;
        const accountKey = storage.accountKey;

        const clientOptions = BLOB_RETRY_OPTIONS;

        if (connectionString) {
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString, clientOptions);
            this.containerClient = blobServiceClient.getContainerClient(storage.containerName || "nextjs-cache");
        } else if (accountName && accountKey) {
            // The SDK needs a real credential object here; a plain
            // {accountName, accountKey} object gets anonymous access.
            const credential = new StorageSharedKeyCredential(accountName, accountKey);
            const blobServiceClient = new BlobServiceClient(
                `https://${accountName}.blob.core.windows.net`,
                credential,
                clientOptions
            );
            this.containerClient = blobServiceClient.getContainerClient(storage.containerName || "nextjs-cache");
        }
    }

    /**
     * Builds the blob key path, mimicking S3 structure:
     * [prefix]/[__fetch]/[buildId]/[key].[extension]
     *
     * Keys must match the .open-next/cache layout the seeder uploads, so no
     * container-name prefix and no leading slash.
     */
    private buildBlobKey(key: string, cacheType: CacheEntryType = "cache"): string {
        const { NEXT_BUILD_ID } = process.env;
        const prefix = process.env.AZURE_CACHE_KEY_PREFIX || "";
        const type = cacheType === "fetch" ? "__fetch" : "";
        const cleanKey = key.replace(/^\/+/, "");
        return [prefix, type, NEXT_BUILD_ID, cacheType === "fetch" ? cleanKey : `${cleanKey}.${cacheType}`]
            .filter(Boolean)
            .join("/");
    }

    async get<CacheType extends CacheEntryType = "cache">(
        key: string,
        cacheType?: CacheType
    ): Promise<WithLastModified<CacheValue<CacheType>> | null> {
        try {
            const blobKey = this.buildBlobKey(key, cacheType);
            const blobClient = this.containerClient.getBlobClient(blobKey);
            const downloadResponse = await blobClient.download();

            if (!downloadResponse.readableStreamBody) {
                return null;
            }

            // Read blob content
            const chunks: Buffer[] = [];
            for await (const chunk of downloadResponse.readableStreamBody) {
                chunks.push(Buffer.from(chunk));
            }

            const content = Buffer.concat(chunks).toString("utf8");
            const value = JSON.parse(content);

            return {
                value,
                lastModified: downloadResponse.lastModified?.getTime(),
            };
        } catch (error: any) {
            if (error.statusCode === 404) {
                return null;
            }
            process.stderr.write(`Failed to get from Azure Blob cache: ${error}\n`);
            return null;
        }
    }

    async set<CacheType extends CacheEntryType = "cache">(
        key: string,
        value: CacheValue<CacheType>,
        cacheType?: CacheType
    ): Promise<void> {
        try {
            const blobKey = this.buildBlobKey(key, cacheType);
            const blobClient = this.containerClient.getBlockBlobClient(blobKey);

            const content = JSON.stringify(value);
            // upload() takes a byte length, not the UTF-16 code-unit count.
            await blobClient.upload(content, Buffer.byteLength(content), {
                blobHTTPHeaders: {
                    blobContentType: "application/json",
                },
            });
        } catch (error) {
            process.stderr.write(`Failed to set Azure Blob cache: ${error}\n`);
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            const blobKey = this.buildBlobKey(key, "cache");
            const blobClient = this.containerClient.getBlobClient(blobKey);
            await blobClient.deleteIfExists();
        } catch (error) {
            process.stderr.write(`Failed to delete from Azure Blob cache: ${error}\n`);
        }
    }
}

export default AzureBlobIncrementalCache;
