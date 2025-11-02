import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { greenCheck } from "./log.js";

const execAsync = promisify(exec);

/**
 * Prepares the .open-next build output for Azure Functions deployment
 * by adding required Azure Functions metadata files (host.json, function.json)
 * and installing production dependencies
 */
export async function prepareFunctions(): Promise<void> {
    const functionsDir = path.join(process.cwd(), ".open-next/server-functions/default");

    try {
        await fs.access(functionsDir);
    } catch {
        throw new Error(".open-next/server-functions/default not found. Run 'opennextjs-azure build' first.");
    }

    console.log("Preparing Azure Functions metadata...");

    // Create host.json - configures the Functions host
    const hostJson = {
        version: "2.0",
        logging: {
            applicationInsights: {
                samplingSettings: {
                    isEnabled: true,
                    maxTelemetryItemsPerSecond: 5,
                },
            },
        },
        extensionBundle: {
            id: "Microsoft.Azure.Functions.ExtensionBundle",
            version: "[4.*, 5.0.0)",
        },
        extensions: {
            http: {
                routePrefix: "",
            },
        },
    };

    await fs.writeFile(path.join(functionsDir, "host.json"), JSON.stringify(hostJson, null, 2));

    // Create root path handler (/)
    const rootDir = path.join(functionsDir, "root");
    await fs.mkdir(rootDir, { recursive: true });

    const rootFunctionJson = {
        bindings: [
            {
                authLevel: "anonymous",
                type: "httpTrigger",
                direction: "in",
                name: "req",
                methods: ["get", "post", "put", "delete", "patch", "head", "options"],
                route: "",
            },
            {
                type: "http",
                direction: "out",
                name: "res",
            },
        ],
        scriptFile: "../index.mjs",
        entryPoint: "handler",
    };

    await fs.writeFile(path.join(rootDir, "function.json"), JSON.stringify(rootFunctionJson, null, 2));

    // Create catch-all handler for all other paths
    const functionDir = path.join(functionsDir, "server");
    await fs.mkdir(functionDir, { recursive: true });

    const functionJson = {
        bindings: [
            {
                authLevel: "anonymous",
                type: "httpTrigger",
                direction: "in",
                name: "req",
                methods: ["get", "post", "put", "delete", "patch", "head", "options"],
                route: "{*path}",
            },
            {
                type: "http",
                direction: "out",
                name: "res",
            },
        ],
        scriptFile: "../index.mjs",
        entryPoint: "handler",
    };

    await fs.writeFile(path.join(functionDir, "function.json"), JSON.stringify(functionJson, null, 2));

    // Add image optimization function if it exists
    const imageOptDir = path.join(process.cwd(), ".open-next/image-optimization-function");
    try {
        await fs.access(imageOptDir);
        console.log("  Adding image optimization function...");

        // Create image-optimization directory in the Functions app
        const imageFunctionDir = path.join(functionsDir, "image-optimization");
        await fs.mkdir(imageFunctionDir, { recursive: true });

        // Create function.json for image optimization route
        const imageFunctionJson = {
            bindings: [
                {
                    authLevel: "anonymous",
                    type: "httpTrigger",
                    direction: "in",
                    name: "req",
                    methods: ["get", "head"],
                    route: "_next/image",
                },
                {
                    type: "http",
                    direction: "out",
                    name: "res",
                },
            ],
            scriptFile: "../index-image.mjs",
            entryPoint: "handler",
        };

        await fs.writeFile(path.join(imageFunctionDir, "function.json"), JSON.stringify(imageFunctionJson, null, 2));

        // Copy the image optimization handler as index-image.mjs
        await fs.copyFile(path.join(imageOptDir, "index.mjs"), path.join(functionsDir, "index-image.mjs"));

        // Copy .next directory for image optimization
        await fs.cp(path.join(imageOptDir, ".next"), path.join(functionsDir, ".next"), {
            recursive: true,
            force: false,
        });

        // Copy open-next.config.mjs if it exists
        try {
            await fs.copyFile(
                path.join(imageOptDir, "open-next.config.mjs"),
                path.join(functionsDir, "open-next.config.mjs")
            );
        } catch {
            // File doesn't exist, that's ok
        }

        console.log("  ✓ Image optimization function added");
    } catch {
        // Image optimization function doesn't exist, skip
    }

    console.log(`  ${greenCheck()} Azure Functions metadata created\n`);

    console.log("Installing minimal runtime dependencies...");
    try {
        const originalPackageJson = JSON.parse(await fs.readFile(path.join(functionsDir, "package.json"), "utf-8"));

        const minimalPackageJson = {
            name: originalPackageJson.name || "nextjs-app",
            version: originalPackageJson.version || "1.0.0",
            private: true,
            dependencies: {
                next: originalPackageJson.dependencies?.next || "latest",
                react: originalPackageJson.dependencies?.react || "latest",
                "react-dom": originalPackageJson.dependencies?.["react-dom"] || "latest",
            },
        };

        await fs.writeFile(path.join(functionsDir, "package.json"), JSON.stringify(minimalPackageJson, null, 2));

        // Remove any existing node_modules (pnpm creates symlinks that conflict with npm)
        const nodeModulesPath = path.join(functionsDir, "node_modules");
        await fs.rm(nodeModulesPath, { recursive: true, force: true });

        // Always use npm for runtime dependencies (pnpm has issues with standalone builds)
        await execAsync("npm install --production --no-package-lock --loglevel=error", {
            cwd: functionsDir,
        });
        console.log(`  ${greenCheck()} Runtime dependencies installed\n`);
    } catch (error: any) {
        console.error("Failed to install dependencies:", error.message);
        throw error;
    }

    // Install Sharp with correct Linux x64 binaries for Azure Functions
    const imageOptDir2 = path.join(process.cwd(), ".open-next/image-optimization-function");
    try {
        await fs.access(imageOptDir2);
        console.log("\nInstalling Sharp with Linux x64 binaries for image optimization...");

        await execAsync(
            "npm install --force sharp@0.33.5 @img/sharp-linux-x64@0.33.5 @img/sharp-libvips-linux-x64@1.0.4",
            { cwd: functionsDir }
        );
        console.log(`  ${greenCheck()} Sharp with Linux x64 binaries installed\n`);
    } catch (error: any) {
        // Image optimization not configured, skip Sharp install
    }
}
