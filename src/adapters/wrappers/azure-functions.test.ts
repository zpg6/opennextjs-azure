import { describe, expect, it } from "vitest";
import { parseSetCookie } from "./azure-functions.js";

describe("parseSetCookie", () => {
    it("parses name/value with attributes", () => {
        const c = parseSetCookie(
            "session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Domain=example.com"
        );
        expect(c).toMatchObject({
            name: "session",
            value: "abc123",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
            maxAge: 3600,
            domain: "example.com",
        });
    });

    it("keeps '=' inside the value", () => {
        expect(parseSetCookie("tok=a=b=c; Path=/")).toMatchObject({ name: "tok", value: "a=b=c" });
    });

    it("parses Expires with its embedded comma intact", () => {
        const c = parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT");
        expect((c?.expires as Date).getUTCFullYear()).toBe(2026);
    });

    it("returns null for a malformed header", () => {
        expect(parseSetCookie("nonsense")).toBeNull();
    });
});
