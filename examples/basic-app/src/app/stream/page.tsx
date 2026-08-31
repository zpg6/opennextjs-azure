import { Suspense } from "react";

// Streaming SSR proof: the shell must reach the client while the slow part
// is still rendering. The e2e harness asserts time-to-first-byte is well
// before total response time on this route.
export const dynamic = "force-dynamic";

async function SlowSection() {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return <p data-testid="slow">slow section rendered</p>;
}

export default function StreamPage() {
    return (
        <main style={{ padding: "2rem", fontFamily: "monospace" }}>
            <h1>Streaming</h1>
            <p data-testid="shell">shell rendered</p>
            <Suspense fallback={<p>loading…</p>}>
                <SlowSection />
            </Suspense>
        </main>
    );
}
