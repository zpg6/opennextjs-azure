import type { OpenNextConfig, RoutePreloadingBehavior } from "@opennextjs/aws/types/open-next.js";
import type { IncrementalCache, TagCache, Queue, ImageLoader } from "@opennextjs/aws/types/overrides.js";

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

export type BindingType =
    | "cosmos-sql"
    | "cosmos-nosql"
    | "postgres-flexible"
    | "mysql-flexible"
    | "redis"
    | "service-bus-queue"
    | "service-bus-topic"
    | "event-hub";

export interface BaseBinding {
    type: BindingType;
    resourceName?: string;
}

export interface CosmosBinding extends BaseBinding {
    type: "cosmos-sql" | "cosmos-nosql";
    databaseName?: string;
    throughput?: number;
    autoscale?: boolean;
}

export interface PostgresBinding extends BaseBinding {
    type: "postgres-flexible";
    databaseName?: string;
    sku?: "Standard_B1ms" | "Standard_B2s" | "Standard_D2s_v3";
    version?: "16" | "15" | "14" | "13";
    storageSizeGB?: 32 | 64 | 128 | 256 | 512;
    adminUsername?: string;
}

export interface MySQLBinding extends BaseBinding {
    type: "mysql-flexible";
    databaseName?: string;
    sku?: "Standard_B1ms" | "Standard_B2s" | "Standard_D2s_v3";
    version?: "8.0.21" | "5.7";
    storageSizeGB?: 20 | 32 | 64 | 128;
    adminUsername?: string;
}

export interface RedisBinding extends BaseBinding {
    type: "redis";
    sku?: "Basic" | "Standard" | "Premium";
    capacity?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ServiceBusQueueBinding extends BaseBinding {
    type: "service-bus-queue";
    queueName?: string;
    maxDeliveryCount?: number;
    lockDuration?: string;
}

export interface ServiceBusTopicBinding extends BaseBinding {
    type: "service-bus-topic";
    topicName?: string;
    subscriptionName?: string;
}

export interface EventHubBinding extends BaseBinding {
    type: "event-hub";
    eventHubName?: string;
    partitionCount?: number;
    messageRetentionInDays?: number;
}

export type BindingConfig =
    | CosmosBinding
    | PostgresBinding
    | MySQLBinding
    | RedisBinding
    | ServiceBusQueueBinding
    | ServiceBusTopicBinding
    | EventHubBinding;

export interface AzureConfig {
    incrementalCache?: "azure-blob" | IncrementalCache;
    tagCache?: "azure-table" | TagCache;
    queue?: "azure-queue" | Queue;
    imageLoader?: "azure-blob" | ImageLoader | (() => Promise<ImageLoader>);
    enableImageOptimizationCache?: boolean;
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
    bindings?: Record<string, BindingConfig>;
}
