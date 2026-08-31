import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { greenCheck } from "./log.js";

const execAsync = promisify(exec);

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

/** Reads the version of a dependency installed in the app's node_modules. */
async function readInstalledVersion(dep: string): Promise<string | null> {
    try {
        const pkgPath = path.join(process.cwd(), "node_modules", dep, "package.json");
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
        return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
        return null;
    }
}

/**
 * Azure Functions run linux-x64, but npm resolves platform-specific optional
 * deps for the dev machine. On a macOS box that ships ~139 MB of binaries
 * that can never execute on Azure. The @next/swc binaries are build-time
 * only and never needed at runtime on any platform.
 */
async function pruneWrongPlatformBinaries(nodeModulesPath: string): Promise<void> {
    const nextScope = path.join(nodeModulesPath, "@next");
    try {
        for (const entry of await fs.readdir(nextScope)) {
            if (entry.startsWith("swc-")) {
                await fs.rm(path.join(nextScope, entry), { recursive: true, force: true });
            }
        }
    } catch {
        // @next scope absent
    }

    const imgScope = path.join(nodeModulesPath, "@img");
    try {
        for (const entry of await fs.readdir(imgScope)) {
            if (!entry.includes("linux-x64") && !entry.includes("wasm")) {
                await fs.rm(path.join(imgScope, entry), { recursive: true, force: true });
            }
        }
    } catch {
        // @img scope absent
    }
}

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
                // Bound per-instance concurrency and queueing so bursts
                // trigger scale-out (the Consumption defaults queue ~200
                // requests on a single 1-core SSR worker) while keeping
                // enough queue to ride out the scale-out delay without
                // shedding 429s.
                maxConcurrentRequests: 16,
                maxOutstandingRequests: 100,
            },
        },
    };

    await fs.writeFile(path.join(functionsDir, "host.json"), JSON.stringify(hostJson, null, 2));

    // Add image optimization function if it exists
    const imageOptDir = path.join(process.cwd(), ".open-next/image-optimization-function");
    try {
        await fs.access(imageOptDir);
        console.log("  Adding image optimization function...");

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

        console.log(`  ${greenCheck()} Image optimization function added`);
    } catch {
        // Image optimization function doesn't exist, skip
    }

    // Add the revalidation queue consumer if OpenNext emitted one. Without
    // it, ISR expiry messages pile up unprocessed and stale pages refresh
    // only via best-effort in-process regeneration.
    const revalidationDir = path.join(process.cwd(), ".open-next/revalidation-function");
    try {
        await fs.access(path.join(revalidationDir, "index.mjs"));
        console.log("  Adding revalidation queue consumer...");

        // Manifest first: if it is missing, the handler must not be copied
        // either, or the entry would register a consumer that fails on
        // every message. The handler reads prerender-manifest.json (for the
        // previewModeId it sends as x-prerender-revalidate) from the cwd.
        await fs.copyFile(
            path.join(revalidationDir, "prerender-manifest.json"),
            path.join(functionsDir, "prerender-manifest.json")
        );
        await fs.copyFile(path.join(revalidationDir, "index.mjs"), path.join(functionsDir, "index-revalidate.mjs"));

        console.log(`  ${greenCheck()} Revalidation queue consumer added`);
    } catch {
        // No revalidation function emitted, skip
    }

    // v4 programming model entry point: registers every function in code.
    // enableHttpStream makes SSR responses stream instead of buffering.
    const hasImage = await exists(path.join(functionsDir, "index-image.mjs"));
    const hasRevalidate = await exists(path.join(functionsDir, "index-revalidate.mjs"));

    const entryLines = [
        `import { app } from "@azure/functions";`,
        `import { handler as server } from "./index.mjs";`,
    ];
    if (hasImage) entryLines.push(`import { handler as image } from "./index-image.mjs";`);
    if (hasRevalidate) entryLines.push(`import { handler as revalidate } from "./index-revalidate.mjs";`);
    entryLines.push(
        ``,
        `app.setup({ enableHttpStream: true });`,
        ``,
        `const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];`,
        ``,
        `// A {*path} catch-all does not match the empty path, so root is separate.`,
        `app.http("root", { methods, authLevel: "anonymous", route: "", handler: server });`,
        `app.http("server", { methods, authLevel: "anonymous", route: "{*path}", handler: server });`
    );
    if (hasImage) {
        entryLines.push(
            `app.http("imageOptimization", { methods: ["GET", "HEAD"], authLevel: "anonymous", route: "_next/image", handler: image });`
        );
    }
    if (hasRevalidate) {
        entryLines.push(
            ``,
            `// %AZURE_QUEUE_NAME% resolves the app setting, so the consumer follows`,
            `// the queue the producer writes to.`,
            `app.storageQueue("revalidate", {`,
            `    queueName: "%AZURE_QUEUE_NAME%",`,
            `    connection: "AZURE_STORAGE_CONNECTION_STRING",`,
            `    handler: revalidate,`,
            `});`
        );
    }
    await fs.writeFile(path.join(functionsDir, "entry.mjs"), entryLines.join("\n") + "\n");

    console.log(`  ${greenCheck()} Azure Functions metadata created`);

    console.log("Installing minimal runtime dependencies...");
    try {
        // Read the app's own package.json: OpenNext 4.x no longer copies one
        // into the bundle.
        const originalPackageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8"));

        // Install all of the app's production dependencies. Server code may
        // import any of them at runtime (ORMs, SDKs). Specs npm can't
        // install inside .open-next (file:/link:/workspace:/portal:/catalog:)
        // are pinned to the version already installed in the app when it's a
        // registry package, and dropped otherwise (local packages are
        // bundled into the server output by the build).
        const runtimeDependencies: Record<string, string> = {};
        for (const [dep, spec] of Object.entries(
            (originalPackageJson.dependencies ?? {}) as Record<string, string>
        )) {
            if (/^(file:|link:|workspace:|portal:|catalog:)/.test(spec)) {
                const installedVersion = await readInstalledVersion(dep);
                if (installedVersion && !spec.startsWith("file:") && !spec.startsWith("link:")) {
                    runtimeDependencies[dep] = installedVersion;
                } else if (/^(workspace:|catalog:)/.test(spec)) {
                    console.warn(`  Skipping "${dep}" (${spec}): not resolvable outside the workspace`);
                }
                continue;
            }
            runtimeDependencies[dep] = spec;
        }
        for (const core of ["next", "react", "react-dom"]) {
            if (!runtimeDependencies[core]) {
                console.warn(
                    `  Warning: "${core}" not found in ${path.join(process.cwd(), "package.json")}; ` +
                        `installing "latest" into the bundle, which may not match the version the app was built with.`
                );
                runtimeDependencies[core] = "latest";
            }
        }

        // The v4 model discovers functions through "main"; @azure/functions
        // must be installed in the bundle for the entry's app registration.
        runtimeDependencies["@azure/functions"] = runtimeDependencies["@azure/functions"] || "^4.8.0";

        const minimalPackageJson = {
            name: originalPackageJson.name || "nextjs-app",
            version: originalPackageJson.version || "1.0.0",
            private: true,
            main: "entry.mjs",
            dependencies: runtimeDependencies,
        };

        await fs.writeFile(path.join(functionsDir, "package.json"), JSON.stringify(minimalPackageJson, null, 2));

        // Remove any existing node_modules (pnpm creates symlinks that conflict with npm)
        const nodeModulesPath = path.join(functionsDir, "node_modules");
        await fs.rm(nodeModulesPath, { recursive: true, force: true });

        // Always use npm for runtime dependencies (pnpm has issues with
        // standalone builds). The platform flags make npm resolve optional
        // deps for the Azure Functions runtime (linux-x64/glibc) instead of
        // the dev machine, for every package with platform-specific builds.
        await execAsync("npm install --omit=dev --no-package-lock --loglevel=error --os=linux --cpu=x64 --libc=glibc", {
            cwd: functionsDir,
        });
        console.log(`  ${greenCheck()} Runtime dependencies installed`);
    } catch (error: any) {
        console.error("Failed to install dependencies:", error.message);
        throw error;
    }

    // Install Sharp with correct Linux x64 binaries for Azure Functions
    const imageOptDir2 = path.join(process.cwd(), ".open-next/image-optimization-function");
    try {
        await fs.access(imageOptDir2);
        console.log("Installing Sharp with Linux x64 binaries for image optimization...");

        await execAsync(
            "npm install --force --no-package-lock --os=linux --cpu=x64 --libc=glibc sharp@0.33.5 @img/sharp-linux-x64@0.33.5 @img/sharp-libvips-linux-x64@1.0.4",
            { cwd: functionsDir }
        );
        console.log(`  ${greenCheck()} Sharp with Linux x64 binaries installed`);
    } catch (error: any) {
        // Image optimization not configured, skip Sharp install
    }

    // Safety net after all installs: drop build-time-only SWC binaries and
    // any wrong-platform sharp binaries the platform flags didn't catch.
    await pruneWrongPlatformBinaries(path.join(functionsDir, "node_modules"));
    await fs.rm(path.join(functionsDir, "package-lock.json"), { force: true });

    // Record which root-level files were actually uploaded to the assets
    // container, so the wrapper redirects only those and leaves
    // server-rendered lookalikes (app/sitemap.ts, hashed metadata images)
    // to the server.
    try {
        const assetsDir = path.join(process.cwd(), ".open-next/assets");
        const rootAssets = (await fs.readdir(assetsDir, { withFileTypes: true }))
            .filter(entry => entry.isFile())
            .map(entry => entry.name);
        await fs.writeFile(path.join(functionsDir, "static-assets.json"), JSON.stringify(rootAssets));
    } catch {
        // No assets dir: the wrapper falls back to pattern matching.
    }
}
