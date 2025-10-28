# Basic App Example

**Live Demo:** https://opennext-basic-app-func-dev.azurewebsites.net

A minimal Next.js 15 app deployed to Azure Functions, created entirely with the scaffold command.

## How This Was Created

```bash
npx opennext-azure@latest init --scaffold
npx opennextjs-azure build
npx opennextjs-azure deploy
```

That's it! Three commands to go from nothing to a production Next.js app on Azure. All infrastructure is provisioned automatically via Bicep templates.

## Local Development

```bash
pnpm dev      # Start dev server at http://localhost:3000
pnpm build    # Build for production
```

## Deploy Your Own

Create your own Next.js + Azure app:

```bash
# In an empty directory
npx opennext-azure@latest init --scaffold

# Edit azure.config.json with your app name and region

# Deploy
npx opennextjs-azure build
npx opennextjs-azure deploy
```

## Key Files

- **`open-next.config.ts`** - Azure adapter configuration (auto-generated)
- **`infrastructure/main.bicep`** - Azure resources (synced from package on deploy)
- **`azure.config.json`** - Deployment settings (gitignored, customize this)
- **`next.config.ts`** - Includes `output: "standalone"` for Azure Functions

## Learning Resources

- [OpenNext Azure Docs](../../README.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [Azure Functions](https://learn.microsoft.com/azure/azure-functions/)
