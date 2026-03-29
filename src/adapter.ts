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
import { mapCardToZernioMessage } from "./card-mapper.js";
import { verifyWebhookSignature, extractWebhookHeaders } from "./webhook.js";
import type {
  ZernioConfig,
  ZernioRawMessage,
  ZernioThreadId,
  ZernioWebhookPayload,
  ZernioCommentWebhookPayload,
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
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.error("Adapter not initialized: chat instance is null");
      return new Response("Adapter not initialized", { status: 500 });
    }

    // Route based on event type
    if (payload.event === "message.received") {
      return this.handleMessageReceived(payload as ZernioWebhookPayload, options);
    }

    if (payload.event === "comment.received") {
      return this.handleCommentReceived(payload as ZernioCommentWebhookPayload, options);
    }

    // Unhandled event type, acknowledge receipt
    return new Response("OK", { status: 200 });
  }

  /**
   * Handle a message.received webhook event.
   * Filters out outgoing messages to prevent echo loops.
   */
  private handleMessageReceived(
    payload: ZernioWebhookPayload,
    options?: WebhookOptions,
  ): Response {
    // Skip outgoing messages to prevent infinite loops (bot's own replies echoed back)
    if (payload.message.direction !== "incoming") {
      return new Response("OK", { status: 200 });
    }

    const threadId = this.encodeThreadId({
      accountId: payload.account.id,
      conversationId: payload.message.conversationId,
    });

    const factory = async (): Promise<Message<ZernioRawMessage>> => {
      return this.parseMessage(payload.message);
    };

    this.chat!.processMessage(this, threadId, factory, options);
    return new Response("OK", { status: 200 });
  }

  /**
   * Handle a comment.received webhook event.
   * Routes post comments through chat-sdk handlers using a comment-specific thread ID.
   * Thread ID format: "zernio:{accountId}:comment:{postId}"
   */
  private handleCommentReceived(
    payload: ZernioCommentWebhookPayload,
    options?: WebhookOptions,
  ): Response {
    const threadId = this.encodeThreadId({
      accountId: payload.account.id,
      conversationId: `comment:${payload.comment.postId}`,
    });

    const factory = async (): Promise<Message<ZernioRawMessage>> => {
      // Map comment data to a ZernioRawMessage-compatible shape
      const syntheticMessage: ZernioRawMessage = {
        id: payload.comment.id,
        conversationId: `comment:${payload.comment.postId}`,
        platform: payload.comment.platform,
        platformMessageId: payload.comment.id,
        direction: "incoming",
        text: payload.comment.text,
        attachments: [],
        sender: {
          id: payload.comment.author.id,
          name: payload.comment.author.name,
          username: payload.comment.author.username,
          picture: payload.comment.author.picture,
        },
        sentAt: payload.comment.createdAt,
        isRead: false,
      };
      return this.parseMessage(syntheticMessage);
    };

    this.chat!.processMessage(this, threadId, factory, options);
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
   * Handles all AdapterPostableMessage types:
   * - Cards: mapped to Zernio buttons/templates via card-mapper (renders natively
   *   on Facebook, Instagram, Telegram, WhatsApp; falls back to text on others)
   * - Markdown/AST/string: rendered via format converter
   * - Files: uploaded via media upload endpoint if available, otherwise warns
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<ZernioRawMessage>> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);

    // Extract card and file content from the message
    const card = extractCard(message);
    const files = extractFiles(message);

    // Build the send body based on message type
    const body: Record<string, unknown> = { accountId };

    if (card) {
      // Map card to native Zernio rich message format (buttons, templates)
      const mapped = mapCardToZernioMessage(card as any);
      body.message = mapped.message || undefined;
      if (mapped.buttons) body.buttons = mapped.buttons;
      if (mapped.template) body.template = mapped.template;
    } else {
      // Plain text / markdown / AST
      body.message = this.converter.renderPostable(message) || undefined;
    }

    // Handle file uploads: try media upload endpoint, fall back to warning
    if (files.length > 0) {
      try {
        const uploaded = await this.api.uploadMedia(files[0].data, files[0].mimeType);
        body.attachmentUrl = uploaded.url;
        body.attachmentType = files[0].mimeType?.startsWith("image/")
          ? "image"
          : files[0].mimeType?.startsWith("video/")
            ? "video"
            : files[0].mimeType?.startsWith("audio/")
              ? "audio"
              : "file";
      } catch {
        this.logger.warn(
          "File upload failed. The /v1/media/upload endpoint may not be available yet. " +
          "Use the ZernioApiClient directly with attachmentUrl for file sending.",
        );
      }
    }

    // Send the message
    const result = await this.api.sendMessage(conversationId, body as any);
    const messageId = (result.messageId as string) ?? (result.id as string) ?? "";

    // Send additional file attachments as separate messages (one per request)
    for (let i = 1; i < files.length; i++) {
      try {
        const uploaded = await this.api.uploadMedia(files[i].data, files[i].mimeType);
        await this.api.sendMessage(conversationId, {
          accountId,
          attachmentUrl: uploaded.url,
          attachmentType: files[i].mimeType?.startsWith("image/")
            ? "image"
            : files[i].mimeType?.startsWith("video/")
              ? "video"
              : files[i].mimeType?.startsWith("audio/")
                ? "audio"
                : "file",
        });
      } catch {
        // Skip failed uploads for additional attachments
      }
    }

    // Return a synthetic RawMessage since the Zernio API doesn't return the full message object
    const sentText = (body.message as string) ?? "";
    return {
      id: messageId,
      threadId,
      raw: {
        id: messageId,
        conversationId,
        platform: "",
        platformMessageId: "",
        direction: "outgoing",
        text: sentText,
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
   * Delete a message from a conversation.
   * Supported on: Telegram (full delete), X/Twitter (full delete),
   * Bluesky and Reddit (delete for self only).
   * Unsupported on: Facebook, Instagram, WhatsApp (API returns 400).
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    await this.api.deleteMessage(conversationId, messageId, accountId);
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  /**
   * Add a reaction to a message.
   * Supported on: Telegram (emoji reactions), WhatsApp (emoji reactions).
   * Unsupported on other platforms (API returns 400).
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    const emojiStr = typeof emoji === "string" ? emoji : emoji.name;
    await this.api.addReaction(conversationId, messageId, accountId, emojiStr);
  }

  /**
   * Remove a reaction from a message.
   * Supported on: Telegram (send empty reaction), WhatsApp (send empty emoji).
   * Unsupported on other platforms (API returns 400).
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    await this.api.removeReaction(conversationId, messageId, accountId);
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
   * Show a typing indicator.
   * Supported on: Facebook Messenger (sender_action), Telegram (sendChatAction).
   * No-op on platforms without typing indicator support.
   */
  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);
    try {
      await this.api.sendTyping(conversationId, accountId);
    } catch {
      // Silently ignore errors (typing indicators are best-effort)
    }
  }

  // ─── Streaming ──────────────────────────────────────────────────────────

  /**
   * Stream AI responses using post-then-edit pattern.
   * Posts an initial message, then edits it as tokens arrive.
   *
   * Works on Telegram (supports message editing). On other platforms,
   * collects the full stream and posts once since editing isn't supported.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | import("chat").StreamChunk>,
    options?: import("chat").StreamOptions,
  ): Promise<RawMessage<ZernioRawMessage>> {
    const { accountId, conversationId } = this.decodeThreadId(threadId);

    // Helper to extract text from a chunk (string or StreamChunk)
    const chunkToText = (chunk: string | import("chat").StreamChunk): string => {
      if (typeof chunk === "string") return chunk;
      if (chunk.type === "markdown_text") return chunk.text;
      return "";
    };

    // Collect the first chunk to have initial content
    let buffer = "";
    const iterator = textStream[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (!first.done) buffer = chunkToText(first.value);

    // Post initial message
    const result = await this.api.sendMessage(conversationId, {
      accountId,
      message: buffer || "...",
    });
    const messageId = (result.messageId as string) ?? (result.id as string) ?? "";

    // Stream remaining chunks via edit (throttled to avoid rate limits)
    let lastEditTime = 0;
    const EDIT_INTERVAL_MS = 500;

    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      buffer += chunkToText(next.value);
      const now = Date.now();
      if (now - lastEditTime >= EDIT_INTERVAL_MS) {
        try {
          await this.api.editMessage(conversationId, messageId, {
            accountId,
            message: buffer,
          });
          lastEditTime = now;
        } catch {
          // Edit failed (platform doesn't support it), continue collecting
        }
      }
    }

    // Final edit with complete text
    try {
      await this.api.editMessage(conversationId, messageId, {
        accountId,
        message: buffer,
      });
    } catch {
      // If edit fails, the last successful edit or initial post is the final state
    }

    return {
      id: messageId,
      threadId,
      raw: {
        id: messageId,
        conversationId,
        platform: "",
        platformMessageId: "",
        direction: "outgoing",
        text: buffer,
        attachments: [],
        sender: { id: "bot" },
        sentAt: new Date().toISOString(),
        isRead: true,
      },
    };
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
