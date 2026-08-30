// ISR page. Exercises the Azure Blob incremental cache: set on first
// render, get plus revalidation checks after that.
export const revalidate = 10;

export default function IsrPage() {
    return (
        <main style={{ padding: "2rem", fontFamily: "monospace" }}>
            <h1>ISR page</h1>
            <p>
                Rendered at: <time>{new Date().toISOString()}</time>
            </p>
            <p>Revalidates every 10 seconds.</p>
        </main>
    );
}
