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

// Any well-formed key works: the endpoint refuses connections before auth.
const dummyKey = Buffer.alloc(64, 7).toString("base64");
const unreachableConnectionString = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${dummyKey};BlobEndpoint=http://127.0.0.1:1/devstoreaccount1;`;

describe("AzureBlobIncrementalCache fail-open", () => {
    // A storage outage must degrade to cache misses, not 500 every request.
    it("get() returns null when storage is unreachable", async () => {
        process.env.NEXT_BUILD_ID = "build123";
        process.env.AZURE_STORAGE_CONNECTION_STRING = unreachableConnectionString;
        const cache = new AzureBlobIncrementalCache();
        await expect(cache.get("/index")).resolves.toBeNull();
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    }, 20000);

    it("set() rejects when storage is unreachable, so callers see the failure", async () => {
        process.env.NEXT_BUILD_ID = "build123";
        process.env.AZURE_STORAGE_CONNECTION_STRING = unreachableConnectionString;
        const cache = new AzureBlobIncrementalCache();
        await expect(cache.set("/index", { type: "route", body: "x" } as never)).rejects.toBeTruthy();
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    }, 20000);
});
