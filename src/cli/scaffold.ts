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
 * - TypeScript, App Router, Tailwind v3, ESLint, src/ directory
 */
export async function scaffoldProject(targetDir: string, options: ScaffoldOptions = {}): Promise<void> {
    console.log("Scaffolding new Next.js project...\n");

    // Opinionated defaults (can be overridden)
    const {
        typescript = true,
        tailwind = true,
        eslint = true,
        srcDir = true,
        appRouter = true,
        importAlias = "@/*",
        packageManager = "pnpm",
    } = options;

    // Build create-next-app command with flags
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

    // Use Next.js 15 (stable) for Tailwind v3 compatibility
    await execAsync(`npx create-next-app@15 ${targetDir} ${flags}`, { cwd: path.dirname(targetDir) });

    console.log("Next.js project created\n");

    // Pin Tailwind to v3 and add prettier
    console.log("Configuring dependencies...");

    const packageJsonPath = path.join(targetDir, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

    // Remove Tailwind v4 packages and pin to v3
    delete packageJson.devDependencies["@tailwindcss/postcss"];

    packageJson.devDependencies = {
        ...packageJson.devDependencies,
        tailwindcss: "^3.4.0",
        autoprefixer: "^10.4.0",
        postcss: "^8.4.0",
        prettier: "^3.2.0",
        "prettier-plugin-tailwindcss": "^0.5.0",
    };

    // Update scripts to use webpack (not turbopack)
    packageJson.scripts = {
        ...packageJson.scripts,
        dev: "next dev",
        build: "next build",
    };

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Add prettier config (from opennextjs-azure repo)
    const prettierConfig = {
        tabWidth: 4,
        printWidth: 120,
        semi: true,
        singleQuote: false,
        trailingComma: "es5",
        bracketSpacing: true,
        arrowParens: "avoid",
        plugins: ["prettier-plugin-tailwindcss"],
    };

    await fs.writeFile(path.join(targetDir, ".prettierrc"), JSON.stringify(prettierConfig, null, 2));

    // Update next.config to use standalone output and disable Turbopack
    const nextConfigPath = path.join(targetDir, "next.config.ts");
    const nextConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
`;
    await fs.writeFile(nextConfigPath, nextConfig);

    // Update postcss.config for Tailwind v3
    const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
    await fs.writeFile(path.join(targetDir, "postcss.config.mjs"), postcssConfig);

    // Update tailwind.config to have proper content paths
    const tailwindConfig = `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
`;
    await fs.writeFile(path.join(targetDir, "tailwind.config.ts"), tailwindConfig);

    // Update globals.css with proper Tailwind v3 directives
    const globalsCssPath = path.join(targetDir, srcDir ? "src/app/globals.css" : "app/globals.css");
    if (tailwind) {
        // Replace Tailwind v4 syntax with v3
        const globalsCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
        await fs.writeFile(globalsCssPath, globalsCss);
    } else {
        // Remove all Tailwind directives if disabled
        try {
            let globalsCss = await fs.readFile(globalsCssPath, "utf-8");
            globalsCss = globalsCss.replace(/@import\s+"tailwindcss";?/g, "").replace(/@tailwind[^;]*;/g, "");
            await fs.writeFile(globalsCssPath, globalsCss.trim() || "/* Global styles */\n");
        } catch {
            // Ignore if file doesn't exist
        }
    }

    console.log("Dependencies configured\n");
    console.log("Installing dependencies...");

    // Delete lockfile and reinstall since we modified package.json
    await fs.unlink(path.join(targetDir, "pnpm-lock.yaml")).catch(() => {});
    await execAsync("pnpm install", { cwd: targetDir });

    console.log("Dependencies installed\n");
}
