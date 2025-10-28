import type { OpenNextConfig } from "@opennextjs/aws/types/open-next";

const config: OpenNextConfig = {
    default: {
        override: {
            wrapper: () => import("opennext-azure/adapters/wrappers/azure-functions.js").then(m => m.default),
            converter: () => import("opennext-azure/adapters/converters/azure-http.js").then(m => m.default),
            incrementalCache: () =>
                import("opennext-azure/overrides/incrementalCache/azure-blob.js").then(m => new m.default()),
            tagCache: () => import("opennext-azure/overrides/tagCache/azure-table.js").then(m => new m.default()),
            queue: () => import("opennext-azure/overrides/queue/azure-queue.js").then(m => new m.default()),
        },
    },
};

export default config;
