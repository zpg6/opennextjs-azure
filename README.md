# OpenNext.js Azure

[![NPM Version](https://img.shields.io/npm/v/opennextjs-azure)](https://www.npmjs.com/package/opennextjs-azure)
[![NPM Downloads](https://img.shields.io/npm/dt/opennextjs-azure)](https://www.npmjs.com/package/opennextjs-azure)
[![License: MIT](https://img.shields.io/npm/l/opennextjs-azure)](https://opensource.org/licenses/MIT)

**True serverless Next.js on Azure Functions with ISR, streaming SSR, and on-demand revalidation.**

Built on the [OpenNext](https://opennext.js.org) framework, this adapter brings native Next.js support to Azure Functions. No compromises—full ISR, streaming responses, and production-ready infrastructure.

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

(Oops, we unpublished from NPM to clean up some test releases and its a 24hour wait to republish on same name. so for today its `opennext-azure` as the name for now.)

```bash
# Install globally or use npx
npm install -g opennextjs-azure

# Initialize Azure infrastructure in your Next.js project
opennextjs-azure init

# Build for Azure
opennextjs-azure build

# Deploy (provisions infrastructure + deploys app)
opennextjs-azure deploy
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

## CLI Commands

```bash
# Initialize (scaffolds infrastructure files)
opennextjs-azure init [--scaffold]

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
