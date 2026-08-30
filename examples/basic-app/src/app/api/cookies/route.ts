import { NextResponse } from "next/server";

export async function GET() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set("session", "abc123", { httpOnly: true, path: "/", sameSite: "lax" });
    response.cookies.set("theme", "dark", { path: "/", maxAge: 3600 });
    return response;
}
