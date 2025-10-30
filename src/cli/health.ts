import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { greenCheck, redX } from "./log.js";

const execAsync = promisify(exec);

const colors = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    reset: "\x1b[0m",
};

interface HealthCheckResult {
    passed: boolean;
    message: string;
    details?: string;
}

export async function health(options?: { appName?: string; resourceGroup?: string }): Promise<void> {
    const cwd = process.cwd();

    console.log("Running health checks for Azure deployment...\n");

    // Load config if it exists
    const configPath = path.join(cwd, "azure.config.json");
    let config: any = {};
    try {
        const configContent = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(configContent);
    } catch {
        console.warn(`${colors.yellow}Warning:${colors.reset} azure.config.json not found.`);
        console.warn("         Provide --app-name and --resource-group or run from a project directory.\n");
    }

    const appName = options?.appName || config.appName;
    const resourceGroup = options?.resourceGroup || config.resourceGroup;
    const environment = config.environment || "dev";

    if (!appName || !resourceGroup) {
        console.error(`${redX()} Missing required information!`);
        console.error("  Provide --app-name and --resource-group or run from a project with azure.config.json\n");
        process.exit(1);
    }

    const checks: { name: string; fn: () => Promise<HealthCheckResult> }[] = [
        { name: "Azure CLI", fn: () => checkAzureCLI() },
        { name: "Azure Authentication", fn: () => checkAzureAuth() },
        { name: "Resource Group", fn: () => checkResourceGroup(resourceGroup) },
        { name: "Storage Account", fn: () => checkStorageAccount(appName, resourceGroup, environment) },
        { name: "Function App", fn: () => checkFunctionApp(appName, resourceGroup, environment) },
        { name: "App Service Plan", fn: () => checkAppServicePlan(appName, resourceGroup, environment) },
        { name: "Function App Status", fn: () => checkFunctionAppStatus(appName, resourceGroup, environment) },
        { name: "Storage Containers", fn: () => checkStorageContainers(resourceGroup) },
        { name: "Function App Configuration", fn: () => checkFunctionAppConfig(appName, resourceGroup, environment) },
    ];

    if (config.applicationInsights) {
        checks.push({
            name: "Application Insights",
            fn: () => checkApplicationInsights(appName, resourceGroup, environment),
        });
    }

    let passedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const check of checks) {
        try {
            const result = await check.fn();
            if (result.passed) {
                console.log(`${greenCheck()} ${check.name}`);
                if (result.details) {
                    console.log(`  ${result.details}`);
                }
                passedCount++;
            } else {
                console.log(`${redX()} ${check.name}`);
                console.log(`  ${result.message}`);
                if (result.details) {
                    console.log(`  ${result.details}`);
                }
                failedCount++;
                errors.push(`${check.name}: ${result.message}`);
            }
        } catch (error: any) {
            console.log(`${redX()} ${check.name}`);
            console.log(`  ${error.message}`);
            failedCount++;
            errors.push(`${check.name}: ${error.message}`);
        }
    }

    console.log("\n═══════════════════════════════════════════════");
    if (failedCount === 0) {
        console.log(`${colors.green}All checks passed!${colors.reset}`);
        console.log(`  ${passedCount}/${checks.length} checks successful`);
    } else {
        console.log(`${colors.yellow}Some checks failed${colors.reset}`);
        console.log(`  ${passedCount}/${checks.length} checks passed`);
        console.log(`  ${failedCount}/${checks.length} checks failed`);
    }
    console.log("═══════════════════════════════════════════════\n");

    if (failedCount > 0) {
        console.log("Issues detected:");
        errors.forEach(error => console.log(`  • ${error}`));
        console.log("\nRun 'opennextjs-azure deploy' to provision or repair infrastructure.\n");
        process.exit(1);
    }
}

async function checkAzureCLI(): Promise<HealthCheckResult> {
    try {
        const { stdout } = await execAsync("az --version");
        const versionMatch = stdout.match(/azure-cli\s+(\S+)/);
        const version = versionMatch ? versionMatch[1] : "unknown";
        return {
            passed: true,
            message: "Azure CLI installed",
            details: `Version: ${version}`,
        };
    } catch {
        return {
            passed: false,
            message: "Azure CLI not found",
            details: "Install from: https://docs.microsoft.com/cli/azure/install-azure-cli",
        };
    }
}

async function checkAzureAuth(): Promise<HealthCheckResult> {
    try {
        const { stdout } = await execAsync("az account show --query '{Name:name, Id:id, State:state}' -o json");
        const account = JSON.parse(stdout);

        if (account.State !== "Enabled") {
            return {
                passed: false,
                message: `Subscription state: ${account.State}`,
                details: "Expected: Enabled",
            };
        }

        return {
            passed: true,
            message: "Authenticated to Azure",
            details: `Subscription: ${account.Name}`,
        };
    } catch {
        return {
            passed: false,
            message: "Not logged in to Azure",
            details: "Run: az login",
        };
    }
}

async function checkResourceGroup(resourceGroup: string): Promise<HealthCheckResult> {
    try {
        const { stdout } = await execAsync(
            `az group show --name ${resourceGroup} --query '{Location:location, State:properties.provisioningState}' -o json`
        );
        const rg = JSON.parse(stdout);

        return {
            passed: true,
            message: "Resource group exists",
            details: `Location: ${rg.Location}, State: ${rg.State}`,
        };
    } catch {
        return {
            passed: false,
            message: `Resource group "${resourceGroup}" not found`,
            details: "Run 'opennextjs-azure deploy' to create it",
        };
    }
}

async function checkStorageAccount(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    try {
        const { stdout } = await execAsync(
            `az storage account list --resource-group ${resourceGroup} --query "[?starts_with(name, '${appName.replace(/-/g, "").substring(0, 10)}')].{Name:name, Location:location, Sku:sku.name, Status:statusOfPrimary}" -o json`
        );
        const accounts = JSON.parse(stdout);

        if (accounts.length === 0) {
            return {
                passed: false,
                message: "Storage account not found",
                details: `Expected storage account starting with "${appName.replace(/-/g, "").substring(0, 10)}"`,
            };
        }

        const account = accounts[0];
        if (account.Status !== "available") {
            return {
                passed: false,
                message: "Storage account not available",
                details: `Status: ${account.Status}`,
            };
        }

        return {
            passed: true,
            message: "Storage account healthy",
            details: `${account.Name} (${account.Sku})`,
        };
    } catch (error: any) {
        return {
            passed: false,
            message: "Failed to check storage account",
            details: error.message,
        };
    }
}

async function checkFunctionApp(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    const functionAppName = `${appName}-func-${environment}`;

    try {
        const { stdout } = await execAsync(
            `az functionapp show --resource-group ${resourceGroup} --name ${functionAppName} --query '{Name:name, State:state, Kind:kind}' -o json`
        );
        const funcApp = JSON.parse(stdout);

        return {
            passed: true,
            message: "Function app exists",
            details: `${funcApp.Name} (${funcApp.Kind})`,
        };
    } catch {
        return {
            passed: false,
            message: `Function app "${functionAppName}" not found`,
            details: "Run 'opennextjs-azure deploy' to create it",
        };
    }
}

async function checkAppServicePlan(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    const planName = `${appName}-plan-${environment}`;

    try {
        const { stdout } = await execAsync(
            `az appservice plan show --resource-group ${resourceGroup} --name ${planName} --query '{Name:name, Sku:sku.name, Tier:sku.tier, Status:properties.status}' -o json`
        );
        const plan = JSON.parse(stdout);

        if (plan.Status !== "Ready") {
            return {
                passed: false,
                message: "App Service Plan not ready",
                details: `Status: ${plan.Status}`,
            };
        }

        return {
            passed: true,
            message: "App Service Plan healthy",
            details: `${plan.Tier} (${plan.Sku})`,
        };
    } catch {
        return {
            passed: false,
            message: `App Service Plan "${planName}" not found`,
            details: "Run 'opennextjs-azure deploy' to create it",
        };
    }
}

async function checkFunctionAppStatus(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    const functionAppName = `${appName}-func-${environment}`;

    try {
        const { stdout } = await execAsync(
            `az functionapp show --resource-group ${resourceGroup} --name ${functionAppName} --query '{State:state, DefaultHostName:defaultHostName, OutboundIpAddresses:outboundIpAddresses}' -o json`
        );
        const funcApp = JSON.parse(stdout);

        if (funcApp.State !== "Running") {
            return {
                passed: false,
                message: "Function app not running",
                details: `State: ${funcApp.State}`,
            };
        }

        return {
            passed: true,
            message: "Function app running",
            details: `URL: https://${funcApp.DefaultHostName}`,
        };
    } catch (error: any) {
        return {
            passed: false,
            message: "Failed to check function app status",
            details: error.message,
        };
    }
}

async function checkStorageContainers(resourceGroup: string): Promise<HealthCheckResult> {
    try {
        const { stdout: accountStdout } = await execAsync(
            `az storage account list --resource-group ${resourceGroup} --query "[0].name" -o tsv`
        );
        const storageAccountName = accountStdout.trim();

        const { stdout: containersStdout } = await execAsync(
            `az storage container list --account-name ${storageAccountName} --query "[].name" -o json --only-show-errors`
        );
        const containers = JSON.parse(containersStdout);

        const requiredContainers = ["assets", "nextjs-cache"];
        const missingContainers = requiredContainers.filter(c => !containers.includes(c));

        if (missingContainers.length > 0) {
            return {
                passed: false,
                message: "Missing storage containers",
                details: `Missing: ${missingContainers.join(", ")}`,
            };
        }

        return {
            passed: true,
            message: "Storage containers configured",
            details: `Found: ${containers.length} container(s)`,
        };
    } catch (error: any) {
        return {
            passed: false,
            message: "Failed to check storage containers",
            details: error.message,
        };
    }
}

async function checkFunctionAppConfig(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    const functionAppName = `${appName}-func-${environment}`;

    try {
        const { stdout } = await execAsync(
            `az functionapp config appsettings list --resource-group ${resourceGroup} --name ${functionAppName} --query "[?name=='AZURE_STORAGE_CONNECTION_STRING' || name=='FUNCTIONS_WORKER_RUNTIME'].{Name:name, Value:value}" -o json`
        );
        const settings = JSON.parse(stdout);

        const hasStorageConnection = settings.some((s: any) => s.Name === "AZURE_STORAGE_CONNECTION_STRING");
        const hasRuntime = settings.some((s: any) => s.Name === "FUNCTIONS_WORKER_RUNTIME");

        if (!hasStorageConnection || !hasRuntime) {
            const missing = [];
            if (!hasStorageConnection) missing.push("AZURE_STORAGE_CONNECTION_STRING");
            if (!hasRuntime) missing.push("FUNCTIONS_WORKER_RUNTIME");

            return {
                passed: false,
                message: "Missing required configuration",
                details: `Missing: ${missing.join(", ")}`,
            };
        }

        return {
            passed: true,
            message: "Function app configured",
            details: `${settings.length} setting(s) verified`,
        };
    } catch (error: any) {
        return {
            passed: false,
            message: "Failed to check function app configuration",
            details: error.message,
        };
    }
}

async function checkApplicationInsights(
    appName: string,
    resourceGroup: string,
    environment: string
): Promise<HealthCheckResult> {
    const insightsName = `${appName}-insights-${environment}`;

    try {
        const { stdout } = await execAsync(
            `az monitor app-insights component show --app ${insightsName} --resource-group ${resourceGroup} --query '{Name:name, ApplicationType:applicationType, ProvisioningState:provisioningState}' -o json`
        );
        const insights = JSON.parse(stdout);

        if (insights.ProvisioningState !== "Succeeded") {
            return {
                passed: false,
                message: "Application Insights not ready",
                details: `State: ${insights.ProvisioningState}`,
            };
        }

        return {
            passed: true,
            message: "Application Insights configured",
            details: `${insights.Name} (${insights.ApplicationType})`,
        };
    } catch {
        return {
            passed: false,
            message: `Application Insights "${insightsName}" not found`,
            details: "Enable in azure.config.json and redeploy",
        };
    }
}
