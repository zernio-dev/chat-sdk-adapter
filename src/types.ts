/**
 * Type definitions for the Zernio Chat SDK adapter.
 *
 * These types mirror the Zernio API webhook payloads and REST API shapes,
 * providing type-safe interaction between chat-sdk and the Zernio platform.
 */

// ─── Adapter Config ─────────────────────────────────────────────────────────

/** Configuration for the Zernio adapter. */
export interface ZernioConfig {
  /** Zernio API key (Bearer token) for outbound REST API calls. */
  apiKey: string;

  /** HMAC-SHA256 secret for verifying inbound webhook signatures. Optional but strongly recommended. */
  webhookSecret?: string;

  /** Base URL for the Zernio API. Defaults to "https://zernio.com/api". */
  baseUrl?: string;

  /** Display name for the bot in chat-sdk. Defaults to "Zernio Bot". */
  botName?: string;
}

// ─── Thread ID ──────────────────────────────────────────────────────────────

/**
 * Decoded thread ID components.
 * Thread IDs are encoded as "zernio:{accountId}:{conversationId}".
 * The accountId is required for every Zernio API call, so it must live in the thread ID.
 */
export interface ZernioThreadId {
  /** Zernio social account ID (MongoDB ObjectId as hex string). */
  accountId: string;

  /** Zernio conversation ID (MongoDB ObjectId or platform-specific ID). */
  conversationId: string;
}

// ─── Webhook Payload Types ──────────────────────────────────────────────────

/** Attachment included in a message. */
export interface ZernioAttachment {
  type: "image" | "video" | "audio" | "file" | "sticker" | "share";
  url: string;
  payload?: Record<string, unknown>;
}

/** Sender information from the webhook payload. */
export interface ZernioSender {
  id: string;
  name?: string;
  username?: string;
  picture?: string;
  phoneNumber?: string;
  instagramProfile?: {
    isFollower: boolean | null;
    isFollowing: boolean | null;
    followerCount: number | null;
    isVerified: boolean | null;
  };
}

/** The message object inside a message.received webhook payload. */
export interface ZernioRawMessage {
  id: string;
  conversationId: string;
  platform: string;
  platformMessageId: string;
  direction: "incoming" | "outgoing";
  text: string | null;
  attachments: ZernioAttachment[];
  sender: ZernioSender;
  sentAt: string;
  isRead: boolean;
}

/** Conversation context from the webhook payload. */
export interface ZernioWebhookConversation {
  id: string;
  platformConversationId: string;
  participantId?: string;
  participantName?: string;
  participantUsername?: string;
  participantPicture?: string;
  status: "active" | "archived";
}

/** Account context from the webhook payload. */
export interface ZernioWebhookAccount {
  id: string;
  platform: string;
  username: string;
  displayName?: string;
}

/** Optional metadata for platform-specific message extras. */
export interface ZernioWebhookMetadata {
  quickReplyPayload?: string;
  postbackPayload?: string;
  postbackTitle?: string;
  callbackData?: string;
}

/** Full message.received webhook payload envelope. */
export interface ZernioWebhookPayload {
  id: string;
  event: "message.received";
  timestamp: string;
  message: ZernioRawMessage;
  conversation: ZernioWebhookConversation;
  account: ZernioWebhookAccount;
  metadata?: ZernioWebhookMetadata;
}

/** Comment author from the comment.received webhook payload. */
export interface ZernioCommentAuthor {
  id: string;
  username?: string;
  name?: string;
  picture?: string;
}

/** Comment data from the comment.received webhook payload. */
export interface ZernioWebhookComment {
  id: string;
  postId: string;
  platformPostId: string;
  platform: string;
  text: string;
  author: ZernioCommentAuthor;
  createdAt: string;
  isReply: boolean;
  parentCommentId: string | null;
}

/**
 * Full reaction.received webhook payload envelope.
 *
 * Fired when a participant adds or removes an emoji reaction (WhatsApp, Telegram).
 * Distinct from message.received so reactions route to chat-sdk's onReaction
 * instead of being mistaken for an inbound DM.
 */
export interface ZernioReactionWebhookPayload {
  id: string;
  event: "reaction.received";
  timestamp: string;
  reaction: {
    /** The emoji reacted with. May be empty on `removed` (WhatsApp). */
    emoji: string;
    action: "added" | "removed";
    /** Zernio Message id of the reacted-to message, when resolvable. */
    messageId?: string;
    /** Platform-native id of the reacted-to message (e.g. WhatsApp wamid). */
    platformMessageId: string;
    sender: ZernioSender;
    reactedAt: string;
  };
  conversation: ZernioWebhookConversation;
  account: ZernioWebhookAccount;
}

/** Full comment.received webhook payload envelope. */
export interface ZernioCommentWebhookPayload {
  id: string;
  event: "comment.received";
  timestamp: string;
  comment: ZernioWebhookComment;
  post: { id: string; platformPostId: string };
  account: { id: string; platform: string; username: string };
}

// ─── API Request/Response Types ─────────────────────────────────────────────

/** Body for POST /v1/inbox/conversations/{conversationId}/messages. */
export interface ZernioSendMessageBody {
  accountId: string;
  message?: string;
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "audio" | "file";
  quickReplies?: Array<{ type: string; payload: string; title?: string }>;
  buttons?: Array<{
    type: string;
    title: string;
    payload?: string;
    url?: string;
    phone?: string;
  }>;
  template?: {
    type: "generic";
    elements: Array<{
      title: string;
      subtitle?: string;
      imageUrl?: string;
      buttons?: Array<{ type: string; title: string; url?: string; payload?: string }>;
    }>;
  };
  replyMarkup?: unknown;
  messagingType?: string;
  messageTag?: string;
  replyTo?: string;
}

/** Conversation data returned from the Zernio API. */
export interface ZernioConversation {
  id: string;
  accountId: string;
  platform: string;
  status: string;
  participantName?: string;
  participantUsername?: string;
  participantPicture?: string;
  participantId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  updatedTime?: string;
}

/**
 * A message as returned by the REST `GET /messages` LIST endpoint.
 *
 * IMPORTANT: this is a DIFFERENT shape from the webhook `ZernioRawMessage`.
 * The REST endpoint flattens the sender (`senderId` / `senderName` instead of a
 * nested `sender` object), names the body `message` (not `text`), and uses
 * `createdAt` (not `sentAt`). The adapter normalizes this into `ZernioRawMessage`
 * before parsing (see `ZernioAdapter.restToRawMessage`). Conflating the two shapes
 * was the cause of GitHub issue #3 (fetchMessages threw on `raw.sender.id`).
 */
export interface ZernioRestMessage {
  id: string;
  conversationId?: string;
  accountId?: string;
  platform?: string;
  /** The message body. REST uses `message`; webhook uses `text`. */
  message?: string | null;
  senderId?: string;
  senderName?: string;
  senderPhoneNumber?: string;
  direction: "incoming" | "outgoing";
  /** REST uses `createdAt`; webhook uses `sentAt`. Both are ISO strings. */
  createdAt?: string;
  sentAt?: string;
  attachments?: Array<{
    id?: string;
    type: string;
    url?: string;
    mimeType?: string;
    name?: string;
    payload?: Record<string, unknown>;
  }>;
  isRead?: boolean;
}

/** Response from GET /v1/inbox/conversations/{conversationId}/messages. */
export interface ZernioMessageListResponse {
  status: string;
  messages: ZernioRestMessage[];
  /** Present when the endpoint paginates. `nextCursor` is opaque (db:/live: prefixed). */
  pagination?: { hasMore: boolean; nextCursor: string | null };
  /** Order the endpoint actually applied (live-API platforms may ignore the request). */
  sortOrderApplied?: "asc" | "desc";
  lastUpdated: string;
}

/** Paginated response from GET /v1/inbox/conversations. */
export interface ZernioConversationListResponse {
  data: ZernioConversation[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}
