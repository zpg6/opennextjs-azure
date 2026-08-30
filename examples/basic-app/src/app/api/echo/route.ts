import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    const body = await request.text();
    return NextResponse.json({
        method: "POST",
        received: body,
        contentType: request.headers.get("content-type"),
    });
}
