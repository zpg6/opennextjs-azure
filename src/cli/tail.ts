import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execAsync = promisify(exec);

const colors = {
    dim: "\x1b[2m",
    bright: "\x1b[1m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    reset: "\x1b[0m",
};

/*
 * Stream live logs from Application Insights (like wrangler tail)
 */
export async function tail(options?: {
    appName?: string;
    resourceGroup?: string;
    format?: "pretty" | "json";
    showMetadata?: boolean;
    showTimestamp?: boolean;
}): Promise<void> {
    const cwd = process.cwd();

    // Load config
    const configPath = path.join(cwd, "azure.config.json");
    let config: any = {};
    try {
        const configContent = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(configContent);
    } catch {
        console.error("❌ azure.config.json not found.");
        console.error("   Run this command from your project directory.\n");
        process.exit(1);
    }

    if (!config.applicationInsights) {
        console.error("❌ Application Insights is not enabled!");
        console.error("   Enable it in azure.config.json:");
        console.error('   { "applicationInsights": true }\n');
        process.exit(1);
    }

    const appName = options?.appName || config.appName;
    const resourceGroup = options?.resourceGroup || config.resourceGroup;
    const environment = config.environment || "dev";
    const format = options?.format || "pretty";
    const showMetadata = options?.showMetadata ?? false;
    const showTimestamp = options?.showTimestamp ?? true;

    if (!appName || !resourceGroup) {
        console.error("❌ Missing required configuration!");
        console.error("   Ensure appName and resourceGroup are set in azure.config.json\n");
        process.exit(1);
    }

    const applicationInsightsName = `${appName}-insights-${environment}`;

    try {
        // Get Application Insights resource ID
        const { stdout: resourceIdOutput } = await execAsync(
            `az monitor app-insights component show --app ${applicationInsightsName} -g ${resourceGroup} --query id -o tsv`
        );
        const resourceId = resourceIdOutput.trim();

        console.log(`${colors.cyan}📡 Streaming logs from ${applicationInsightsName}...${colors.reset}`);
        console.log(`${colors.dim}Press Ctrl+C to stop${colors.reset}`);
        console.log(`${colors.dim}Note: Logs have 1-2 minute delay (Application Insights indexing)${colors.reset}\n`);

        await streamLogs(resourceId, format, showMetadata, showTimestamp);
    } catch (error: any) {
        if (error.message.includes("not found") || error.message.includes("could not be found")) {
            console.error(`\n❌ Application Insights "${applicationInsightsName}" not found!`);
            console.error(`   Make sure you've deployed with Application Insights enabled.\n`);
        } else {
            console.error(`\n❌ Failed to stream logs: ${error.message}\n`);
        }
        process.exit(1);
    }
}

async function streamLogs(
    resourceId: string,
    format: "pretty" | "json",
    showMetadata: boolean,
    showTimestamp: boolean
): Promise<void> {
    let lastTimestamp = new Date(Date.now() - 10000).toISOString();
    const seenMessages = new Set<string>();

    const query = async () => {
        try {
            const kusto = `
                union traces, exceptions, requests
                | where timestamp > datetime('${lastTimestamp}')
                | where isnotempty(message) or itemType == 'request' or itemType == 'exception'
                | project timestamp, message, severityLevel, itemType, operation_Name, customDimensions
                | order by timestamp asc
                | limit 100
            `;

            const { stdout } = await execAsync(
                `az monitor app-insights query --ids "${resourceId}" --analytics-query "${kusto.replace(/\n/g, " ").replace(/\s+/g, " ")}" -o json`
            );

            const data = JSON.parse(stdout);
            const rows = data.tables?.[0]?.rows || [];

            for (const row of rows) {
                const [timestamp, message, severityLevel, itemType, operationName, customDimensions] = row;

                if (!message && itemType === "trace") {
                    continue;
                }

                const messageKey = `${timestamp}-${message}`;

                if (seenMessages.has(messageKey)) {
                    continue;
                }
                seenMessages.add(messageKey);

                if (format === "json") {
                    console.log(
                        JSON.stringify({
                            timestamp,
                            message,
                            severityLevel,
                            itemType,
                            operationName,
                            customDimensions,
                        })
                    );
                } else {
                    formatPrettyLog(
                        {
                            timestamp,
                            message,
                            severityLevel,
                            itemType,
                            operationName,
                            customDimensions,
                        },
                        showMetadata,
                        showTimestamp
                    );
                }

                lastTimestamp = timestamp;
            }

            if (seenMessages.size > 1000) {
                const entries = Array.from(seenMessages);
                seenMessages.clear();
                entries.slice(-1000).forEach(e => seenMessages.add(e));
            }
        } catch (error: any) {
            if (!error.message.includes("exit code")) {
                console.error(`${colors.red}⚠ Query error: ${error.message}${colors.reset}`);
            }
        }
    };

    await query();

    const interval = setInterval(query, 1500);

    process.on("SIGINT", () => {
        clearInterval(interval);
        console.log(`\n${colors.cyan}✓ Stopped streaming logs${colors.reset}`);
        process.exit(0);
    });

    await new Promise(() => {});
}

function formatPrettyLog(
    log: {
        timestamp: string;
        message: string;
        severityLevel: number;
        itemType: string;
        operationName?: string;
        customDimensions?: Record<string, string>;
    },
    showMetadata: boolean,
    showTimestamp: boolean
): void {
    let output = "";

    if (showTimestamp) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        output += `${colors.dim}${time}${colors.reset} `;
    }

    const severity = getSeverityLabel(log.severityLevel);
    output += `${severity} `;

    const displayMessage = log.message || `[${log.itemType}]`;
    output += displayMessage;

    console.log(output);

    if (showMetadata) {
        const typeLabel = getTypeLabel(log.itemType);
        console.log(`  ${colors.dim}Type:${colors.reset} ${typeLabel} ${log.itemType}`);

        if (log.operationName) {
            console.log(`  ${colors.dim}Operation:${colors.reset} ${colors.cyan}${log.operationName}${colors.reset}`);
        }

        if (log.customDimensions && Object.keys(log.customDimensions).length > 0) {
            try {
                const dims =
                    typeof log.customDimensions === "string" ? JSON.parse(log.customDimensions) : log.customDimensions;

                for (const [key, value] of Object.entries(dims)) {
                    if (key.startsWith("prop__") || key === "InvocationId") continue;
                    console.log(`  ${colors.dim}${key}:${colors.reset} ${value}`);
                }
            } catch {
                // Skip if customDimensions can't be parsed
            }
        }
    }
}

function getSeverityLabel(level: number): string {
    switch (level) {
        case 0:
            return `${colors.dim}[TRACE]${colors.reset}`;
        case 1:
            return `${colors.blue}[DEBUG]${colors.reset}`;
        case 2:
            return `${colors.green}[INFO] ${colors.reset}`;
        case 3:
            return `${colors.yellow}[WARN] ${colors.reset}`;
        case 4:
            return `${colors.red}[ERROR]${colors.reset}`;
        default:
            return `${colors.dim}[LOG]  ${colors.reset}`;
    }
}

function getTypeLabel(itemType: string): string {
    switch (itemType) {
        case "trace":
            return "📝";
        case "request":
            return "🌐";
        case "exception":
            return "💥";
        default:
            return "📄";
    }
}
