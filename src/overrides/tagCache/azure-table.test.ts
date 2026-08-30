import { beforeEach, describe, expect, it } from "vitest";
import AzureTableTagCache, { decodeTableKey, encodeTableKey } from "./azure-table.js";

describe("AzureTableTagCache key encoding", () => {
    beforeEach(() => {
        process.env.NEXT_BUILD_ID = "build123";
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
        delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    });

    function cache(): any {
        return new AzureTableTagCache() as any;
    }

    it("percent-encodes characters Azure Tables forbids in keys", () => {
        const key = cache().buildKey("/products/123");
        // '/' (0x2f) is disallowed in PartitionKey/RowKey
        expect(key).not.toContain("/");
        expect(key).toBe("build123%2fproducts%2f123");
    });

    it("strips leading slashes so runtime keys match seeded rows", () => {
        // Next hands the cache "/isr"; seed data is posix-joined "build123/isr".
        // Both must land on the same key.
        const c = cache();
        expect(c.buildKey("/isr")).toBe(encodeTableKey("build123/isr"));
        expect(c.buildPathKey("/isr")).toBe(encodeTableKey("path#build123/isr"));
        expect(c.buildKey("isr")).toBe(c.buildKey("/isr"));
    });

    it("round-trips encode/decode", () => {
        const original = "path/with#hash?and%percent\\slash";
        expect(decodeTableKey(encodeTableKey(original))).toBe(original);
    });

    it("strips the build id when decoding stored keys", () => {
        const c = cache();
        const stored = c.buildKey("/products/123");
        expect(c.stripBuildId(stored)).toBe("products/123");
    });

    it("escapes single quotes for OData filters", () => {
        expect(cache().odataEscape("o'brien")).toBe("o''brien");
    });

    it("builds a distinct reverse-index partition key for paths", () => {
        const c = cache();
        const pathKey = c.buildPathKey("/products/123");
        expect(pathKey).toBe("path%23build123%2fproducts%2f123");
        expect(pathKey).not.toBe(c.buildKey("/products/123"));
    });
});
