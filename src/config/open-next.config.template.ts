import type { OpenNextConfig } from "@opennextjs/aws/types/open-next";

const config: OpenNextConfig = {
    default: {
        override: {
            wrapper: () => import("opennextjs-azure/adapters/wrappers/azure-functions").then(m => m.default),
            converter: () => import("opennextjs-azure/adapters/converters/azure-http").then(m => m.default),
            incrementalCache: () =>
                import("opennextjs-azure/overrides/incrementalCache/azure-blob").then(m => new m.default()),
            tagCache: () => import("opennextjs-azure/overrides/tagCache/azure-table").then(m => new m.default()),
            queue: () => import("opennextjs-azure/overrides/queue/azure-queue").then(m => new m.default()),
        },
    },
};

export default config;
