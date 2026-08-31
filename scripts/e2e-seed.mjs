// Provisions Azurite storage and seeds it exactly the way deploy does, via
// the same compiled seeding module. Run from the example app directory.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = process.cwd();
const conn = "UseDevelopmentStorage=true";

// Resolve the SDKs through the installed adapter package: with pnpm they are
// not hoisted to the app's node_modules root.
const require = createRequire(path.join(appDir, "node_modules/opennextjs-azure/package.json"));
const { BlobServiceClient } = require("@azure/storage-blob");
const { TableClient } = require("@azure/data-tables");
const { QueueServiceClient } = require("@azure/storage-queue");

const blobService = BlobServiceClient.fromConnectionString(conn);
await blobService.getContainerClient("nextjs-cache").createIfNotExists();
await blobService.getContainerClient("assets").createIfNotExists({ access: "blob" });
await blobService.getContainerClient("optimized-images").createIfNotExists();
await TableClient.fromConnectionString(conn, "nextjstags", { allowInsecureConnection: true })
    .createTable()
    .catch(error => {
        if (error.statusCode !== 409) throw error;
    });
await QueueServiceClient.fromConnectionString(conn).getQueueClient("nextjsrevalidation").createIfNotExists();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { seedCacheAssets } = await import(path.join(repoRoot, "dist/deploy/seed-cache.js"));
await seedCacheAssets(conn);
console.log("provisioned and seeded");
