import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

export interface ScaffoldOptions {
    typescript?: boolean;
    tailwind?: boolean;
    eslint?: boolean;
    srcDir?: boolean;
    appRouter?: boolean;
    importAlias?: string;
    packageManager?: "npm" | "yarn" | "pnpm" | "bun";
}

/**
 * Scaffolds a new Next.js project with opinionated defaults:
 * - TypeScript, App Router, Tailwind v4, ESLint, src/ directory
 */
export async function scaffoldProject(targetDir: string, options: ScaffoldOptions = {}): Promise<void> {
    console.log("Scaffolding new Next.js project...\n");

    const {
        typescript = true,
        tailwind = true,
        eslint = true,
        srcDir = true,
        appRouter = true,
        importAlias = "@/*",
        packageManager = "pnpm",
    } = options;

    const flags = [
        typescript && "--typescript",
        appRouter && "--app",
        tailwind && "--tailwind",
        eslint && "--eslint",
        srcDir && "--src-dir",
        importAlias && `--import-alias "${importAlias}"`,
        packageManager && `--use-${packageManager}`,
        "--yes",
    ]
        .filter(Boolean)
        .join(" ");

    await execAsync(`npx create-next-app@15 ${targetDir} ${flags}`, { cwd: path.dirname(targetDir) });

    console.log("Next.js project created\n");

    // Add minimal Azure dependencies
    const packageJsonPath = path.join(targetDir, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

    packageJson.dependencies = {
        ...packageJson.dependencies,
        "opennextjs-azure": "latest",
    };

    packageJson.devDependencies = {
        ...packageJson.devDependencies,
        esbuild: "^0.25.11",
    };

    // Remove turbopack flags (not compatible with standalone builds)
    if (packageJson.scripts.dev) {
        packageJson.scripts.dev = packageJson.scripts.dev.replace(" --turbopack", "");
    }
    if (packageJson.scripts.build) {
        packageJson.scripts.build = packageJson.scripts.build.replace(" --turbopack", "");
    }

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Add output: "standalone" to next.config.ts
    const nextConfigPath = path.join(targetDir, "next.config.ts");
    let nextConfig = await fs.readFile(nextConfigPath, "utf-8");

    // Insert output: "standalone" into the config object
    nextConfig = nextConfig.replace(
        /const nextConfig: NextConfig = \{/,
        `const nextConfig: NextConfig = {\n  output: "standalone",`
    );

    await fs.writeFile(nextConfigPath, nextConfig);

    console.log("Installing dependencies...");

    await fs.unlink(path.join(targetDir, "pnpm-lock.yaml")).catch(() => {});
    await execAsync("pnpm install", { cwd: targetDir });

    console.log("Dependencies installed\n");

    console.log("Creating open-next.config.ts...");
    const openNextConfig = `// @ts-nocheck
export default {
    default: {
        override: {
            wrapper: () => import("./node_modules/opennextjs-azure/dist/adapters/wrappers/azure-functions.js").then(m => m.default),
            converter: () => import("./node_modules/opennextjs-azure/dist/adapters/converters/azure-http.js").then(m => m.default),
            incrementalCache: () => import("./node_modules/opennextjs-azure/dist/overrides/incrementalCache/azure-blob.js").then(m => new m.default()),
            tagCache: () => import("./node_modules/opennextjs-azure/dist/overrides/tagCache/azure-table.js").then(m => new m.default()),
            queue: () => import("./node_modules/opennextjs-azure/dist/overrides/queue/azure-queue.js").then(m => new m.default()),
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
    await fs.writeFile(path.join(targetDir, "open-next.config.ts"), openNextConfig);
    console.log("Created open-next.config.ts\n");
}
