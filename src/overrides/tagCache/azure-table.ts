import { TableClient, AzureNamedKeyCredential } from "@azure/data-tables";
import type { OriginalTagCache, OriginalTagCacheWriteInput } from "@opennextjs/aws/types/overrides.js";
import { getAzureConfig } from "../../config/index.js";

/**
 * Azure Table Storage implementation of TagCache.
 *
 * Stores tag-to-path mappings for Next.js revalidateTag/revalidatePath.
 * Uses the "original" mode which requires pre-population but offers fast reads.
 *
 * Schema:
 * - PartitionKey: tag (e.g., "buildId/product")
 * - RowKey: path (e.g., "buildId/products/123")
 * - revalidatedAt: timestamp
 */
class AzureTableTagCache implements OriginalTagCache {
    mode = "original" as const;
    name = "azure-table";
    private tableClient!: TableClient;

    constructor() {
        const { storage } = getAzureConfig();
        const connectionString = storage.connectionString;
        const accountName = storage.accountName;
        const accountKey = storage.accountKey;
        const tableName = storage.tableName || "nextjstags";

        if (connectionString) {
            this.tableClient = TableClient.fromConnectionString(connectionString, tableName);
            this.ensureTableExists();
        } else if (accountName && accountKey) {
            const credential = new AzureNamedKeyCredential(accountName, accountKey);
            this.tableClient = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, credential);
            this.ensureTableExists();
        }
    }

    private async ensureTableExists(): Promise<void> {
        try {
            await this.tableClient.createTable();
        } catch (error: any) {
            // 409 = table already exists, which is fine
            if (error.statusCode !== 409) {
                console.error("Failed to create Azure Table:", error);
            }
        }
    }

    private buildKey(key: string): string {
        const { NEXT_BUILD_ID } = process.env;
        return `${NEXT_BUILD_ID}/${key}`;
    }

    async getByTag(tag: string): Promise<string[]> {
        try {
            const queryKey = this.buildKey(tag);
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${queryKey}'` },
            });

            const paths: string[] = [];
            for await (const entity of entities) {
                if (entity.rowKey) {
                    const { NEXT_BUILD_ID } = process.env;
                    const path = entity.rowKey.toString().replace(`${NEXT_BUILD_ID}/`, "");
                    paths.push(path);
                }
            }

            return paths;
        } catch (error) {
            console.error("Failed to get by tag from Azure Table:", error);
            return [];
        }
    }

    async getByPath(path: string): Promise<string[]> {
        try {
            const queryKey = this.buildKey(path);
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `RowKey eq '${queryKey}'` },
            });

            const tags: string[] = [];
            for await (const entity of entities) {
                if (entity.partitionKey) {
                    const { NEXT_BUILD_ID: buildId } = process.env;
                    const tag = entity.partitionKey.toString().replace(`${buildId}/`, "");
                    tags.push(tag);
                }
            }

            return tags;
        } catch (error) {
            console.error("Failed to get by path from Azure Table:", error);
            return [];
        }
    }

    async getLastModified(path: string, lastModified?: number): Promise<number> {
        try {
            const queryKey = this.buildKey(path);
            const entities = this.tableClient.listEntities({
                queryOptions: {
                    filter: `RowKey eq '${queryKey}' and RevalidatedAt gt ${lastModified ?? 0}L`,
                },
            });

            // If any tag has been revalidated since lastModified, return -1 to force revalidation
            for await (const entity of entities) {
                if (entity.revalidatedAt) {
                    return -1;
                }
            }

            return lastModified ?? Date.now();
        } catch (error) {
            console.error("Failed to get last modified from Azure Table:", error);
            return lastModified ?? Date.now();
        }
    }

    async writeTags(tags: OriginalTagCacheWriteInput[]): Promise<void> {
        try {
            // Batch write tag-path relationships
            for (const { tag, path, revalidatedAt } of tags) {
                const entity = {
                    partitionKey: this.buildKey(tag),
                    rowKey: this.buildKey(path),
                    revalidatedAt: revalidatedAt ?? Date.now(),
                };

                await this.tableClient.upsertEntity(entity, "Merge");
            }
        } catch (error) {
            console.error("Failed to write tags to Azure Table:", error);
        }
    }
}

export default AzureTableTagCache;
