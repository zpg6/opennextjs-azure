import type { OpenNextConfig, RoutePreloadingBehavior } from "@opennextjs/aws/types/open-next.js";
import type { IncrementalCache, TagCache, Queue } from "@opennextjs/aws/types/overrides.js";

export type AzureDeploymentTarget = "functions" | "static-web-apps" | "container-apps";

export interface AzureDeploymentConfig {
    target?: AzureDeploymentTarget;
    region?: string;
    resourceGroup?: string;
}

export interface AzureStorageConfig {
    connectionString?: string;
    accountName?: string;
    accountKey?: string;
    containerName?: string;
    tableName?: string;
    queueName?: string;
}

export interface AzureConfig {
    incrementalCache?: "azure-blob" | IncrementalCache;
    tagCache?: "azure-table" | TagCache;
    queue?: "azure-queue" | Queue;
    routePreloadingBehavior?: RoutePreloadingBehavior;
    middleware?: OpenNextConfig["middleware"];
    dangerous?: OpenNextConfig["dangerous"];
    buildCommand?: string;
    buildOutputPath?: string;
    appPath?: string;
    packageJsonPath?: string;
    deployment?: AzureDeploymentConfig;
    storage?: AzureStorageConfig;
    applicationInsights?: boolean;
}
