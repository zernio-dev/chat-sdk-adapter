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
  type: "image" | "video" | "audio" | "file" | "sticker" | "share" | "location" | "contact";
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
  /**
   * Webhook envelope metadata, copied onto the raw message by the adapter so
   * handlers can read interactive replies (button/list/flow), ad referral, and
   * quoted-message context off `message.raw.metadata` (the chat-sdk
   * MessageMetadata type is fixed and has no room for these).
   */
  metadata?: ZernioWebhookMetadata;
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

  // ─── WhatsApp interactive replies ──────────────────────────────────────────
  // When a recipient taps a reply button, picks a list row, or submits a Flow,
  // WhatsApp delivers it as a normal message.received whose interactive context
  // lands here. `interactiveId` carries the button/row id you set when sending.
  /** Kind of interactive reply the inbound message represents. */
  interactiveType?: "button_reply" | "list_reply" | "nfm_reply";
  /** The id of the tapped reply button or selected list row. */
  interactiveId?: string;
  /** Payload for a tapped template button (quick_reply/url template buttons). */
  buttonPayload?: string;
  /** Raw JSON string returned by a WhatsApp Flow (`nfm_reply`). */
  flowResponseJson?: string;
  /** Parsed Flow response, when `flowResponseJson` was valid JSON. */
  flowResponseData?: Record<string, unknown>;
  /** Platform message id this message quotes/replies to, when present. */
  quotedMessageId?: string;
  /** Click-to-WhatsApp / Click-to-Messenger ad attribution, when the conversation started from an ad. */
  referral?: ZernioReferral;
}

/**
 * Ad-referral attribution attached to an inbound message when the conversation
 * was started from a Click-to-WhatsApp (CTWA), Click-to-Messenger (CTM), or
 * Click-to-Instagram-Direct (CTD) ad. Fields are platform-dependent, so all are
 * optional — read what's present.
 */
export interface ZernioReferral {
  // Click-to-WhatsApp
  ctwa_clid?: string;
  source_id?: string;
  source_type?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  // Facebook Messenger CTM / Instagram CTD
  ad_id?: string;
  ref?: string;
  source?: string;
  type?: string;
  ads_context_data?: Record<string, unknown>;
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
  attachmentType?: "image" | "video" | "audio" | "file" | "sticker";
  quickReplies?: Array<{ type: string; payload: string; title?: string }>;
  buttons?: Array<{
    type: string;
    title: string;
    payload?: string;
    url?: string;
    phone?: string;
  }>;
  template?:
    | {
        type: "generic";
        elements: Array<{
          title: string;
          subtitle?: string;
          imageUrl?: string;
          buttons?: Array<{ type: string; title: string; url?: string; payload?: string }>;
        }>;
      }
    | {
        // WhatsApp approved template message (different from the FB/IG generic
        // carousel above). The API discriminates on the elements[0] shape.
        elements: [WhatsAppTemplate];
      };
  /** WhatsApp interactive message (buttons, list, cta_url, flow, location request, voice call). */
  interactive?: WhatsAppInteractive;
  /** WhatsApp location pin. */
  location?: WhatsAppLocation;
  /** WhatsApp contact cards (vCard). */
  contacts?: WhatsAppContact[];
  /** Send the attached audio as a WhatsApp voice note (PTT) rather than a file. */
  isVoiceNote?: boolean;
  replyMarkup?: unknown;
  messagingType?: string;
  messageTag?: string;
  /** Platform message id to quote/reply to (WhatsApp `context.message_id`). */
  replyTo?: string;
}

// ─── WhatsApp message content types ───────────────────────────────────────────

/** A WhatsApp location pin. */
export interface WhatsAppLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/** A WhatsApp contact card (vCard). */
export interface WhatsAppContact {
  name: { formatted_name: string; first_name?: string; last_name?: string };
  phones?: Array<{ phone: string; type?: string }>;
  emails?: Array<{ email: string; type?: string }>;
}

/** An approved WhatsApp template message element. */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  components?: Array<Record<string, unknown>>;
}

/** Header for an interactive message (text or media). */
export interface WhatsAppInteractiveHeader {
  type: "text" | "image" | "video" | "document";
  text?: string;
  image?: { link: string };
  video?: { link: string };
  document?: { link: string; filename?: string };
}

/**
 * The `interactive` payload sent to the Zernio messages endpoint. Mirrors the
 * WhatsApp Cloud API interactive object: reply buttons, list, cta_url, flow,
 * location request, and voice-call button.
 */
export type WhatsAppInteractive =
  | {
      type: "button";
      header?: WhatsAppInteractiveHeader;
      body: { text: string };
      footer?: { text: string };
      action: { buttons: Array<{ type: "reply"; reply: { id: string; title: string } }> };
    }
  | {
      type: "list";
      header?: WhatsAppInteractiveHeader;
      body: { text: string };
      footer?: { text: string };
      action: {
        button: string;
        sections: Array<{
          title?: string;
          rows: Array<{ id: string; title: string; description?: string }>;
        }>;
      };
    }
  | {
      type: "cta_url";
      header?: WhatsAppInteractiveHeader;
      body: { text: string };
      footer?: { text: string };
      action: { name: "cta_url"; parameters: { display_text: string; url: string } };
    }
  | {
      type: "flow";
      header?: WhatsAppInteractiveHeader;
      body: { text: string };
      footer?: { text: string };
      action: {
        name: "flow";
        parameters: {
          flow_message_version?: "3";
          flow_token: string;
          flow_id: string;
          flow_cta: string;
          flow_action: "navigate" | "data_exchange";
          flow_action_payload?: { screen: string; data?: Record<string, unknown> };
          mode?: "draft";
        };
      };
    }
  | {
      type: "location_request_message";
      body: { text: string };
      action?: { name: "send_location" };
    }
  | {
      type: "voice_call";
      body: { text: string };
      action: {
        name: "voice_call";
        parameters?: { display_text?: string; ttl_minutes?: number; payload?: string };
      };
    };

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

/**
 * Body for POST /v1/inbox/conversations — cold-start a conversation from a
 * recipient. WhatsApp requires an approved template (`templateName` +
 * `templateLanguage`) since you can't open outside the 24h window without one;
 * other platforms can open with a plain `message`.
 */
export interface ZernioCreateConversationBody {
  accountId: string;
  /** Recipient handle: phone/E.164 for WhatsApp, platform user id otherwise. */
  participantId?: string;
  participantUsername?: string;
  message?: string;
  /** WhatsApp approved template name (required for WhatsApp cold-start). */
  templateName?: string;
  /** WhatsApp template language code (e.g. "en_US"). */
  templateLanguage?: string;
  /** Ordered template body variable values. */
  templateParams?: string[];
}

/** Response data from POST /v1/inbox/conversations. */
export interface ZernioCreateConversationData {
  messageId: string;
  conversationId: string;
  participantId: string;
  participantName: string;
}
