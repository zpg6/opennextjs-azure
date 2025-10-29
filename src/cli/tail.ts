import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

/*
 * Open Azure Portal Log Stream in browser (live logs)
 */
export async function tail(options?: { appName?: string; resourceGroup?: string }): Promise<void> {
    const cwd = process.cwd();

    // Load config if it exists
    const configPath = path.join(cwd, "azure.config.json");
    let config: any = {};
    try {
        const configContent = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(configContent);
    } catch {
        console.warn("⚠️  azure.config.json not found.");
        console.warn("    Provide --app-name and --resource-group or run from a project directory.\n");
    }

    const appName = options?.appName || config.appName;
    const resourceGroup = options?.resourceGroup || config.resourceGroup;
    const environment = config.environment || "dev";

    if (!appName || !resourceGroup) {
        console.error("❌ Missing required information!");
        console.error("   Provide --app-name and --resource-group or run from a project with azure.config.json\n");
        process.exit(1);
    }

    const functionAppName = `${appName}-func-${environment}`;

    console.log(`📡 Opening Azure Portal Log Stream for ${functionAppName}...\n`);

    try {
        // Get Azure account info
        const { stdout } = await execAsync("az account show --query '{tenant:tenantId, subscription:id}' -o json");
        const account = JSON.parse(stdout);

        // Build the Portal URL
        const portalUrl = `https://portal.azure.com/#@${account.tenant}/resource/subscriptions/${account.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${functionAppName}/logStream`;

        console.log(`🌐 Opening: ${portalUrl}\n`);

        // Open in default browser (cross-platform)
        const openCommand =
            process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

        await execAsync(`${openCommand} "${portalUrl}"`);

        console.log("✓ Log Stream page opened in your browser!");
        console.log("\nTip: Enable Application Insights in azure.config.json for better log filtering.\n");
    } catch (error: any) {
        console.error(`\n❌ Failed to open log stream: ${error.message}`);
        process.exit(1);
    }
}
