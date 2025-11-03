#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./init.js";
import { build } from "./build.js";
import { deploy } from "./deploy.js";
import { tail } from "./tail.js";
import { health } from "./health.js";
import { deleteResourceGroup } from "./delete.js";

const program = new Command();

program
    .name("opennextjs-azure")
    .description("CLI tool for building and deploying Next.js apps to Azure")
    .version("0.1.2");

program
    .command("init")
    .description("Initialize Azure infrastructure in your project")
    .option("--scaffold", "Scaffold a new Next.js project if in empty directory")
    .option("--no-typescript", "Disable TypeScript (default: enabled)")
    .option("--no-tailwind", "Disable Tailwind CSS (default: enabled with v3)")
    .option("--no-eslint", "Disable ESLint (default: enabled)")
    .option("--no-src-dir", "Disable src/ directory (default: enabled)")
    .option("--no-app-router", "Use Pages Router instead of App Router")
    .option("--import-alias <alias>", "Import alias (default: @/*)")
    .option("--package-manager <pm>", "Package manager: npm, yarn, pnpm, bun (default: pnpm)")
    .action(async options => {
        await init(options);
    });

program
    .command("build")
    .description("Build Next.js app for Azure deployment")
    .option("-c, --config <path>", "Path to open-next.config.ts file")
    .action(async options => {
        await build(options.config);
    });

program
    .command("deploy")
    .description("Deploy Next.js app to Azure (provisions infrastructure + deploys)")
    .option("-n, --app-name <name>", "Application name (overrides azure.config.json)")
    .option("-g, --resource-group <name>", "Azure resource group name")
    .option("-l, --location <location>", "Azure region")
    .option("-e, --environment <env>", "Environment: dev, staging, or prod")
    .option("--skip-infrastructure", "Skip infrastructure provisioning")
    .action(async options => {
        await deploy(options);
    });

program
    .command("tail")
    .description("Stream live logs from Application Insights (like wrangler tail)")
    .option("-n, --app-name <name>", "Application name")
    .option("-g, --resource-group <name>", "Azure resource group name")
    .option("-f, --format <format>", "Output format: pretty or json (default: pretty)")
    .option("--show-metadata", "Show full metadata (operation name, custom dimensions)")
    .option("--no-timestamp", "Hide timestamps")
    .action(async options => {
        await tail(options);
    });

program
    .command("health")
    .description("Check health status of Azure deployment resources")
    .option("-n, --app-name <name>", "Application name")
    .option("-g, --resource-group <name>", "Azure resource group name")
    .action(async options => {
        await health(options);
    });

program
    .command("delete")
    .description("Delete Azure resource group and all its resources")
    .option("-g, --resource-group <name>", "Azure resource group name")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--no-wait", "Delete in background (returns immediately)")
    .action(async options => {
        await deleteResourceGroup(options);
    });

program.parse();
