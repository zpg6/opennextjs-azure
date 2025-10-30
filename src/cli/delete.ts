import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { promptForInput } from "../deploy/prompts.js";
import { redX, greenCheck } from "./log.js";

const execAsync = promisify(exec);

const colors = {
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m",
};

export async function deleteResourceGroup(options: {
    resourceGroup?: string;
    yes?: boolean;
    noWait?: boolean;
}): Promise<void> {
    const cwd = process.cwd();

    let resourceGroup = options.resourceGroup;

    if (!resourceGroup) {
        const configPath = path.join(cwd, "azure.config.json");
        try {
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = JSON.parse(configContent);
            resourceGroup = config.resourceGroup;
        } catch {
            console.error(`${redX()} No resource group specified!`);
            console.error("  Provide --resource-group or run from a project with azure.config.json\n");
            process.exit(1);
        }
    }

    if (!resourceGroup) {
        console.error(`${redX()} No resource group specified!`);
        console.error("  Provide --resource-group\n");
        process.exit(1);
    }

    try {
        const { stdout } = await execAsync(
            `az group show --name ${resourceGroup} --query '{Location:location, State:properties.provisioningState}' -o json`
        );
        const rg = JSON.parse(stdout);

        console.log(`\n${colors.yellow}⚠️  WARNING: You are about to delete the resource group:${colors.reset}`);
        console.log(`   Resource Group: ${resourceGroup}`);
        console.log(`   Location: ${rg.Location}`);
        console.log(`   State: ${rg.State}`);
        console.log(`\n${colors.red}This will permanently delete ALL resources in this resource group!${colors.reset}`);
        console.log("   This action cannot be undone.\n");
    } catch {
        console.error(`${redX()} Resource group "${resourceGroup}" not found!\n`);
        process.exit(1);
    }

    if (!options.yes) {
        const confirmation = await promptForInput(
            `Type the resource group name "${resourceGroup}" to confirm deletion: `
        );

        if (confirmation !== resourceGroup) {
            console.log(`\n${redX()} Deletion cancelled. Resource group name did not match.\n`);
            process.exit(0);
        }
    }

    console.log(`\nDeleting resource group "${resourceGroup}"...`);

    if (options.noWait) {
        console.log("Initiating deletion in the background...\n");

        try {
            await execAsync(`az group delete --name ${resourceGroup} --yes --no-wait`);
            console.log(`${greenCheck()} Resource group deletion initiated successfully!`);
            console.log("   Azure is now deleting the resource group in the background.");
            console.log(`\n${colors.yellow}Note:${colors.reset} Deletion typically takes 3-5 minutes to complete.`);
            console.log(`      The resource group name "${resourceGroup}" cannot be reused until deletion finishes.`);
            console.log(`      Run 'az group show --name ${resourceGroup}' to check deletion status.\n`);
        } catch (error: any) {
            console.error(`${redX()} Failed to delete resource group!`);
            console.error(`   ${error.message}\n`);
            process.exit(1);
        }
    } else {
        console.log("This will take a few minutes. Please wait...\n");

        try {
            await execAsync(`az group delete --name ${resourceGroup} --yes`);
            console.log(`${greenCheck()} Resource group "${resourceGroup}" deleted successfully!`);
            console.log("   All resources have been removed.\n");
        } catch (error: any) {
            console.error(`${redX()} Failed to delete resource group!`);
            console.error(`   ${error.message}\n`);
            process.exit(1);
        }
    }
}
