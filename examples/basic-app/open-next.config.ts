// @ts-nocheck
export default {
    default: {
        override: {
            wrapper: () =>
                import("./node_modules/opennextjs-azure/dist/adapters/wrappers/azure-functions.js").then(
                    m => m.default
                ),
            converter: () =>
                import("./node_modules/opennextjs-azure/dist/adapters/converters/azure-http.js").then(m => m.default),
            incrementalCache: () =>
                import("./node_modules/opennextjs-azure/dist/overrides/incrementalCache/azure-blob.js").then(
                    m => new m.default()
                ),
            tagCache: () =>
                import("./node_modules/opennextjs-azure/dist/overrides/tagCache/azure-table.js").then(
                    m => new m.default()
                ),
            queue: () =>
                import("./node_modules/opennextjs-azure/dist/overrides/queue/azure-queue.js").then(
                    m => new m.default()
                ),
            proxyExternalRequest: "fetch",
        },
        routePreloadingBehavior: "none",
    },
    middleware: {
        external: false,
    },
    buildOutputPath: ".",
    appPath: ".",
};
