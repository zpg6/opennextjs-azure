import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
    entries: [
        "src/index",
        "src/cli/index",
        "src/config/index",
        "src/overrides/incrementalCache/azure-blob",
        "src/overrides/tagCache/azure-table",
        "src/overrides/queue/azure-queue",
        "src/overrides/imageLoader/azure-blob",
        "src/adapters/wrappers/azure-functions",
        "src/adapters/wrappers/azure-image-optimization",
        "src/adapters/wrappers/azure-queue-revalidate",
        "src/adapters/converters/azure-http",
        "src/adapters/converters/azure-queue-revalidate",
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
            target: "node20",
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
        "commander",
    ],
});
