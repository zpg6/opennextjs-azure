import fs from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { encodeTableKey } from "../overrides/tagCache/azure-table.js";

/**
 * Seeds the runtime cache stores from the build output.
 *
 * OpenNext emits two artifacts the runtime depends on:
 *  - `.open-next/cache/`: prerendered ISR entries, laid out exactly as the
 *    blob incremental cache expects (`<buildId>/<key>.cache`, `__fetch/...`)
 *  - `.open-next/dynamodb-provider/dynamodb-cache.json`: the tag/path map the
 *    "original"-mode tag cache must be prepopulated with. Without it,
 *    revalidateTag and revalidatePath have nothing to look up and do nothing.
 *
 * Container, table, and key-prefix names honor the same environment
 * variables the runtime reads (getAzureConfig), so custom names stay in
 * sync between seeding and serving.
 */
export async function seedCacheAssets(
    connectionString: string,
    options: {
        openNextDir?: string;
        containerName?: string;
        tableName?: string;
    } = {}
): Promise<void> {
    const openNextDir = options.openNextDir ?? path.join(process.cwd(), ".open-next");
    const containerName = options.containerName ?? process.env.AZURE_STORAGE_CONTAINER_NAME ?? "nextjs-cache";
    const tableName = options.tableName ?? process.env.AZURE_TABLE_NAME ?? "nextjstags";

    await Promise.all([
        seedIncrementalCache(connectionString, path.join(openNextDir, "cache"), containerName),
        seedTagTable(connectionString, path.join(openNextDir, "dynamodb-provider/dynamodb-cache.json"), tableName),
    ]);
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<number> {
    let index = 0;
    let done = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            for (let i = index++; i < items.length; i = index++) {
                await fn(items[i]);
                done++;
            }
        })
    );
    return done;
}

export async function seedIncrementalCache(
    connectionString: string,
    cacheDir: string,
    containerName = "nextjs-cache"
): Promise<number> {
    let files: string[];
    try {
        files = (await fs.readdir(cacheDir, { recursive: true, withFileTypes: true }))
            .filter(entry => entry.isFile())
            // parentPath landed in Node 20.12; older 20.x names it `path`
            .map(entry => path.join(entry.parentPath ?? (entry as any).path, entry.name));
    } catch {
        return 0; // no prerendered cache emitted
    }

    const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
    await container.createIfNotExists();

    const keyPrefix = process.env.AZURE_CACHE_KEY_PREFIX ? `${process.env.AZURE_CACHE_KEY_PREFIX}/` : "";
    return runPool(files, 8, async file => {
        const blobName = keyPrefix + path.relative(cacheDir, file).split(path.sep).join("/");
        await container.getBlockBlobClient(blobName).uploadFile(file, {
            blobHTTPHeaders: { blobContentType: "application/json" },
        });
    });
}

interface DynamoSeedEntry {
    tag: { S: string };
    path: { S: string };
    revalidatedAt: { N: string };
}

export async function seedTagTable(
    connectionString: string,
    seedFile: string,
    tableName = "nextjstags"
): Promise<number> {
    let entries: DynamoSeedEntry[];
    try {
        entries = JSON.parse(await fs.readFile(seedFile, "utf-8"));
    } catch {
        return 0; // no tag seed emitted
    }

    const table = TableClient.fromConnectionString(connectionString, tableName, {
        allowInsecureConnection: connectionString.includes("http://"),
    });
    await table.createTable().catch((error: any) => {
        if (error.statusCode !== 409) throw error;
    });

    return runPool(entries, 8, async entry => {
        // Seed values already carry the buildId prefix, so encode only.
        // Both directions match the runtime schema: forward (tag, path) for
        // getByTag, reverse (path#, tag) for getByPath and getLastModified.
        await Promise.all([
            table.upsertEntity(
                {
                    partitionKey: encodeTableKey(entry.tag.S),
                    rowKey: encodeTableKey(entry.path.S),
                    revalidatedAt: Number(entry.revalidatedAt.N),
                },
                "Merge"
            ),
            table.upsertEntity(
                {
                    partitionKey: encodeTableKey(`path#${entry.path.S}`),
                    rowKey: encodeTableKey(entry.tag.S),
                    revalidatedAt: Number(entry.revalidatedAt.N),
                },
                "Merge"
            ),
        ]);
    });
}
