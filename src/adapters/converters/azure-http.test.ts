import { describe, expect, it } from "vitest";
import converter from "./azure-http.js";

function v3Request(overrides: Record<string, unknown> = {}) {
    // Shape of the v3 (function.json) programming model HttpRequest:
    // plain-object headers, bufferBody/rawBody, no arrayBuffer().
    return {
        method: "POST",
        url: "http://localhost:7071/api/echo?a=1&a=2&b=x",
        headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc; theme=dark=mode",
            "X-Forwarded-For": "203.0.113.9, 10.0.0.1",
        },
        bufferBody: Buffer.from('{"hello":"world"}'),
        ...overrides,
    } as never;
}

function v4Request(overrides: Record<string, unknown> = {}) {
    const body = Buffer.from('{"hello":"v4"}');
    return {
        method: "POST",
        url: "http://localhost:7071/api/echo",
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        ...overrides,
    } as never;
}

describe("convertFrom (v3 model)", () => {
    it("reads the body from bufferBody, since v3 has no arrayBuffer()", async () => {
        const event = await converter.convertFrom(v3Request());
        expect(event.body?.toString()).toBe('{"hello":"world"}');
    });

    it("falls back to rawBody when bufferBody is absent", async () => {
        const event = await converter.convertFrom(v3Request({ bufferBody: undefined, rawBody: "raw=1" }));
        expect(event.body?.toString()).toBe("raw=1");
    });

    it("lowercases plain-object headers", async () => {
        const event = await converter.convertFrom(v3Request());
        expect(event.headers["content-type"]).toBe("application/json");
    });

    it("parses cookies preserving '=' in values", async () => {
        const event = await converter.convertFrom(v3Request());
        expect(event.cookies).toEqual({ session: "abc", theme: "dark=mode" });
    });

    it("accumulates repeated query params into arrays", async () => {
        const event = await converter.convertFrom(v3Request());
        expect(event.query).toEqual({ a: ["1", "2"], b: "x" });
    });

    it("uses the first x-forwarded-for hop as remoteAddress", async () => {
        const event = await converter.convertFrom(v3Request());
        expect(event.remoteAddress).toBe("203.0.113.9");
    });

    it("sends no body for GET", async () => {
        const event = await converter.convertFrom(v3Request({ method: "GET" }));
        expect(event.body).toBeUndefined();
    });
});

describe("convertFrom (v4 model)", () => {
    it("reads the body via arrayBuffer()", async () => {
        const event = await converter.convertFrom(v4Request());
        expect(event.body?.toString()).toBe('{"hello":"v4"}');
    });

    it("iterates WHATWG Headers (no enumerable own properties)", async () => {
        const event = await converter.convertFrom(v4Request());
        expect(event.headers["content-type"]).toBe("application/json");
    });
});

describe("convertTo", () => {
    function internalResult(overrides: Record<string, unknown> = {}) {
        return {
            type: "core",
            statusCode: 200,
            headers: {},
            body: new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode("hi"));
                    c.close();
                },
            }),
            isBase64Encoded: false,
            ...overrides,
        } as never;
    }

    it("returns cookies separately instead of comma-folding set-cookie", async () => {
        const res = await converter.convertTo!(
            internalResult({
                headers: { "set-cookie": ["a=1; Path=/", "b=2; HttpOnly"], "x-two": ["l", "r"] },
            })
        );
        expect(res.cookies).toEqual(["a=1; Path=/", "b=2; HttpOnly"]);
        expect(res.headers["set-cookie"]).toBeUndefined();
        expect(res.headers["x-two"]).toBe("l, r");
    });

    it("returns the raw byte body, not base64 text", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const res = await converter.convertTo!(
            internalResult({
                isBase64Encoded: true,
                body: new ReadableStream({
                    start(c) {
                        c.enqueue(new Uint8Array(bytes));
                        c.close();
                    },
                }),
            })
        );
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(Buffer.compare(res.body!, bytes)).toBe(0);
    });
});
