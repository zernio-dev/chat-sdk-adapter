/**
 * Factory function for creating a Zernio adapter instance.
 *
 * Follows the chat-sdk convention (e.g., createSlackAdapter(), createDiscordAdapter()).
 * Supports environment variable fallbacks for zero-config deployment.
 *
 * Environment variables:
 * - ZERNIO_API_KEY: API key for Zernio REST API calls (required)
 * - ZERNIO_WEBHOOK_SECRET: HMAC-SHA256 secret for webhook verification (recommended)
 * - ZERNIO_API_BASE_URL: Override the API base URL (default: https://api.zernio.com)
 * - ZERNIO_BOT_NAME: Bot display name (default: "Zernio Bot")
 */

import type { Logger } from "chat";
import { ValidationError } from "@chat-adapter/shared";
import { ZernioAdapter } from "./adapter.js";
import type { ZernioConfig } from "./types.js";

/**
 * Create a Zernio adapter for use with Chat SDK.
 *
 * @param config - Adapter configuration. All fields fall back to environment variables.
 * @returns A configured ZernioAdapter instance.
 * @throws ValidationError if no API key is provided via config or environment variable.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createZernioAdapter } from "@zernio/chat-sdk-adapter";
 *
 * const bot = new Chat({
 *   adapters: {
 *     zernio: createZernioAdapter(),
 *   },
 *   onNewMessage: async ({ thread, message }) => {
 *     await thread.post(`You said: ${message.text}`);
 *   },
 * });
 * ```
 */
export function createZernioAdapter(
  config?: Partial<ZernioConfig> & { logger?: Logger },
): ZernioAdapter {
  const apiKey = config?.apiKey ?? process.env.ZERNIO_API_KEY;

  if (!apiKey) {
    throw new ValidationError(
      "zernio",
      "Zernio API key is required. Pass it via config.apiKey or set the ZERNIO_API_KEY environment variable.",
    );
  }

  return new ZernioAdapter({
    apiKey,
    webhookSecret: config?.webhookSecret ?? process.env.ZERNIO_WEBHOOK_SECRET,
    baseUrl: config?.baseUrl ?? process.env.ZERNIO_API_BASE_URL ?? "https://api.zernio.com",
    botName: config?.botName ?? process.env.ZERNIO_BOT_NAME ?? "Zernio Bot",
    logger: config?.logger,
  });
}
