import type { CosmosClient } from "@azure/cosmos";
import type { Pool as PostgresPool } from "pg";
import type { RedisClientType } from "redis";
import type { ServiceBusClient } from "@azure/service-bus";
import type { EventHubProducerClient } from "@azure/event-hubs";
import type { BindingType } from "../types/index.js";

export type BindingClientMap = {
    "cosmos-sql": CosmosClient;
    "cosmos-nosql": CosmosClient;
    "postgres-flexible": PostgresPool;
    "mysql-flexible": PostgresPool;
    redis: RedisClientType;
    "service-bus-queue": ServiceBusClient;
    "service-bus-topic": ServiceBusClient;
    "event-hub": EventHubProducerClient;
};

interface BindingMetadata {
    type: BindingType;
    envVars: {
        connectionString?: string;
        endpoint?: string;
        host?: string;
        primaryKey?: string;
    };
}

interface BindingFactory {
    create(envVars: BindingMetadata["envVars"]): unknown;
    shouldCache: boolean;
}

const BINDING_FACTORIES: Record<BindingType, BindingFactory> = {
    "cosmos-sql": {
        create: envVars => {
            const { CosmosClient } = require("@azure/cosmos");
            return new CosmosClient(process.env[envVars.endpoint!]!, {
                key: process.env[envVars.primaryKey!],
            });
        },
        shouldCache: true,
    },

    "cosmos-nosql": {
        create: envVars => {
            const { CosmosClient } = require("@azure/cosmos");
            return new CosmosClient(process.env[envVars.connectionString!]!);
        },
        shouldCache: true,
    },

    "postgres-flexible": {
        create: envVars => {
            const { Pool } = require("pg");
            return new Pool({
                connectionString: process.env[envVars.connectionString!],
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });
        },
        shouldCache: true,
    },

    "mysql-flexible": {
        create: envVars => {
            const mysql = require("mysql2/promise");
            return mysql.createPool({
                uri: process.env[envVars.connectionString!],
                waitForConnections: true,
                connectionLimit: 10,
            });
        },
        shouldCache: true,
    },

    redis: {
        create: envVars => {
            const { createClient } = require("redis");
            return createClient({
                url: process.env[envVars.connectionString!],
                socket: {
                    connectTimeout: 5000,
                    reconnectStrategy: (retries: number) => Math.min(retries * 50, 500),
                },
            });
        },
        shouldCache: true,
    },

    "service-bus-queue": {
        create: envVars => {
            const { ServiceBusClient } = require("@azure/service-bus");
            return new ServiceBusClient(process.env[envVars.connectionString!]!);
        },
        shouldCache: true,
    },

    "service-bus-topic": {
        create: envVars => {
            const { ServiceBusClient } = require("@azure/service-bus");
            return new ServiceBusClient(process.env[envVars.connectionString!]!);
        },
        shouldCache: true,
    },

    "event-hub": {
        create: envVars => {
            const { EventHubProducerClient } = require("@azure/event-hubs");
            return new EventHubProducerClient(process.env[envVars.connectionString!]!);
        },
        shouldCache: true,
    },
};

let bindingsMetadata: Record<string, BindingMetadata> | null = null;
const clientCache = new Map<string, unknown>();

function loadBindingsMetadata(): Record<string, BindingMetadata> {
    if (bindingsMetadata) {
        return bindingsMetadata;
    }

    try {
        const metadataPath = process.env.BINDINGS_METADATA_PATH || "./.bindings.json";
        bindingsMetadata = require(metadataPath);
        return bindingsMetadata!;
    } catch {
        return {};
    }
}

/**
 * Get a typed binding client by name.
 *
 * @example
 * ```ts
 * const db = getBinding<'cosmos-sql'>('DATABASE');
 * const cache = getBinding<'redis'>('CACHE');
 * const pg = getBinding<'postgres-flexible'>('POSTGRES');
 * ```
 */
export function getBinding<T extends BindingType>(name: string): BindingClientMap[T] {
    if (clientCache.has(name)) {
        return clientCache.get(name) as BindingClientMap[T];
    }

    const metadata = loadBindingsMetadata();

    if (!metadata[name]) {
        const available = Object.keys(metadata);
        throw new Error(
            `Binding "${name}" not found.\n` +
                (available.length > 0
                    ? `Available bindings: ${available.join(", ")}`
                    : `No bindings configured in azure.config.json`) +
                `\n\nAdd to azure.config.json:\n` +
                `{\n  "bindings": {\n    "${name}": { "type": "..." }\n  }\n}`
        );
    }

    const binding = metadata[name];
    const factory = BINDING_FACTORIES[binding.type];

    if (!factory) {
        throw new Error(
            `Unknown binding type "${binding.type}" for binding "${name}".\n` +
                `Supported types: ${Object.keys(BINDING_FACTORIES).join(", ")}`
        );
    }

    for (const [, envVarName] of Object.entries(binding.envVars)) {
        if (envVarName && !process.env[envVarName]) {
            throw new Error(
                `Missing environment variable "${envVarName}" for binding "${name}".\n` +
                    `This should have been set during deployment. Try redeploying.`
            );
        }
    }

    const client = factory.create(binding.envVars);

    if (factory.shouldCache) {
        clientCache.set(name, client);
    }

    return client as BindingClientMap[T];
}

/**
 * Clear the binding client cache.
 * Useful for testing or when you need to recreate connections.
 */
export function clearBindingsCache(): void {
    clientCache.clear();
}
