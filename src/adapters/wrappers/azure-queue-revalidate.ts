import type { WrapperHandler } from "@opennextjs/aws/types/overrides.js";

/**
 * Azure Functions wrapper for the OpenNext revalidation consumer
 * (v4 programming model: handler receives (queueItem, context)).
 *
 * The core handler re-requests each stale page with the
 * `x-prerender-revalidate` header so Next.js regenerates it and the
 * incremental cache is refreshed. It returns the records that FAILED;
 * throwing on failure makes the Functions runtime retry the message
 * (then dead-letter it to the poison queue after maxDequeueCount).
 */
const handler: WrapperHandler<any, any> =
    async (handler, converter) =>
    async (queueItem: unknown, context: any): Promise<void> => {
        const event = await converter.convertFrom(queueItem);
        const result = await handler(event);

        const failed = result?.records ?? [];
        if (failed.length > 0) {
            const urls = failed.map((r: { url: string }) => r.url).join(", ");
            throw new Error(`Revalidation failed for: ${urls}`);
        }

        context.log?.(`Revalidated ${event.records.length} page(s)`);
    };

export default {
    wrapper: handler,
    name: "azure-queue-revalidate",
    supportStreaming: false,
};
