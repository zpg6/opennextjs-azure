# OpenNext.js Azure

[![NPM Version](https://img.shields.io/npm/v/opennextjs-azure)](https://www.npmjs.com/package/opennextjs-azure)
[![NPM Downloads](https://img.shields.io/npm/dt/opennextjs-azure)](https://www.npmjs.com/package/opennextjs-azure)
[![License: MIT](https://img.shields.io/npm/l/opennextjs-azure)](https://opensource.org/licenses/MIT)

**True serverless Next.js on Azure Functions with ISR, streaming SSR, and on-demand revalidation.**

Built on the [OpenNext](https://opennext.js.org) framework, this adapter brings native Next.js support to Azure Functions. No compromises—full ISR, streaming responses, and production-ready infrastructure.

> **🚀 New to Azure deployment?** Jump to [Quick Start](#quick-start) and run `npx opennext-azure@latest init --scaffold` to create a fully configured Next.js app ready for Azure in seconds!

## The Gap This Project Fills

Tutorials exist for static Next.js on Static Web Apps, standalone builds on App Service, and Docker-based deployments, but nothing for **true serverless Next.js** with ISR, streaming SSR, and on-demand revalidation—until now.

Azure Functions is Microsoft's serverless compute platform—comparable to AWS Lambda and Cloudflare Workers, both of which already have OpenNext adapters. This project bridges that gap, bringing the same Vercel-grade developer experience to Azure: one command deploys your Next.js app with full ISR, streaming, and revalidation support—no manual infrastructure setup required.

## Next.js Features → Azure Services

| Next.js Feature                        | Azure Implementation                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Incremental Static Regeneration        | Azure Blob Storage                                                      |
| Streaming SSR                          | Azure Functions with Node.js streams                                    |
| `revalidateTag()` / `revalidatePath()` | Azure Table Storage + Queue Storage                                     |
| Fetch caching                          | Blob containers with build ID namespacing                               |
| Infrastructure                         | Complete Bicep templates (Y1 Consumption for dev, EP1 Premium for prod) |

## Quick Start

### ⚡ Recommended: Create New Project with Scaffold

**The fastest way to get started** is using our scaffold command, which wraps `create-next-app` and sets up everything for Azure deployment:

```bash
npx opennext-azure@latest init --scaffold
```

This single command:

1. Creates a new Next.js 15 app (TypeScript, App Router, Tailwind, ESLint)
2. Adds Azure deployment dependencies (`opennext-azure`, `esbuild`)
3. Configures `next.config.ts` with `output: "standalone"`
4. Creates `open-next.config.ts` with Azure adapters
5. Generates `infrastructure/main.bicep` for Azure resources
6. Sets up `azure.config.json` for deployment configuration

Then build and deploy:

```bash
npx opennextjs-azure build
npx opennextjs-azure deploy
```

**💡 See it in action:** The [`examples/basic-app`](./examples/basic-app) directory (live at https://opennext-basic-app-func-dev.azurewebsites.net) was created using `init --scaffold` with zero manual configuration!

### 📦 Adding to Existing Project

If you have an existing Next.js project:

```bash
# Initialize Azure infrastructure
npx opennext-azure init

# Build for Azure
npx opennext-azure build

# Deploy (provisions infrastructure + deploys app)
npx opennext-azure deploy
```

## Intelligent Preflight Checks

Before deployment, the CLI validates your Azure environment to prevent failed deployments:

✓ **Azure CLI** installation and login status  
✓ **Subscription** permissions and state  
✓ **Region** availability  
✓ **Resource providers** (auto-registers Microsoft.Web, Microsoft.Storage)  
✓ **Quota availability** for your target SKU  
✓ **Build output** structure

**Smart quota handling:** If you request `--environment prod` but don't have EP1 Premium quota, the CLI suggests `--environment dev` instead. Zero failed deployments from quota issues.

## Architecture

```
Next.js Request
    ↓
Azure Functions HTTP Trigger
    ↓
Azure HTTP Converter (request → InternalEvent)
    ↓
Azure Functions Wrapper (handles streaming)
    ↓
Next.js Server (OpenNext)
    ↓
ISR Cache Check → Azure Blob Storage
Tag Check → Azure Table Storage
Revalidation → Azure Queue Storage
    ↓
Response Stream → Azure Functions Response
```

## One Command, Full Infrastructure

`opennextjs-azure deploy` provisions everything via Bicep:

- Function App (with streaming support)
- Storage Account (blob containers, tables, queues)
- App Service Plan (Y1 Consumption or EP1 Premium)
- CORS configuration
- Environment variables
- Connection strings

Choose your environment:

- `--environment dev` → Y1 Consumption (pay-per-execution)
- `--environment staging` → EP1 Premium (always-ready instances)
- `--environment prod` → EP1 Premium (production-grade)

## How It Works

**Protocol Adapters:**  
Converts between Azure Functions HTTP triggers and Next.js InternalEvent/InternalResult format with full streaming support.

**ISR Implementation:**

- **Incremental Cache:** Azure Blob Storage stores rendered pages with `[buildId]/[key].cache` structure
- **Tag Cache:** Azure Table Storage maps tags → paths for `revalidateTag()`
- **Revalidation Queue:** Azure Queue Storage triggers on-demand regeneration

**Build Process:**  
Uses OpenNext's AWS build with Azure-specific overrides, then adds Azure Functions metadata (`host.json`, `function.json`) for v3 programming model.

## Examples

Check out [`examples/basic-app`](./examples/basic-app) - a complete working Next.js 15 app deployed to Azure. This example was created with `npx opennext-azure@latest init --scaffold` and demonstrates:

- ✅ Next.js 15 with App Router, TypeScript, Tailwind v4
- ✅ ISR caching with Azure Blob Storage
- ✅ Tag-based revalidation with Azure Table Storage
- ✅ Streaming SSR on Azure Functions
- ✅ Production deployment on Consumption Plan (Y1)

**Live demo:** https://opennext-basic-app-func-dev.azurewebsites.net

## CLI Commands

### `init --scaffold` (Recommended for new projects)

Creates a complete Next.js + Azure setup in one command:

```bash
npx opennext-azure@latest init --scaffold
```

This wraps `create-next-app` with Azure-specific setup. Supports all create-next-app options:

```bash
# Customize the scaffold
opennextjs-azure init --scaffold \
  [--no-typescript] \
  [--no-tailwind] \
  [--no-eslint] \
  [--no-src-dir] \
  [--no-app-router] \
  [--import-alias <alias>] \
  [--package-manager npm|yarn|pnpm|bun]
```

### Other Commands

```bash
# Initialize Azure infrastructure in existing project
opennextjs-azure init

# Build Next.js app for Azure
opennextjs-azure build [-c <config-path>]

# Deploy to Azure
opennextjs-azure deploy \
  [--app-name <name>] \
  [--resource-group <name>] \
  [--location <region>] \
  [--environment dev|staging|prod] \
  [--skip-infrastructure]
```

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
