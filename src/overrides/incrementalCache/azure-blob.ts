import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import type {
    CacheEntryType,
    CacheValue,
    IncrementalCache,
    WithLastModified,
} from "@opennextjs/aws/types/overrides.js";
import { getAzureConfig } from "../../config/index.js";

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

        if (connectionString) {
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            this.containerClient = blobServiceClient.getContainerClient(storage.containerName || "nextjs-cache");
        } else if (accountName && accountKey) {
            const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, {
                accountName,
                accountKey,
            } as any);
            this.containerClient = blobServiceClient.getContainerClient(storage.containerName || "nextjs-cache");
        }
    }

    /**
     * Builds the blob key path, mimicking S3 structure:
     * [prefix]/[__fetch]/[buildId]/[key].[extension]
     */
    private buildBlobKey(key: string, cacheType: CacheEntryType = "cache"): string {
        const { storage } = getAzureConfig();
        const { NEXT_BUILD_ID } = process.env;
        const prefix = storage.containerName || "";
        const type = cacheType === "fetch" ? "__fetch" : "";
        return [prefix, type, NEXT_BUILD_ID, cacheType === "fetch" ? key : `${key}.${cacheType}`]
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
            await blobClient.upload(content, content.length, {
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
