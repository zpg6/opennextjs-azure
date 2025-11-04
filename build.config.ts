import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
    entries: [
        "src/index",
        "src/cli/index",
        "src/config/index",
        "src/bindings/index",
        "src/infrastructure/bindings",
        "src/overrides/incrementalCache/azure-blob",
        "src/overrides/tagCache/azure-table",
        "src/overrides/queue/azure-queue",
        "src/overrides/imageLoader/azure-blob",
        "src/overrides/imageOptimization/azure-cached",
        "src/adapters/wrappers/azure-functions",
        "src/adapters/wrappers/azure-image-optimization",
        "src/adapters/converters/azure-http",
        "src/adapters/image-optimization",
    ],
    declaration: true,
    clean: true,
    failOnWarn: false,
    outDir: "dist",
    hooks: {
        // Copy infrastructure templates to dist at build time
        "build:done": async ctx => {
            const fs = await import("fs/promises");
            const path = await import("path");

            await fs.cp("infrastructure", path.join(ctx.options.outDir, "infrastructure"), { recursive: true });
        },
    },
    rollup: {
        emitCJS: false,
        esbuild: {
            target: "node18",
            minify: false,
        },
        output: {
            entryFileNames: "[name].js",
            chunkFileNames: "[name].js",
        },
    },
    externals: [
        "@opennextjs/aws",
        "@azure/storage-blob",
        "@azure/data-tables",
        "@azure/storage-queue",
        "@azure/functions",
        "@azure/cosmos",
        "@azure/service-bus",
        "@azure/event-hubs",
        "commander",
        "redis",
        "pg",
        "mysql2",
    ],
});
