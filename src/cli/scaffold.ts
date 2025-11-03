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

    // Patch page.tsx to add Azure branding
    const pagePath = path.join(targetDir, srcDir ? "src/app/page.tsx" : "app/page.tsx");
    let pageContent = await fs.readFile(pagePath, "utf-8");

    pageContent = pageContent.replace(
        /<Image className="dark:invert" src="\/next\.svg" alt="Next\.js logo" width=\{180\} height=\{38\} priority \/>/,
        `<div className="flex items-center gap-4">
                    <Image className="dark:invert" src="/next.svg" alt="Next.js logo" width={180} height={38} priority />
                    <span className="text-2xl text-gray-400 dark:text-gray-600">+</span>
                    <Image src="/azure.png" alt="Azure logo" width={38} height={38} priority />
                </div>`
    );

    pageContent = pageContent.replace(
        /href="https:\/\/vercel\.com\/new[^"]*"/,
        'href="https://github.com/zpg6/opennextjs-azure"'
    );

    pageContent = pageContent.replace(
        /className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background/,
        'className="rounded-full border border-solid border-blue-400 transition-colors flex items-center justify-center bg-blue-500/10'
    );

    pageContent = pageContent.replace(/hover:bg-\[#383838\] dark:hover:bg-\[#ccc\]/, "hover:bg-blue-500/20");

    pageContent = pageContent.replace(
        /<Image className="dark:invert" src="\/vercel\.svg" alt="Vercel logomark" width=\{20\} height=\{20\} \/>/,
        '<Image src="/azure.png" alt="Azure logomark" width={20} height={20} />'
    );

    pageContent = pageContent.replace(/>Deploy now</, ">Deploy to Azure<");

    await fs.writeFile(pagePath, pageContent);

    // Copy Azure logo to public directory
    const publicDir = path.join(targetDir, "public");
    const azureLogoSource = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "../../examples/basic-app/public/azure.png"
    );
    const azureLogoDest = path.join(publicDir, "azure.png");

    try {
        await fs.copyFile(azureLogoSource, azureLogoDest);
    } catch (error) {
        console.warn("Warning: Could not copy Azure logo. You can add it manually to public/azure.png");
    }

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
    imageOptimization: {
        loader: () => import("./node_modules/opennextjs-azure/dist/overrides/imageLoader/azure-blob.js").then(m => m.default),
        override: {
            wrapper: () => import("./node_modules/opennextjs-azure/dist/adapters/wrappers/azure-image-optimization.js").then(m => m.default),
            converter: () => import("./node_modules/opennextjs-azure/dist/adapters/converters/azure-http.js").then(m => m.default),
        },
        install: {
            packages: ["@img/sharp-linux-x64@0.33.5", "sharp@0.33.5"],
            additionalArgs: "--force --ignore-scripts",
        },
    },
    buildOutputPath: ".",
    appPath: ".",
};
`;
    await fs.writeFile(path.join(targetDir, "open-next.config.ts"), openNextConfig);
    console.log("Created open-next.config.ts\n");
}
