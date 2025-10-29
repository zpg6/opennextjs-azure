import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

const colors = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m",
};

interface DeployOptions {
    appName: string;
    resourceGroup?: string;
    location?: string;
    environment?: "dev" | "staging" | "prod";
    skipInfrastructure?: boolean;
    applicationInsights?: boolean;
}

export async function deploy(options: DeployOptions): Promise<void> {
    const {
        appName,
        resourceGroup = `${appName}-rg`,
        location = "eastus",
        environment = "dev",
        skipInfrastructure = false,
    } = options;

    console.log(`Deploying ${appName} to Azure (${environment} environment)\n`);

    try {
        // Preflight checks
        await checkAzureCLI();
        await checkAzureLogin();
        await checkAzureSubscriptionPermissions();
        await checkLocation(location);
        await checkRequiredProviders(options.applicationInsights);
        await checkQuotaAvailability(location, environment);
        await checkBuildOutput();

        // Check existing infrastructure if skipping provisioning
        if (skipInfrastructure) {
            await checkExistingInfrastructure(appName, resourceGroup, environment);
        }

        // Step 1: Provision infrastructure (or skip if updating app only)
        let deploymentOutputs;
        if (!skipInfrastructure) {
            // Sync bicep template from package (ensures infrastructure matches package version)
            await syncBicepTemplate();

            console.log("Provisioning Azure infrastructure...");
            console.log(`  Resource Group: ${resourceGroup}`);
            console.log(`  Location: ${location}`);
            console.log(`  Environment: ${environment}\n`);

            deploymentOutputs = await provisionInfrastructure({
                appName,
                resourceGroup,
                location,
                environment,
                applicationInsights: options.applicationInsights ?? false,
            });
            console.log(`${colors.green}✓${colors.reset} Infrastructure ready\n`);
        } else {
            console.log("Skipping infrastructure provisioning\n");
        }

        // Step 2: Upload static assets to Blob Storage
        console.log("Uploading static assets...");
        await uploadStaticAssets(appName, resourceGroup);
        console.log(`${colors.green}✓${colors.reset} Assets uploaded\n`);

        // Step 3: Deploy Function App
        console.log("Deploying Function App...");
        const functionAppName = deploymentOutputs?.functionApp || `${appName}-func-${environment}`;
        await deployFunctionApp(functionAppName, resourceGroup);
        console.log(`${colors.green}✓${colors.reset} Function App deployed\n`);

        // Step 4: Postflight checks and display detailed info
        await performPostflightChecks(
            resourceGroup,
            functionAppName,
            location,
            environment,
            options.applicationInsights
        );
    } catch (error: any) {
        console.error(`\n${colors.red}✗${colors.reset} Deployment failed: ${error.message}`);
        process.exit(1);
    }
}

async function checkAzureCLI(): Promise<void> {
    try {
        await execAsync("az --version");
    } catch {
        throw new Error("Azure CLI not found. Install it from: https://docs.microsoft.com/cli/azure/install-azure-cli");
    }
}

async function checkAzureLogin(): Promise<void> {
    try {
        await execAsync("az account show");
    } catch {
        console.log("Not logged in to Azure. Running 'az login'...");
        await execAsync("az login");
    }
}

async function checkRequiredProviders(applicationInsights?: boolean): Promise<void> {
    const requiredProviders = ["Microsoft.Web", "Microsoft.Storage", "Microsoft.Compute", "Microsoft.Quota"];

    if (applicationInsights) {
        requiredProviders.push("Microsoft.AlertsManagement");
    }

    console.log("Checking Azure resource providers...");

    for (const provider of requiredProviders) {
        const { stdout } = await execAsync(
            `az provider show --namespace ${provider} --query "registrationState" -o tsv`
        );
        const state = stdout.trim();

        if (state !== "Registered") {
            console.log(`  Registering ${provider}...`);
            await execAsync(`az provider register --namespace ${provider} --wait`);
            console.log(`  ${colors.green}✓${colors.reset} ${provider} registered`);
        }
    }
}

async function checkQuotaAvailability(location: string, environment: string): Promise<void> {
    console.log("Checking Azure quota availability...");

    try {
        const { stdout: subscriptionId } = await execAsync("az account show --query id -o tsv");
        const subId = subscriptionId.trim();

        const { stdout: quotaJson } = await execAsync(
            `az rest --method get --url "https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Web/locations/${location}/providers/Microsoft.Quota/quotas?api-version=2023-02-01"`
        );

        const quotaData = JSON.parse(quotaJson);
        const quotas = quotaData.value || [];

        const y1Quota = quotas.find((q: any) => q.name === "Y1" || q.name?.value === "Y1");
        const ep1Quota = quotas.find((q: any) => q.name === "EP1" || q.name?.value === "EP1");

        const y1Limit = y1Quota?.properties?.limit?.value || 0;
        const ep1Limit = ep1Quota?.properties?.limit?.value || 0;

        const skuMap: Record<string, { name: string; quota: number; type: string }> = {
            dev: { name: "Y1 (Consumption)", quota: y1Limit, type: "Dynamic" },
            staging: { name: "EP1 (Elastic Premium)", quota: ep1Limit, type: "ElasticPremium" },
            prod: { name: "EP1 (Elastic Premium)", quota: ep1Limit, type: "ElasticPremium" },
        };

        const requiredSku = skuMap[environment];

        if (requiredSku.quota === 0) {
            console.error(
                `\n${colors.red}✗${colors.reset} Quota Error: No quota available for ${environment} environment`
            );
            console.error(`  Required: ${requiredSku.name}`);
            console.error(`  Current Limit: ${requiredSku.quota}\n`);

            if (y1Limit > 0 && environment !== "dev") {
                console.log(`  Suggestion: Deploy to dev environment instead (has quota: ${y1Limit})`);
                console.log(`  Command: opennextjs-azure deploy --environment dev\n`);
            } else if (ep1Limit > 0 && environment === "dev") {
                console.log(`  Suggestion: Deploy to prod environment instead (has quota: ${ep1Limit})`);
                console.log(`  Command: opennextjs-azure deploy --environment prod\n`);
            } else {
                console.log(`  To request quota increase:`);
                console.log(
                    `  1. Visit: https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas`
                );
                console.log(
                    `  2. Or run: az rest --method put --url "https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Web/locations/${location}/providers/Microsoft.Quota/quotas/${requiredSku.name.split(" ")[0]}?api-version=2023-02-01" --body '{"properties":{"limit":{"value":10}}}'`
                );
                console.log();
            }

            throw new Error(`No ${requiredSku.type} quota available for ${environment} environment in ${location}`);
        }

        console.log(`  ${colors.green}✓${colors.reset} ${requiredSku.name}: ${requiredSku.quota} instances available`);

        if (environment === "dev" && ep1Limit > 0) {
            console.log(
                `  Premium tier also available (${ep1Limit} instances) - use --environment prod for better performance`
            );
        } else if (environment !== "dev" && y1Limit > 0) {
            console.log(`  Consumption tier available (${y1Limit} instances) - use --environment dev for lower cost`);
        }
    } catch (error: any) {
        if (error.message?.includes("No") && error.message?.includes("quota available")) {
            throw error;
        }
        console.warn(
            `  ${colors.yellow}Warning:${colors.reset} Could not verify quota (continuing anyway): ${error.message}`
        );
    }
}

async function checkAzureSubscriptionPermissions(): Promise<void> {
    console.log("Checking Azure subscription permissions...");

    try {
        const { stdout } = await execAsync("az account show --query '{Name:name, Id:id, State:state}' -o json");
        const account = JSON.parse(stdout);

        if (account.State !== "Enabled") {
            throw new Error(`Subscription "${account.Name}" is not enabled (state: ${account.State})`);
        }

        console.log(`  ${colors.green}✓${colors.reset} Subscription: ${account.Name} (${account.State})`);
    } catch (error: any) {
        throw new Error(`Failed to verify subscription permissions: ${error.message}`);
    }
}

async function checkLocation(location: string): Promise<void> {
    console.log("Validating Azure region...");

    try {
        const { stdout } = await execAsync(
            `az account list-locations --query "[?name=='${location}'].{Name:name, DisplayName:displayName}" -o json`
        );
        const locations = JSON.parse(stdout);

        if (locations.length === 0) {
            const { stdout: available } = await execAsync(
                "az account list-locations --query \"[?metadata.regionCategory=='Recommended'].name\" -o tsv"
            );
            throw new Error(
                `Invalid location: ${location}\nAvailable regions: ${available.trim().split("\n").slice(0, 10).join(", ")}`
            );
        }

        console.log(`  ${colors.green}✓${colors.reset} Region: ${locations[0].DisplayName} (${location})`);
    } catch (error: any) {
        if (error.message.includes("Invalid location")) {
            throw error;
        }
        console.warn(
            `  ${colors.yellow}Warning:${colors.reset} Could not validate location (continuing anyway): ${error.message}`
        );
    }
}

async function checkBuildOutput(): Promise<void> {
    console.log("Validating build output...");

    const openNextPath = path.join(process.cwd(), ".open-next");
    const requiredPaths = ["assets", "server-functions/default"];

    try {
        await fs.access(openNextPath);
    } catch {
        throw new Error("Build not found. Run 'opennextjs-azure build' first\n" + "Expected directory: .open-next/");
    }

    for (const requiredPath of requiredPaths) {
        const fullPath = path.join(openNextPath, requiredPath);
        try {
            await fs.access(fullPath);
        } catch {
            throw new Error(
                `Invalid build output: Missing ${requiredPath}\n` + "Run 'opennextjs-azure build' to regenerate"
            );
        }
    }

    console.log(`  ${colors.green}✓${colors.reset} Build output structure valid`);
}

async function checkExistingInfrastructure(appName: string, resourceGroup: string, environment: string): Promise<void> {
    console.log("Checking existing infrastructure...");

    const functionAppName = `${appName}-func-${environment}`;
    const errors: string[] = [];

    try {
        const { stdout: rgExists } = await execAsync(`az group exists --name ${resourceGroup}`);
        if (rgExists.trim() !== "true") {
            errors.push(`Resource group "${resourceGroup}" does not exist`);
        }
    } catch {
        errors.push(`Resource group "${resourceGroup}" does not exist`);
    }

    try {
        await execAsync(`az storage account list --resource-group ${resourceGroup} --query "[0].name" -o tsv`);
    } catch {
        errors.push("Storage account not found in resource group");
    }

    try {
        await execAsync(
            `az functionapp show --resource-group ${resourceGroup} --name ${functionAppName} --query "name" -o tsv`
        );
    } catch {
        errors.push(`Function app "${functionAppName}" does not exist`);
    }

    if (errors.length > 0) {
        throw new Error(
            "Cannot skip infrastructure provisioning - required resources missing:\n" +
                errors.map(e => `   • ${e}`).join("\n") +
                "\n\nRun without --skip-infrastructure to provision resources first."
        );
    }

    console.log(`  ${colors.green}✓${colors.reset} All required infrastructure exists`);
}

async function performPostflightChecks(
    resourceGroup: string,
    functionAppName: string,
    location: string,
    environment: string,
    applicationInsights?: boolean
): Promise<void> {
    console.log("Performing post-deployment verification...\n");

    try {
        const { stdout: subIdStdout } = await execAsync("az account show --query id -o tsv");
        const subscriptionId = subIdStdout.trim();

        const { stdout: funcStdout } = await execAsync(
            `az functionapp show --resource-group ${resourceGroup} --name ${functionAppName} --query "{State:state, DefaultHostName:defaultHostName, Kind:kind, OutboundIpAddresses:outboundIpAddresses}" -o json`
        );
        const funcApp = JSON.parse(funcStdout);

        const { stdout: storageStdout } = await execAsync(
            `az storage account list --resource-group ${resourceGroup} --query "[0].{Name:name, Location:location, Sku:sku.name, Kind:kind}" -o json`
        );
        const storage = JSON.parse(storageStdout);

        const { stdout: planStdout } = await execAsync(
            `az appservice plan show --resource-group ${resourceGroup} --name ${functionAppName.replace("-func-", "-plan-")} --query "{Sku:sku.name, Tier:sku.tier, Capacity:sku.capacity}" -o json`
        );
        const plan = JSON.parse(planStdout);

        const functionUrl = `https://${funcApp.DefaultHostName}`;
        const assetsUrl = `https://${storage.Name}.blob.core.windows.net/assets`;
        const portalUrl = `https://portal.azure.com/#@/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;

        console.log("═══════════════════════════════════════════════");
        console.log(`${colors.green}✓${colors.reset} Deployment Complete!`);
        console.log("═══════════════════════════════════════════════");
        console.log("\nApplication:");
        console.log(`  App URL:          ${functionUrl}`);
        console.log(`  Assets URL:       ${assetsUrl}`);
        console.log(`  Status:           ${funcApp.State}`);
        console.log(`  Type:             ${funcApp.Kind}`);

        console.log("\nInfrastructure:");
        console.log(`  Resource Group:   ${resourceGroup}`);
        console.log(`  Region:           ${location}`);
        console.log(`  Environment:      ${environment}`);

        console.log("\nConfiguration:");
        console.log(`  App Service Plan: ${plan.Tier} (${plan.Sku})`);
        console.log(`  Storage Account:  ${storage.Name} (${storage.Sku})`);
        console.log(`  Capacity:         ${plan.Capacity || 1} instance(s)`);

        if (applicationInsights) {
            try {
                const { stdout: insightsStdout } = await execAsync(
                    `az monitor app-insights component show --app ${functionAppName.replace("-func-", "-insights-")} --resource-group ${resourceGroup} --query "{Name:name, InstrumentationKey:instrumentationKey}" -o json`
                );
                const insights = JSON.parse(insightsStdout);
                console.log(`  App Insights:     ${insights.Name}`);
            } catch {
                // App Insights info optional
            }
        }

        console.log("\nQuick Actions:");
        console.log(
            `  View logs:        az functionapp log tail --name ${functionAppName} --resource-group ${resourceGroup}`
        );
        console.log(`  Open in portal:   ${portalUrl}`);
        console.log("═══════════════════════════════════════════════\n");

        if (funcApp.State !== "Running") {
            console.warn(
                `${colors.yellow}Warning:${colors.reset} Function App state is "${funcApp.State}" (expected "Running")`
            );
            console.warn("  It may take a few minutes for the app to start.\n");
        }
    } catch (error: any) {
        console.warn(
            `${colors.yellow}Warning:${colors.reset} Could not retrieve all deployment details: ${error.message}`
        );
        console.log(`\n${colors.green}✓${colors.reset} Deployment completed, but some post-flight checks failed.`);
        console.log(`  View resources: az resource list --resource-group ${resourceGroup} -o table\n`);
    }
}

async function syncBicepTemplate(): Promise<void> {
    // Sync infrastructure/main.bicep from package to ensure it matches this version
    const { fileURLToPath } = await import("node:url");
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageBicepPath = path.join(currentDir, "../infrastructure/main.bicep");
    const projectBicepPath = path.join(process.cwd(), "infrastructure/main.bicep");

    const bicepContent = await fs.readFile(packageBicepPath, "utf-8");
    await fs.mkdir(path.dirname(projectBicepPath), { recursive: true });
    await fs.writeFile(projectBicepPath, bicepContent);
}

async function provisionInfrastructure(options: {
    appName: string;
    resourceGroup: string;
    location: string;
    environment: string;
    applicationInsights?: boolean;
}): Promise<any> {
    const { appName, resourceGroup, location, environment, applicationInsights } = options;

    // Create resource group
    await execAsync(`az group create --name ${resourceGroup} --location ${location}`);

    // Deploy Bicep template from project root
    const bicepPath = path.join(process.cwd(), "infrastructure/main.bicep");

    const enableAppInsights = applicationInsights ? "true" : "false";
    const { stdout } = await execAsync(
        `az deployment group create \
      --resource-group ${resourceGroup} \
      --template-file ${bicepPath} \
      --parameters appName=${appName} environment=${environment} enableApplicationInsights=${enableAppInsights} \
      --query 'properties.outputs.deploymentInfo.value' \
      --output json`
    );

    return JSON.parse(stdout);
}

async function uploadStaticAssets(appName: string, resourceGroup: string): Promise<void> {
    const assetsPath = path.join(process.cwd(), ".open-next/assets");

    // Get storage account name
    const { stdout } = await execAsync(
        `az storage account list --resource-group ${resourceGroup} --query "[0].name" -o tsv`
    );
    const storageAccountName = stdout.trim();

    // Upload to blob storage
    await execAsync(
        `az storage blob upload-batch \
      --account-name ${storageAccountName} \
      --destination assets \
      --source ${assetsPath} \
      --overwrite`
    );
}

async function deployFunctionApp(functionAppName: string, resourceGroup: string): Promise<void> {
    const functionsPath = path.join(process.cwd(), ".open-next/server-functions/default");

    // Create zip of function app
    const zipPath = path.join(process.cwd(), ".open-next/function-app.zip");
    await execAsync(`cd ${functionsPath} && zip -r ${zipPath} . -q`, {
        maxBuffer: 100 * 1024 * 1024,
    });

    // Deploy zip to function app
    await execAsync(
        `az functionapp deployment source config-zip \
      --resource-group ${resourceGroup} \
      --name ${functionAppName} \
      --src ${zipPath}`,
        {
            maxBuffer: 100 * 1024 * 1024,
        }
    );

    // Clean up zip
    await fs.unlink(zipPath);
}
