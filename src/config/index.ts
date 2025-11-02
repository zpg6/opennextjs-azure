import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";
import type { IncrementalCache, TagCache, Queue, ImageLoader } from "@opennextjs/aws/types/overrides.js";
import type { AzureConfig } from "../types/index.js";

/**
 * Defines the OpenNext configuration for Azure deployment.
 *
 * This extends the base OpenNext config with Azure-specific settings,
 * using Azure Blob Storage, Table Storage, and Queue Storage by default.
 */
export function defineAzureConfig(config: AzureConfig = {}): OpenNextConfig {
    return {
        default: {
            override: {
                wrapper: () => import("../adapters/wrappers/azure-functions.js").then(m => m.default),
                converter: () => import("../adapters/converters/azure-http.js").then(m => m.default),
                incrementalCache: resolveIncremental(config.incrementalCache),
                tagCache: resolveTag(config.tagCache),
                queue: resolveQueue(config.queue),
                proxyExternalRequest: "fetch",
            },
            routePreloadingBehavior: config.routePreloadingBehavior || "none",
        },
        middleware: config.middleware || {
            external: false,
        },
        imageOptimization: {
            loader: resolveImageLoader(config.imageLoader),
        },
        dangerous: config.dangerous,
        buildCommand: config.buildCommand,
        buildOutputPath: config.buildOutputPath || ".",
        appPath: config.appPath || ".",
        packageJsonPath: config.packageJsonPath,
    };
}

function resolveIncremental(value?: AzureConfig["incrementalCache"]) {
    if (!value || value === "azure-blob") {
        return () => import("../overrides/incrementalCache/azure-blob.js").then(m => new m.default());
    }
    if (typeof value === "function") {
        return value;
    }
    return () => value as IncrementalCache;
}

function resolveTag(value?: AzureConfig["tagCache"]) {
    if (!value || value === "azure-table") {
        return () => import("../overrides/tagCache/azure-table.js").then(m => new m.default());
    }
    if (typeof value === "function") {
        return value;
    }
    return () => value as TagCache;
}

function resolveQueue(value?: AzureConfig["queue"]) {
    if (!value || value === "azure-queue") {
        return () => import("../overrides/queue/azure-queue.js").then(m => new m.default());
    }
    if (typeof value === "function") {
        return value;
    }
    return () => value as Queue;
}

function resolveImageLoader(value?: AzureConfig["imageLoader"]) {
    if (!value || value === "azure-blob") {
        return () => import("../overrides/imageLoader/azure-blob.js").then(m => m.default);
    }
    if (typeof value === "function") {
        return value;
    }
    return () => value as ImageLoader;
}

/**
 * Gets Azure configuration from environment variables.
 * Used at runtime by the storage adapters.
 */
export function getAzureConfig() {
    return {
        deployment: {
            target: (process.env.AZURE_DEPLOYMENT_TARGET as any) || "functions",
            region: process.env.AZURE_REGION || "eastus",
        },
        storage: {
            connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
            accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
            accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
            containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || "nextjs-cache",
            tableName: process.env.AZURE_TABLE_NAME || "nextjstags",
            queueName: process.env.AZURE_QUEUE_NAME || "nextjsrevalidation",
        },
    };
}
