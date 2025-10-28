export { defineAzureConfig } from "./config/index.js";
export { init } from "./cli/init.js";
export { build } from "./cli/build.js";
export { deploy } from "./cli/deploy.js";

// Export Azure-specific overrides
export { default as azureBlobCache } from "./overrides/incrementalCache/azure-blob.js";
export { default as azureTableTagCache } from "./overrides/tagCache/azure-table.js";
export { default as azureQueueRevalidation } from "./overrides/queue/azure-queue.js";

// Export wrappers and converters
export { default as azureFunctionsWrapper } from "./adapters/wrappers/azure-functions.js";
export { default as azureHttpConverter } from "./adapters/converters/azure-http.js";

// Export types
export type { AzureConfig, AzureDeploymentTarget } from "./types/index.js";
