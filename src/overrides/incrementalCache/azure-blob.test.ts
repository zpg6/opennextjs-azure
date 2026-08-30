import { beforeEach, describe, expect, it } from "vitest";
import AzureBlobIncrementalCache from "./azure-blob.js";

describe("AzureBlobIncrementalCache.buildBlobKey", () => {
    beforeEach(() => {
        process.env.NEXT_BUILD_ID = "build123";
        delete process.env.AZURE_CACHE_KEY_PREFIX;
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
        delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    });

    function key(k: string, type?: "cache" | "fetch"): string {
        return (new AzureBlobIncrementalCache() as any).buildBlobKey(k, type ?? "cache");
    }

    it("does not repeat the container name and strips leading slashes", () => {
        expect(key("/index")).toBe("build123/index.cache");
    });

    it("prefixes fetch entries with __fetch and no extension", () => {
        expect(key("abc123", "fetch")).toBe("__fetch/build123/abc123");
    });

    it("honors an explicit key prefix", () => {
        process.env.AZURE_CACHE_KEY_PREFIX = "myprefix";
        expect(key("/index")).toBe("myprefix/build123/index.cache");
    });
});
