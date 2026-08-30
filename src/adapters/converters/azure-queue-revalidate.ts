import type { Converter } from "@opennextjs/aws/types/overrides.js";

interface RevalidateRecord {
    host: string;
    url: string;
    id: string;
}

interface RevalidateEvent {
    type: "revalidate";
    records: RevalidateRecord[];
}

/**
 * Converts an Azure Storage Queue message into OpenNext's revalidate event.
 *
 * The producer (overrides/queue/azure-queue.ts) sends base64-encoded JSON
 * {host, url, lastModified, eTag, deduplicationId, groupId}. The queue
 * trigger decodes the base64 and the worker parses the JSON, so the item
 * usually arrives as an object. Strings are handled too.
 */
async function convertFromQueueMessage(queueItem: unknown): Promise<RevalidateEvent> {
    let message: any = queueItem;
    if (typeof message === "string") {
        try {
            message = JSON.parse(message);
        } catch {
            message = JSON.parse(Buffer.from(message, "base64").toString("utf8"));
        }
    }

    return {
        type: "revalidate",
        records: [
            {
                host: message.host,
                url: message.url,
                id: message.deduplicationId || `${message.host}${message.url}`,
            },
        ],
    };
}

async function convertToQueueResult(revalidateEvent: RevalidateEvent): Promise<RevalidateEvent> {
    // Azure Storage Queues have no partial-batch semantics. The wrapper
    // throws when any record failed so the runtime retries the message and
    // poison-queues it after maxDequeueCount attempts.
    return revalidateEvent;
}

export default {
    convertFrom: convertFromQueueMessage,
    convertTo: convertToQueueResult,
    name: "azure-queue-revalidate",
} satisfies Converter<RevalidateEvent, RevalidateEvent>;
