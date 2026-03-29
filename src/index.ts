/**
 * @zernio/chat-sdk-adapter
 *
 * Official Zernio adapter for Chat SDK. Build chatbots that work across
 * Instagram, Facebook, Twitter/X, Telegram, WhatsApp, Bluesky, and Reddit
 * through a single integration.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createZernioAdapter } from "@zernio/chat-sdk-adapter";
 *
 * const bot = new Chat({
 *   adapters: { zernio: createZernioAdapter() },
 *   onNewMessage: async ({ thread, message }) => {
 *     await thread.post(`Hello from all platforms!`);
 *   },
 * });
 * ```
 */

// ─── Core Exports ───────────────────────────────────────────────────────────

export { ZernioAdapter } from "./adapter.js";
export { createZernioAdapter } from "./factory.js";

// ─── Utilities ──────────────────────────────────────────────────────────────

export { ZernioFormatConverter } from "./format-converter.js";
export { ZernioApiClient } from "./api-client.js";
export { verifyWebhookSignature, extractWebhookHeaders } from "./webhook.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  ZernioConfig,
  ZernioThreadId,
  ZernioRawMessage,
  ZernioWebhookPayload,
  ZernioWebhookConversation,
  ZernioWebhookAccount,
  ZernioWebhookMetadata,
  ZernioAttachment,
  ZernioSender,
  ZernioSendMessageBody,
  ZernioConversation,
  ZernioMessageListResponse,
  ZernioConversationListResponse,
} from "./types.js";
