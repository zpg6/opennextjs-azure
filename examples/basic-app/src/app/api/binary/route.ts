// Returns a 1x1 transparent PNG. Binary responses break if the adapter
// round-trips bodies through utf8 strings.
const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);

export async function GET() {
    return new Response(new Uint8Array(PNG_1X1), {
        headers: {
            "content-type": "image/png",
            "content-length": String(PNG_1X1.length),
        },
    });
}
