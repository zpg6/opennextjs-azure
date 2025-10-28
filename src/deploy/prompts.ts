import { exec } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";

const execAsync = promisify(exec);

export async function promptForInput(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

export async function selectResourceGroup(): Promise<{ name: string; isNew: boolean; location?: string }> {
    console.log("🔍 Fetching your Azure resource groups...\n");

    try {
        const { stdout } = await execAsync("az group list --query '[].{name:name, location:location}' -o json");
        const groups = JSON.parse(stdout);

        if (groups.length === 0) {
            console.log("No existing resource groups found.\n");
            return await createNewResourceGroup();
        }

        console.log("📁 Existing Resource Groups:");
        groups.forEach((group: any, index: number) => {
            console.log(`   ${index + 1}. ${group.name} (${group.location})`);
        });
        console.log(`   ${groups.length + 1}. Create new resource group\n`);

        const choice = await promptForInput("Select a resource group (number): ");
        const choiceNum = parseInt(choice, 10);

        if (choiceNum >= 1 && choiceNum <= groups.length) {
            const selected = groups[choiceNum - 1];
            console.log(`✅ Selected: ${selected.name}\n`);
            return { name: selected.name, isNew: false };
        } else if (choiceNum === groups.length + 1) {
            return await createNewResourceGroup();
        } else {
            console.log("Invalid choice. Please try again.\n");
            return await selectResourceGroup();
        }
    } catch (error: any) {
        console.error("Failed to fetch resource groups:", error.message);
        throw error;
    }
}

async function createNewResourceGroup(): Promise<{ name: string; isNew: boolean; location?: string }> {
    const name = await promptForInput("Resource group name: ");
    const location = await promptForInput("Location (e.g., eastus, westus2) [eastus]: ");

    const finalLocation = location || "eastus";
    console.log(`\n✨ Will create new resource group: ${name} in ${finalLocation}\n`);

    return {
        name,
        isNew: true,
        location: finalLocation,
    };
}

export async function selectLocation(): Promise<string> {
    const defaultLocation = "eastus";
    const location = await promptForInput(`Azure region [${defaultLocation}]: `);
    return location || defaultLocation;
}

export async function selectEnvironment(): Promise<"dev" | "staging" | "prod"> {
    console.log("\n🌍 Environment:");
    console.log("   1. dev (Consumption plan, ~$5-20/month)");
    console.log("   2. staging (Consumption plan)");
    console.log("   3. prod (Premium plan, always warm, ~$70-150/month)\n");

    const choice = await promptForInput("Select environment [1]: ");
    const envMap: Record<string, "dev" | "staging" | "prod"> = {
        "1": "dev",
        "2": "staging",
        "3": "prod",
    };

    return envMap[choice] || "dev";
}
