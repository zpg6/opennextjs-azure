import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next.js";
import type { OpenNextHandler, OpenNextHandlerOptions } from "@opennextjs/aws/types/overrides.js";

/**
 * Azure Image Optimization Handler
 *
 * Wraps OpenNext's default image optimization handler with Azure Blob caching.
 *
 * When AZURE_IMAGE_OPTIMIZATION_CACHE=true:
 *   - First request: Loads from "assets", processes, caches in "optimized-images", returns
 *   - Subsequent requests: Returns from "optimized-images" cache (no processing)
 *
 * When AZURE_IMAGE_OPTIMIZATION_CACHE=false:
 *   - Every request processes the image (no caching)
 */
export async function createImageOptimizationHandler(): Promise<OpenNextHandler<InternalEvent, InternalResult>> {
    const { defaultHandler } = await import("@opennextjs/aws/adapters/image-optimization-adapter.js");

    // Always use Azure Blob caching when deployed on Azure
    const { createCachedImageOptimizationHandler } = await import("../overrides/imageOptimization/azure-cached.js");
    return createCachedImageOptimizationHandler(defaultHandler);
}

export const handler = await createImageOptimizationHandler();

export async function defaultHandler(event: InternalEvent, options?: OpenNextHandlerOptions): Promise<InternalResult> {
    return handler(event, options);
}
