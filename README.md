# @zernio/chat-sdk-adapter

[![npm](https://img.shields.io/npm/v/@zernio/chat-sdk-adapter)](https://www.npmjs.com/package/@zernio/chat-sdk-adapter) [![Listed on chat-sdk.dev](https://img.shields.io/badge/chat--sdk.dev-vendor%20official-black)](https://chat-sdk.dev/adapters/zernio) [![CI](https://github.com/zernio-dev/chat-sdk-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/zernio-dev/chat-sdk-adapter/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official [Zernio](https://zernio.com) adapter for [Chat SDK](https://chat-sdk.dev). Build chatbots that work across **Instagram, Facebook, Twitter/X, Telegram, WhatsApp, Bluesky, and Reddit** through a single integration.

Even with native Chat SDK adapters for each platform, you'd still need to apply to Meta's developer program, go through App Review, get WhatsApp Business verification, apply for X elevated access, and more. With Zernio, your users connect accounts in a dashboard and you get one API key. No developer programs, no app reviews, no token management.

## Installation

```bash
npm install @zernio/chat-sdk-adapter chat @chat-adapter/state-memory
```

> For production, swap `@chat-adapter/state-memory` for a persistent state adapter like `@chat-adapter/state-redis` or `@chat-adapter/state-pg`. See [State Adapters](https://chat-sdk.dev/docs/state) for all options.

## Quick Start

```typescript
import { Chat } from "chat";
import { createZernioAdapter } from "@zernio/chat-sdk-adapter";
import { createMemoryState } from "@chat-adapter/state-memory";

export const bot = new Chat({
  userName: "pizza-bot",
  adapters: {
    zernio: createZernioAdapter(),
  },
  state: createMemoryState(),
});

// Register a handler. The pattern is a RegExp — use /.*/ to match every message.
bot.onNewMessage(/.*/, async (thread, message) => {
  // This handler fires for messages from ALL connected platforms
  const platform = (message.raw as any).platform; // "instagram", "telegram", etc.
  await thread.post(`Hello from ${platform}!`);
});
```

### Next.js Webhook Route

```typescript
// app/api/chat-webhook/route.ts
import { bot } from "@/lib/bot";

export async function POST(request: Request) {
  return bot.webhooks.zernio(request);
}
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZERNIO_API_KEY` | Yes | Your Zernio API key for sending messages |
| `ZERNIO_WEBHOOK_SECRET` | Recommended | HMAC-SHA256 secret for verifying inbound webhooks |
| `ZERNIO_API_BASE_URL` | No | Override API base URL (default: `https://zernio.com/api`) |
| `ZERNIO_BOT_NAME` | No | Bot display name (default: `"Zernio Bot"`) |

### Explicit Configuration

```typescript
const adapter = createZernioAdapter({
  apiKey: "your-api-key",
  webhookSecret: "your-webhook-secret",
  baseUrl: "https://zernio.com/api",
  botName: "My Bot",
});
```

## Setup

### 1. Get a Zernio API Key

Sign up at [zernio.com](https://zernio.com) and create an API key from the dashboard. Make sure the key has **read-write** permissions.

### 2. Connect Social Accounts

Connect the social accounts you want your bot to handle through the Zernio dashboard or API.

### 3. Configure a Webhook

Create a webhook in your Zernio dashboard pointing to your bot's webhook endpoint:

- **URL**: `https://your-app.com/api/chat-webhook`
- **Events**: Select `message.received` and `comment.received`. Add `reaction.received` if you handle reactions (routes to `bot.onReaction`).
- **Secret**: Set a strong secret and pass it as `ZERNIO_WEBHOOK_SECRET`

### 4. Enable the Inbox Addon

The inbox addon must be enabled on your Zernio account to receive message webhooks.

## How It Works

```
Incoming message flow:
  User sends DM on Instagram/Telegram/etc.
    -> Platform delivers to Zernio
    -> Zernio fires message.received webhook
    -> Adapter verifies signature & parses payload
    -> chat-sdk processes message through your handlers

Outgoing message flow:
  Your handler calls thread.post("Hello!")
    -> Adapter calls Zernio REST API
    -> Zernio delivers to the correct platform
    -> User receives the message on Instagram/Telegram/etc.
```

## Thread ID Format

Thread IDs follow the format `zernio:{accountId}:{conversationId}`:

- `accountId`: The Zernio social account ID (which platform account received the message)
- `conversationId`: The Zernio conversation ID (the specific DM thread)
- For comments: `zernio:{accountId}:comment:{postId}`

```typescript
import { ZernioAdapter } from "@zernio/chat-sdk-adapter";

// Decode a thread ID to get platform-specific details
const adapter = new ZernioAdapter({ apiKey: "..." });
const { accountId, conversationId } = adapter.decodeThreadId(threadId);
```

## Supported Features

| Feature | Supported | Notes |
|---------|-----------|-------|
| Send messages | Yes | Text messages across all platforms |
| Rich messages (cards) | Yes | Buttons + templates on FB, IG, Telegram, WhatsApp; card `Select`/`RadioSelect` → WhatsApp interactive **list** |
| WhatsApp rich messages | Yes | Interactive lists, cta_url buttons, flows, location-request + voice-call buttons, location pins, contact cards, approved templates, quoted replies — via `ZernioApiClient` ([see below](#whatsapp-rich-messages)) |
| Inbound interactive replies | Yes | Button taps, list selections, and flow responses on `message.raw.metadata` ([see below](#inbound-interactive-replies)) |
| Open conversation by recipient | Yes | `openDM` / `openConversation` — cold-start a chat from a phone number ([see below](#opening-conversations)) |
| Edit messages | Partial | Telegram only |
| Delete messages | Partial | Telegram, X (full delete); Bluesky, Reddit (self-only) |
| Send reactions | Partial | Telegram and WhatsApp (add/remove emoji) |
| Receive reactions (`onReaction`) | Partial | WhatsApp, Telegram (via the `reaction.received` webhook) |
| Typing indicators | Partial | Facebook Messenger, Telegram, and WhatsApp (requires recent inbound message) |
| AI streaming | Partial | Post+edit on Telegram; single post on others |
| File attachments | Yes | Via media upload endpoint |
| Fetch messages | Yes | Full conversation history (supports `limit`, `cursor`, `direction`) |
| Fetch thread info | Yes | Participant details, platform, status |
| Webhook verification | Yes | HMAC-SHA256 signature |
| Comment webhooks | Yes | `comment.received` routed through handlers |

### Platform Support Matrix

| Feature | FB | IG | Telegram | WhatsApp | X | Bluesky | Reddit |
|---------|----|----|----------|----------|---|---------|--------|
| Send text | Y | Y | Y | Y | Y | Y | Y |
| Buttons | Y | Y | Y | Y | - | - | - |
| Lists | - | - | - | Y | - | - | - |
| Location / Contacts | - | - | - | Y | - | - | - |
| Templates / Flows | - | - | - | Y | - | - | - |
| Typing | Y | - | Y | Y | - | - | - |
| Delete | - | - | Y | - | Y | Self | Self |
| Reactions | - | - | Y | Y | - | - | - |
| Media | Y | Y | Y | Y | Y | - | - |
| Edit | - | - | Y | - | - | - | - |

## Rich Messages

The adapter maps chat-sdk `Card` elements to native platform formats instead of rendering as fallback text:

```typescript
import { Card, Button, Actions, CardText, LinkButton } from "chat";

await thread.post(
  Card({
    title: "Order #1234",
    subtitle: "Total: $50.00",
    imageUrl: "https://example.com/product.jpg",
    children: [
      CardText("Your order is ready for pickup."),
      Actions([
        Button({ id: "confirm", label: "Confirm", style: "primary" }),
        LinkButton({ label: "Track Order", url: "https://example.com/track" }),
      ]),
    ],
  })
);
// Renders as interactive card on FB/IG/Telegram/WhatsApp
// Falls back to text on X/Bluesky/Reddit
```

A card `Select` or `RadioSelect` is mapped to a WhatsApp **interactive list** (it can't coexist with reply buttons, so the list takes precedence):

```typescript
import { Card, Actions, Select, SelectOption } from "chat";

await thread.post(
  Card({
    title: "Pick a plan",
    children: [
      Actions([
        Select({
          id: "plan",
          placeholder: "Choose plan", // becomes the list's open button (max 20 chars)
          options: [
            SelectOption({ label: "Basic", value: "basic", description: "$10/mo" }),
            SelectOption({ label: "Pro", value: "pro" }),
          ],
        }),
      ]),
    ],
  })
);
```

## WhatsApp Rich Messages

WhatsApp-only message types that don't map to a Chat SDK card are sent through the exported [`ZernioApiClient`](#api-client), used alongside the adapter. Decode a thread id to get the `accountId` + `conversationId`:

```typescript
import { ZernioApiClient } from "@zernio/chat-sdk-adapter";

const client = new ZernioApiClient(process.env.ZERNIO_API_KEY!, "https://zernio.com/api");
const { accountId, conversationId } = adapter.decodeThreadId(threadId);

// Reply buttons / list / cta_url / flow / location-request / voice-call button
await client.sendInteractive(conversationId, accountId, {
  type: "cta_url",
  body: { text: "View your order" },
  action: { name: "cta_url", parameters: { display_text: "Open", url: "https://example.com/o/123" } },
});

// Location pin
await client.sendLocation(conversationId, accountId, {
  latitude: 41.3874, longitude: 2.1686, name: "HQ", address: "Barcelona",
});

// Contact cards (vCard)
await client.sendContacts(conversationId, accountId, [
  { name: { formatted_name: "Ana Ruiz" }, phones: [{ phone: "+34600000000", type: "WORK" }] },
]);

// Approved template (re-opens the 24h window)
await client.sendTemplate(conversationId, accountId, { name: "order_update", language: "en_US" });

// Quote / reply to a specific message
await client.reply(conversationId, accountId, "wamid.HBg...", "Thanks, on it!");
```

`sendInteractive` accepts the full WhatsApp interactive union: `button`, `list`, `cta_url`, `flow`, `location_request_message`, and `voice_call`. Pass `{ replyTo }` as the 4th arg to quote a message.

## Inbound Interactive Replies

When a user taps a reply button, picks a list row, or submits a WhatsApp Flow, it arrives as a normal `onNewMessage` whose interactive context is on `message.raw.metadata`:

```typescript
bot.onNewMessage(/.*/, async (thread, message) => {
  const meta = (message.raw as any).metadata;
  if (meta?.interactiveType === "button_reply" || meta?.interactiveType === "list_reply") {
    // The id you set when sending the button/row
    await thread.post(`You picked: ${meta.interactiveId}`);
  }
  if (meta?.interactiveType === "nfm_reply") {
    const form = meta.flowResponseData; // parsed Flow response
  }
  // meta.referral  -> Click-to-WhatsApp ad attribution (when the chat started from an ad)
  // meta.quotedMessageId -> the message this one replies to
});
```

## Opening Conversations

Start a chat with someone who hasn't messaged you yet.

`openDM(userId)` is the standard Chat SDK method. Because one Zernio account = one channel, namespace the recipient as `"{accountId}:{recipient}"` (a phone/E.164 for WhatsApp). It's resolution-only — no network call — and the first `post()` opens the thread:

```typescript
const thread = await bot.openDM("507f1f77bcf86cd799439011:16505551234");
await thread.post("Hi!"); // WhatsApp: the first message must be a template (see below)
```

For WhatsApp you must open with an approved template (the 24h-window rule). `openConversation` sends it and returns the thread id in one step:

```typescript
const threadId = await adapter.openConversation({
  accountId: "507f1f77bcf86cd799439011",
  to: "16505551234",
  template: { name: "welcome", language: "en_US", params: ["Ana"] },
});
// Non-WhatsApp platforms can open with a plain message instead:
// await adapter.openConversation({ accountId, to, message: "Hi!" });
```

## AI Streaming

Stream AI responses with the post+edit pattern (works best on Telegram). `thread.post()` accepts an `AsyncIterable<string>`, so you can pass the `textStream` from `streamText` directly:

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

bot.onNewMessage(/.*/, async (thread, message) => {
  const result = streamText({
    model: openai("gpt-4o"),
    prompt: message.text,
  });

  // On Telegram: posts initial message, edits as tokens arrive
  // On other platforms: collects full response, posts once
  await thread.post(result.textStream);
});
```

## Receiving Reactions

Reactions (WhatsApp and Telegram) route to `onReaction`, not `onNewMessage`, so a 👍 is never treated as an inbound message. Subscribe your webhook to `reaction.received` to receive them.

```typescript
bot.onReaction(async (event) => {
  // event.emoji     normalized emoji (use event.rawEmoji for the raw platform value)
  // event.added     true when added, false when removed
  // event.messageId the message that was reacted to
  // event.thread    the thread where it happened
  if (event.added) {
    await event.thread.post(`Thanks for the ${event.emoji}!`);
  }
});
```

> Telegram only delivers reactions when the bot is an administrator in the chat (never in private chats). On WhatsApp removals the emoji is reported as an empty string.

## Platform-Specific Data

Access the underlying platform through the raw message:

```typescript
bot.onNewMessage(/.*/, async (thread, message) => {
  const raw = message.raw as any;

  // Check which platform the message came from
  console.log(raw.platform); // "instagram", "facebook", "telegram", etc.

  // Access platform-specific sender info
  if (raw.sender.instagramProfile) {
    console.log(`Follower count: ${raw.sender.instagramProfile.followerCount}`);
    console.log(`Is verified: ${raw.sender.instagramProfile.isVerified}`);
  }

  // WhatsApp phone number
  if (raw.sender.phoneNumber) {
    console.log(`Phone: ${raw.sender.phoneNumber}`);
  }
});
```

## API Client

The adapter exports a standalone API client for direct Zernio API calls:

```typescript
import { ZernioApiClient } from "@zernio/chat-sdk-adapter";

const client = new ZernioApiClient("your-api-key", "https://zernio.com/api");

// List conversations
const { data, pagination } = await client.listConversations({
  platform: "instagram",
  status: "active",
  limit: 20,
});

// Fetch messages (optionally paginated: limit, opaque cursor, sortOrder)
const messages = await client.fetchMessages(conversationId, accountId, {
  limit: 20,
  sortOrder: "desc", // newest first; omit for oldest-first (default)
});

// Send typing indicator
await client.sendTyping(conversationId, accountId);

// Add reaction
await client.addReaction(conversationId, messageId, accountId, "👍");

// Upload media
const { url } = await client.uploadMedia(fileBuffer, "image/jpeg");

// Cold-start a conversation from a recipient (WhatsApp needs a template)
const convo = await client.createConversation({
  accountId,
  participantId: "16505551234",
  templateName: "welcome",
  templateLanguage: "en_US",
});

// WhatsApp rich sends: sendInteractive, sendLocation, sendContacts,
// sendTemplate, reply — see "WhatsApp Rich Messages" above.
```

## Webhook Verification

The adapter automatically verifies webhook signatures when `webhookSecret` is configured. You can also use the verification utility directly:

```typescript
import { verifyWebhookSignature } from "@zernio/chat-sdk-adapter";

const isValid = verifyWebhookSignature(rawBody, signature, secret);
```

## Error Handling

The adapter maps Zernio API errors to standard chat-sdk error classes:

| HTTP Status | Error Class | Description |
|-------------|------------|-------------|
| 401 | `AuthenticationError` | Invalid or expired API key |
| 403 | `PermissionError` | Read-only key, missing addon, etc. |
| 404 | `ResourceNotFoundError` | Conversation or message not found |
| 429 | `AdapterRateLimitError` | Rate limit hit (includes `retryAfter`) |
| 5xx | `NetworkError` | Server error |

## License

MIT
