import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldProject, type ScaffoldOptions } from "./scaffold.js";

export async function init(options?: ScaffoldOptions & { scaffold?: boolean }): Promise<void> {
    console.log("🚀 Initializing OpenNext Azure project...\n");

    const cwd = process.cwd();

    // Check if this is an empty directory
    const files = await fs.readdir(cwd);
    const isEmpty = files.length === 0 || (files.length === 1 && files[0] === ".git");

    // If empty directory, offer to scaffold a new Next.js project
    if (isEmpty || options?.scaffold) {
        console.log("📂 Empty directory detected.\n");
        const answer = await promptUser("Create new Next.js project with opinionated setup? (Y/n): ");

        if (answer.toLowerCase() !== "n") {
            await scaffoldProject(cwd, options);
        }
    }

    const infraDir = path.join(cwd, "infrastructure");

    try {
        // Check if infrastructure directory already exists
        try {
            await fs.access(infraDir);
            console.log("infrastructure/ directory already exists");
            const answer = await promptUser("Overwrite? (y/N): ");
            if (answer.toLowerCase() !== "y") {
                console.log("Cancelled.");
                return;
            }
        } catch {
            // Directory doesn't exist, continue
        }

        // Create infrastructure directory
        await fs.mkdir(infraDir, { recursive: true });

        // Copy bicep template from package
        const bicepContent = await getBicepTemplate();
        await fs.writeFile(path.join(infraDir, "main.bicep"), bicepContent);

        // Create azure.config.json
        const configContent = getAzureConfigTemplate();
        await fs.writeFile(path.join(cwd, "azure.config.json"), configContent);

        // Update .gitignore if it exists
        try {
            const gitignorePath = path.join(cwd, ".gitignore");
            let gitignore = await fs.readFile(gitignorePath, "utf-8");
            if (!gitignore.includes("azure.config.json")) {
                gitignore += "\n# Azure deployment config (contains resource names)\nazure.config.json\n";
                await fs.writeFile(gitignorePath, gitignore);
            }
        } catch {
            // .gitignore doesn't exist, skip
        }

        console.log("Created infrastructure/main.bicep");
        console.log("Created azure.config.json");
        console.log("\nNext steps:");
        console.log("1. Edit azure.config.json with your app details");
        console.log("2. Optionally customize infrastructure/main.bicep");
        console.log("3. Run: opennextjs-azure build");
        console.log("4. Run: opennextjs-azure deploy\n");
    } catch (error: any) {
        console.error("Initialization failed:", error.message);
        process.exit(1);
    }
}

async function promptUser(question: string): Promise<string> {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        rl.question(question, (answer: string) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function getBicepTemplate(): Promise<string> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const templatePath = path.join(currentDir, "../infrastructure/main.bicep");
    return await fs.readFile(templatePath, "utf-8");
}
function getAzureConfigTemplate(): string {
    return `{
  "$schema": "./node_modules/opennext-azure/azure.config.schema.json",
  "appName": "my-nextjs-app",
  "resourceGroup": "my-nextjs-app-rg",
  "location": "eastus",
  "environment": "dev"
}
`;
}
