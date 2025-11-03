import { build as openNextBuild } from "@opennextjs/aws/build.js";
import path from "node:path";
import fs from "node:fs";
import { prepareFunctions } from "./prepare-functions.js";
import { greenCheck } from "./log.js";

export async function build(configPath?: string): Promise<void> {
    console.log("Building Next.js app for Azure...");

    const baseDir = process.cwd();
    const userConfigPath = configPath || "open-next.config.ts";
    const absoluteUserConfigPath = path.join(baseDir, userConfigPath);

    let resolvedConfigPath = userConfigPath;
    let tempConfigPath: string | null = null;

    // If no user config exists, create a temporary one with Azure adapters
    if (!fs.existsSync(absoluteUserConfigPath)) {
        console.log("No open-next.config.ts found, using default Azure configuration");

        // Resolve the absolute path to the opennextjs-azure package
        const { createRequire } = await import("node:module");
        const require = createRequire(import.meta.url);
        const packagePath = path.dirname(require.resolve("opennextjs-azure/package.json"));

        const wrapperPath = path.join(packagePath, "dist/adapters/wrappers/azure-functions.js");
        const converterPath = path.join(packagePath, "dist/adapters/converters/azure-http.js");
        const incrementalCachePath = path.join(packagePath, "dist/overrides/incrementalCache/azure-blob.js");
        const tagCachePath = path.join(packagePath, "dist/overrides/tagCache/azure-table.js");
        const queuePath = path.join(packagePath, "dist/overrides/queue/azure-queue.js");

        tempConfigPath = path.join(baseDir, "open-next.config.ts");
        const configContent = `// @ts-nocheck
export default {
    default: {
        override: {
            wrapper: () => import("${wrapperPath}").then(m => m.default),
            converter: () => import("${converterPath}").then(m => m.default),
            incrementalCache: () => import("${incrementalCachePath}").then(m => new m.default()),
            tagCache: () => import("${tagCachePath}").then(m => new m.default()),
            queue: () => import("${queuePath}").then(m => new m.default()),
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
`;
        fs.writeFileSync(tempConfigPath, configContent);
        resolvedConfigPath = "open-next.config.ts";
    }

    try {
        // Step 1: Clean previous build output
        const openNextPath = path.join(baseDir, ".open-next");
        if (fs.existsSync(openNextPath)) {
            console.log("Cleaning previous build output...");
            fs.rmSync(openNextPath, { recursive: true, force: true });
            console.log(`  ${greenCheck()} Previous build cleaned`);
        }

        // Step 2: Build with OpenNext (it expects a relative config file path)
        console.log("Running OpenNext build...");
        const externals = ["@opennextjs/aws"].join(",");
        await openNextBuild(resolvedConfigPath, externals);

        // Step 3: Add Azure Functions metadata
        await prepareFunctions();

        console.log("Build completed successfully!");
        console.log("Output: .open-next/");
        console.log("  ├── server-functions/default  (Azure Functions app)");
        console.log("  └── assets                    (Static files)");
        console.log("Next: opennextjs-azure deploy");
    } catch (error) {
        console.error("Build failed:", error);
        process.exit(1);
    } finally {
        if (tempConfigPath && fs.existsSync(tempConfigPath)) {
            fs.unlinkSync(tempConfigPath);
        }
    }
}
