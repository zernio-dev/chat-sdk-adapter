/**
 * Core Zernio adapter for Chat SDK.
 *
 * Bridges chat-sdk's unified chatbot framework with Zernio's multi-platform
 * inbox API. A single Zernio adapter replaces what would otherwise require
 * separate adapters for Instagram, Facebook, Twitter/X, Telegram, WhatsApp,
 * Bluesky, and Reddit.
 *
 * Thread ID format: "zernio:{accountId}:{conversationId}"
 * Channel ID: accountId (one social account = one channel)
 */

import {
  ConsoleLogger,
  Message,
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import {
  AdapterError,
  ValidationError,
  extractCard,
  extractFiles,
  cardToFallbackText,
} from "@chat-adapter/shared";
import { ZernioApiClient } from "./api-client.js";
import { ZernioFormatConverter } from "./format-converter.js";
import { verifyWebhookSignature, extractWebhookHeaders } from "./webhook.js";
import type {
  ZernioConfig,
  ZernioRawMessage,
  ZernioThreadId,
  ZernioWebhookPayload,
} from "./types.js";

/** Prefix used in all Zernio thread IDs. */
const THREAD_PREFIX = "zernio";

export class ZernioAdapter implements Adapter<ZernioThreadId, ZernioRawMessage> {
  readonly name = "zernio";
  readonly userName: string;
  readonly persistMessageHistory = false;

  /** Reference to the chat-sdk instance, set during initialize(). */
  private chat: ChatInstance | null = null;

  /** Logger instance, upgraded to chat-sdk scoped logger during initialize(). */
  private logger: Logger;

  /** HTTP client for Zernio REST API calls. */
  private api: ZernioApiClient;

  /** Resolved configuration with defaults applied. */
  private config: {
    apiKey: string;
    webhookSecret: string;
    baseUrl: string;
    botName: string;
  };

  /** Format converter for markdown passthrough. */
  private converter: ZernioFormatConverter;

  constructor(config: ZernioConfig & { logger?: Logger }) {
    this.config = {
      apiKey: config.apiKey,
      webhookSecret: config.webhookSecret ?? "",
      baseUrl: config.baseUrl ?? "https://api.zernio.com",
      botName: config.botName ?? "Zernio Bot",
    };
    this.userName = this.config.botName;
    this.logger = config.logger ?? new ConsoleLogger();
    this.api = new ZernioApiClient(this.config.apiKey, this.config.baseUrl);
    this.converter = new ZernioFormatConverter();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Called once when the Chat instance initializes.
   * Stores the chat-sdk instance reference and configures the scoped logger.
   * No async setup needed since Zernio uses stateless REST API calls.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger("zernio");
  }

  // ─── Webhook Handling ───────────────────────────────────────────────────────

  /**
   * Handle an incoming Zernio webhook request.
   *
   * Flow:
   * 1. Read body as raw text (for signature verification)
   * 2. Verify HMAC-SHA256 signature if webhookSecret is configured
   * 3. Parse the JSON payload
   * 4. Filter: only process message.received events with direction=incoming
   * 5. Call chat.processMessage() which handles waitUntil internally
   * 6. Return a fast 200 OK
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    // Read body as raw text first to preserve exact bytes for signature verification
    const rawBody = await request.text();

    // Verify signature if a webhook secret is configured
    if (this.config.webhookSecret) {
      const { signature } = extractWebhookHeaders(request);
      if (!signature || !verifyWebhookSignature(rawBody, signature, this.config.webhookSecret)) {
        this.logger.warn("Webhook signature verification failed");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Parse the webhook payload
    let payload: ZernioWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Only process incoming message.received events
    // Skip outgoing messages to prevent infinite loops (bot's own replies echoed back)
    if (payload.event !== "message.received" || payload.message.direction !== "incoming") {
      return new Response("OK", { status: 200 });
    }

    if (!this.chat) {
      this.logger.error("Adapter not initialized: chat instance is null");
      return new Response("Adapter not initialized", { status: 500 });
    }

    // Encode the thread ID from the webhook's account and conversation data
    const threadId = this.encodeThreadId({
      accountId: payload.account.id,
      conversationId: payload.message.conversationId,
    });

    // Use a lazy async factory function (only called if message isn't deduplicated)
    const factory = async (): Promise<Message<ZernioRawMessage>> => {
      return this.parseMessage(payload.message);
    };

    // processMessage handles waitUntil registration internally
    this.chat.processMessage(this, threadId, factory, options);

    // Return a fast 200 to acknowledge receipt
    return new Response("OK", { status: 200 });
  }

  // ─── Thread ID Encoding ───────────────────────────────────────────────────

  /**
   * Encode platform data into a thread ID string.
   * Format: "zernio:{accountId}:{conversationId}"
   */
  encodeThreadId(data: ZernioThreadId): string {
    return `${THREAD_PREFIX}:${data.accountId}:${data.conversationId}`;
  }

  /**
   * Decode a thread ID string back to platform data.
   * Validates the prefix and format.
   */
  decodeThreadId(threadId: string): ZernioThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== THREAD_PREFIX) {
      throw new ValidationError(
        "zernio",
        `Invalid Zernio thread ID format: "${threadId}". Expected "zernio:{accountId}:{conversationId}".`,
      );
    }
    return {
      accountId: parts[1],
      // Join remaining parts in case conversationId contains colons (unlikely but safe)
      conversationId: parts.slice(2).join(":"),
    };
  }

  /**
   * Derive the channel ID from a thread ID.
   * In Zernio's model, one social account = one channel.
   */
  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).accountId;
  }

  // ─── Message Parsing ──────────────────────────────────────────────────────

  /**
   * Convert a Zernio raw message into a normalized chat-sdk Message.
   * Maps sender info to Author, attachments to Attachment[], and text to formatted AST.
   */
  parseMessage(raw: ZernioRawMessage): Message<ZernioRawMessage> {
    const text = raw.text ?? "";

    return new Message<ZernioRawMessage>({
      id: raw.id,
      threadId: "",  // Set by chat-sdk's processMessage
      text,
      formatted: this.converter.toAst(text),
      raw,
      author: {
        userId: raw.sender.id,
        userName: raw.sender.username ?? raw.sender.id,
        fullName: raw.sender.name ?? "",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date(raw.sentAt),
        edited: false,
      },
      attachments: raw.attachments.map((att) => ({
        type: att.type as "image" | "video" | "audio" | "file",
        url: att.url,
      })),
    });
  }

  // ─── Messaging ────────────────────────────────────────────────────────────

  /**
   * Send a message to a Zernio conversation.
   *
   * Uses the format converter's renderPostable() to handle all message types
   * (string, markdown, AST, cards). Extracts file attachments via extractFiles()
   * and sends them as attachment URLs.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<ZernioRawMessage>> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);

    // Extract card and file content from the message
    const card = extractCard(message);
    const files = extractFiles(message);

    // Render text content using the format converter
    const text = card
      ? cardToFallbackText(card)
      : this.converter.renderPostable(message);

    // Log a warning if files are attached (Zernio API requires URLs, not raw buffers)
    // File attachments via chat-sdk use Buffer data; consumers should use attachmentUrl
    // directly through the ZernioApiClient for file sending.
    if (files.length > 0) {
      this.logger.warn(
        "File attachments via chat-sdk use binary data which cannot be sent through the Zernio REST API. " +
        "Use the ZernioApiClient directly with attachmentUrl for file sending.",
      );
    }

    // Send the message
    const result = await this.api.sendMessage(conversationId, {
      accountId,
      message: text || undefined,
    });
    const messageId = (result.messageId as string) ?? (result.id as string) ?? "";

    // Return a synthetic RawMessage since the Zernio API doesn't return the full message object
    return {
      id: messageId,
      threadId,
      raw: {
        id: messageId,
        conversationId,
        platform: "",
        platformMessageId: "",
        direction: "outgoing",
        text,
        attachments: [],
        sender: { id: "bot" },
        sentAt: new Date().toISOString(),
        isRead: true,
      },
    };
  }

  /**
   * Edit an existing message in a conversation.
   * Uses renderPostable() for consistent message text resolution.
   *
   * Note: Only Telegram supports editing. The Zernio API enforces this constraint
   * and returns an error for non-Telegram accounts.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<ZernioRawMessage>> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    const text = this.converter.renderPostable(message);

    await this.api.editMessage(conversationId, messageId, {
      accountId,
      message: text || undefined,
    });

    return {
      id: messageId,
      threadId,
      raw: {
        id: messageId,
        conversationId,
        platform: "",
        platformMessageId: "",
        direction: "outgoing",
        text,
        attachments: [],
        sender: { id: "bot" },
        sentAt: new Date().toISOString(),
        isRead: true,
      },
    };
  }

  /**
   * Delete a message. Not supported by the Zernio API.
   */
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new AdapterError("Message deletion is not supported by the Zernio API", "zernio");
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  /**
   * Add a reaction to a message. Not supported by the Zernio API.
   */
  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new AdapterError("Reactions are not supported by the Zernio API", "zernio");
  }

  /**
   * Remove a reaction from a message. Not supported by the Zernio API.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new AdapterError("Reactions are not supported by the Zernio API", "zernio");
  }

  // ─── Fetching ─────────────────────────────────────────────────────────────

  /**
   * Fetch messages for a conversation.
   * Returns all messages (no cursor pagination on the Zernio messages endpoint currently).
   * Messages are returned in chronological order (oldest first).
   */
  async fetchMessages(
    threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<ZernioRawMessage>> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    const response = await this.api.fetchMessages(conversationId, accountId);

    const messages = response.messages.map((raw) => this.parseMessage(raw));

    return {
      messages,
      nextCursor: undefined,
    };
  }

  /**
   * Fetch thread (conversation) metadata.
   * Returns conversation info including platform, participant details, and DM flag.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    const conversation = await this.api.fetchConversation(conversationId, accountId);

    return {
      id: threadId,
      channelId: accountId,
      channelName: conversation.participantName ?? conversation.participantUsername,
      isDM: true,  // All Zernio inbox conversations are direct messages
      metadata: {
        platform: conversation.platform,
        status: conversation.status,
        participantId: conversation.participantId,
        participantName: conversation.participantName,
        participantUsername: conversation.participantUsername,
        participantPicture: conversation.participantPicture,
      },
    };
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  /**
   * Show a typing indicator. Not supported by the Zernio API (no-op).
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // No-op: Zernio API doesn't expose typing indicators
  }

  // ─── Formatting ───────────────────────────────────────────────────────────

  /**
   * Render a formatted AST to platform text.
   * Delegates to the format converter (markdown passthrough).
   */
  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  // ─── Optional Methods ─────────────────────────────────────────────────────

  /**
   * Check if a thread is a direct message.
   * All Zernio inbox conversations are DMs.
   */
  isDM(_threadId: string): boolean {
    return true;
  }
}
