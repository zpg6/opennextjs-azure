import { deploy as deployToAzure } from "../deploy/index.js";
import { selectResourceGroup, selectEnvironment } from "../deploy/prompts.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function deploy(options: {
    appName?: string;
    resourceGroup?: string;
    location?: string;
    environment?: "dev" | "staging" | "prod";
    skipInfrastructure?: boolean;
}): Promise<void> {
    const cwd = process.cwd();

    // Load config if it exists
    const configPath = path.join(cwd, "azure.config.json");
    let config: any = {};
    try {
        const configContent = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(configContent);
    } catch {
        console.warn("⚠️  azure.config.json not found.");
        console.warn("    Run 'opennextjs-azure init' to create project structure.\n");
    }

    // Verify bicep exists
    const bicepPath = path.join(cwd, "infrastructure/main.bicep");
    try {
        await fs.access(bicepPath);
    } catch {
        console.error("❌ infrastructure/main.bicep not found!");
        console.error("   Run 'opennextjs-azure init' to create it.\n");
        process.exit(1);
    }

    // Interactive mode if no resource group specified
    let resourceGroup = options.resourceGroup || config.resourceGroup;
    let resourceGroupLocation: string | undefined;

    if (!resourceGroup) {
        const result = await selectResourceGroup();
        resourceGroup = result.name;

        if (result.isNew) {
            resourceGroupLocation = result.location;
        } else {
            // Get location from existing resource group
            resourceGroupLocation = await getResourceGroupLocation(resourceGroup);
        }
    }

    // Interactive environment selection if not specified
    const environment = options.environment || config.environment || (await selectEnvironment());

    await deployToAzure({
        appName: options.appName || config.appName || path.basename(cwd),
        resourceGroup: resourceGroup!,
        location: resourceGroupLocation || options.location || config.location || "eastus",
        environment,
        skipInfrastructure: options.skipInfrastructure,
    });
}

async function getResourceGroupLocation(resourceGroup: string): Promise<string> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    try {
        const { stdout } = await execAsync(`az group show --name ${resourceGroup} --query location -o tsv`);
        return stdout.trim();
    } catch {
        return "eastus";
    }
}
