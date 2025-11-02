import { Readable } from "node:stream";
import type { ImageLoader } from "@opennextjs/aws/types/overrides.js";

/**
 * Azure Blob Storage Image Loader
 *
 * Loads source images from the "assets" blob container for Next.js image optimization.
 * This is the first step in the image optimization pipeline.
 *
 * Flow:
 * 1. User requests: /_next/image?url=/photo.jpg&w=640&q=75
 * 2. This loader fetches the original /photo.jpg from "assets" container (public blob)
 * 3. Image is passed to Next.js optimizer (sharp) for processing
 * 4. Result is cached in "optimized-images" container (if caching enabled)
 */

const { AZURE_STORAGE_ACCOUNT_NAME } = process.env;

const azureBlobImageLoader: ImageLoader = {
    name: "azure-blob",
    load: async (key: string) => {
        if (!AZURE_STORAGE_ACCOUNT_NAME) {
            throw new Error("AZURE_STORAGE_ACCOUNT_NAME must be defined");
        }

        const cleanKey = key.replace(/^\//, "");
        const blobUrl = `https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/assets/${cleanKey}`;

        try {
            const response = await fetch(blobUrl);

            if (response.status === 404) {
                throw new Error(`Image not found in blob storage: ${cleanKey}`);
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch image. Status: ${response.status}`);
            }

            if (!response.body) {
                throw new Error("No body in fetch response");
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const body = Readable.from(buffer);

            return {
                body,
                contentType: response.headers.get("content-type") ?? undefined,
                cacheControl: response.headers.get("cache-control") ?? undefined,
            };
        } catch (error: any) {
            throw new Error(`Failed to load image from Azure Blob: ${error.message}`);
        }
    },
};

export default azureBlobImageLoader;
