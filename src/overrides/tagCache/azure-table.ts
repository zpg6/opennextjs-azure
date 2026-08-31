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

        // Default SDK retry backoff is seconds-long; this sits on the page
        // hot path, so fail fast and let the cache layer degrade gracefully.
        const clientOptions = {
            retryOptions: { maxRetries: 3, maxRetryDelayInMs: 2000 },
        };

        if (connectionString) {
            this.tableClient = TableClient.fromConnectionString(connectionString, tableName, clientOptions);
        } else if (accountName && accountKey) {
            const credential = new AzureNamedKeyCredential(accountName, accountKey);
            this.tableClient = new TableClient(
                `https://${accountName}.table.core.windows.net`,
                tableName,
                credential,
                clientOptions
            );
        }
    }

    /**
     * Keys arrive from Next with a leading slash ("/isr") while seeded rows
     * use posix-joined values ("<buildId>/isr") — strip it so both sides
     * land on the same key, matching the blob cache's normalization.
     */
    private buildKey(key: string): string {
        const { NEXT_BUILD_ID } = process.env;
        return encodeTableKey(`${NEXT_BUILD_ID}/${key.replace(/^\/+/, "")}`);
    }

    /**
     * Reverse-index partition key for a path. Every tag/path pair is written
     * twice, (PK=tag, RK=path) and (PK=path#..., RK=tag), so getByPath and
     * getLastModified are partition queries. Azure Tables' only index is
     * PartitionKey+RowKey; a RowKey-only filter scans every partition, one
     * round trip per 1,000 rows.
     */
    private buildPathKey(path: string): string {
        const { NEXT_BUILD_ID } = process.env;
        return encodeTableKey(`path#${NEXT_BUILD_ID}/${path.replace(/^\/+/, "")}`);
    }

    private stripBuildId(encodedKey: string): string {
        const { NEXT_BUILD_ID } = process.env;
        return decodeTableKey(encodedKey).replace(`${NEXT_BUILD_ID}/`, "");
    }

    /** Escapes a value for interpolation into an OData filter string literal. */
    private odataEscape(value: string): string {
        return value.replace(/'/g, "''");
    }

    async getByTag(tag: string): Promise<string[]> {
        try {
            const queryKey = this.buildKey(tag);
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${this.odataEscape(queryKey)}'` },
            });

            const paths: string[] = [];
            for await (const entity of entities) {
                if (entity.rowKey) {
                    paths.push(this.stripBuildId(entity.rowKey.toString()));
                }
            }

            return paths;
        } catch (error) {
            process.stderr.write(`Failed to get by tag from Azure Table: ${error}\n`);
            return [];
        }
    }

    async getByPath(path: string): Promise<string[]> {
        try {
            const pathKey = this.buildPathKey(path);
            const entities = this.tableClient.listEntities({
                queryOptions: { filter: `PartitionKey eq '${this.odataEscape(pathKey)}'` },
            });

            const tags: string[] = [];
            for await (const entity of entities) {
                if (entity.rowKey) {
                    tags.push(this.stripBuildId(entity.rowKey.toString()));
                }
            }

            return tags;
        } catch (error) {
            process.stderr.write(`Failed to get by path from Azure Table: ${error}\n`);
            return [];
        }
    }

    async getLastModified(path: string, lastModified?: number): Promise<number> {
        try {
            const pathKey = this.buildPathKey(path);
            // revalidatedAt is stored as Edm.Double, and Azure rejects bare
            // integer literals above Int32 (epoch-ms values) with a 400 —
            // the literal must be a double, hence toFixed(1).
            const entities = this.tableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${this.odataEscape(pathKey)}' and revalidatedAt gt ${Number(lastModified ?? 0).toFixed(1)}`,
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
            process.stderr.write(`Failed to get last modified from Azure Table: ${error}\n`);
            return lastModified ?? Date.now();
        }
    }

    async writeTags(tags: OriginalTagCacheWriteInput[]): Promise<void> {
        // Forward row (tag, path) serves getByTag; reverse row (path#, tag)
        // makes getByPath and getLastModified partition queries. The reverse
        // row goes first: if only one write lands, it must be the one that
        // makes getLastModified see the revalidation. Concurrency is capped —
        // a large revalidateTag must not fire hundreds of parallel requests
        // from one worker.
        const CONCURRENCY = 16;
        const queue = [...tags];
        const failures: unknown[] = [];

        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
                for (let pair = queue.shift(); pair; pair = queue.shift()) {
                    const { tag, path, revalidatedAt } = pair;
                    const stamp = revalidatedAt ?? Date.now();
                    try {
                        await this.tableClient.upsertEntity(
                            {
                                partitionKey: this.buildPathKey(path),
                                rowKey: this.buildKey(tag),
                                revalidatedAt: stamp,
                            },
                            "Merge"
                        );
                        await this.tableClient.upsertEntity(
                            {
                                partitionKey: this.buildKey(tag),
                                rowKey: this.buildKey(path),
                                revalidatedAt: stamp,
                            },
                            "Merge"
                        );
                    } catch (error) {
                        failures.push(error);
                    }
                }
            })
        );

        if (failures.length > 0) {
            process.stderr.write(`Failed to write ${failures.length}/${tags.length} tag pairs to Azure Table: ${failures[0]}\n`);
            // Throwing is intentional: reads fail open (stale page, cache
            // miss), but a revalidation that didn't persist must not report
            // success to the app.
            throw failures[0];
        }
    }
}

/**
 * Azure Table Storage forbids '/', '\', '#', '?' and control characters in
 * PartitionKey/RowKey. Percent-encodes the forbidden set (plus '%' itself so
 * decoding is unambiguous). Exported for the deploy-time table seeder.
 */
export function encodeTableKey(part: string): string {
    // eslint-disable-next-line no-control-regex
    return part.replace(/[%/\\#?\u0000-\u001f\u007f-\u009f]/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function decodeTableKey(part: string): string {
    return part.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export default AzureTableTagCache;
