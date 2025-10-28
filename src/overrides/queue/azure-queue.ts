import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import type { Queue, QueueMessage } from "@opennextjs/aws/types/overrides.js";
import { getAzureConfig } from "../../config/index.js";

/**
 * Azure Queue Storage implementation of the revalidation queue.
 *
 * Handles on-demand ISR revalidation triggered by:
 * - revalidateTag('product')
 * - revalidatePath('/products/123')
 *
 * The queue receives revalidation messages and triggers re-renders.
 */
class AzureQueueRevalidation implements Queue {
    name = "azure-queue";
    private queueClient!: QueueClient;

    constructor() {
        const { storage } = getAzureConfig();
        const connectionString = storage.connectionString;
        const queueName = storage.queueName || "nextjsrevalidation";

        if (connectionString) {
            const queueServiceClient = QueueServiceClient.fromConnectionString(connectionString);
            this.queueClient = queueServiceClient.getQueueClient(queueName);
            this.ensureQueueExists();
        }
    }

    private async ensureQueueExists(): Promise<void> {
        try {
            await this.queueClient.create();
        } catch (error: any) {
            // 409 = queue already exists, which is fine
            if (error.statusCode !== 409) {
                console.error("Failed to create Azure Queue:", error);
            }
        }
    }

    async send(message: QueueMessage): Promise<void> {
        if (!this.queueClient) {
            console.warn("Azure Queue not configured. Skipping revalidation message.");
            return;
        }

        try {
            // Package the revalidation message
            const messageContent = JSON.stringify({
                host: message.MessageBody.host,
                url: message.MessageBody.url,
                lastModified: message.MessageBody.lastModified,
                eTag: message.MessageBody.eTag,
                deduplicationId: message.MessageDeduplicationId,
                groupId: message.MessageGroupId,
            });

            // Azure Queue requires base64 encoding
            await this.queueClient.sendMessage(Buffer.from(messageContent).toString("base64"));
        } catch (error) {
            console.error("Failed to send revalidation message:", error);
            throw error;
        }
    }
}

export default AzureQueueRevalidation;
