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

const bot = new Chat({
  userName: "my-bot",
  adapters: {
    zernio: createZernioAdapter(),
  },
  state: createMemoryState(),
  onNewMessage: async ({ thread, message }) => {
    // This handler fires for messages from ALL connected platforms
    const platform = message.raw.platform; // "instagram", "telegram", etc.
    await thread.post(`Hello from ${platform}!`);
  },
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
- **Events**: Select `message.received` and `comment.received`
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
| Rich messages (cards) | Yes | Buttons and templates on FB, IG, Telegram, WhatsApp |
| Edit messages | Partial | Telegram only |
| Delete messages | Partial | Telegram, X (full delete); Bluesky, Reddit (self-only) |
| Reactions | Partial | Telegram and WhatsApp (add/remove emoji) |
| Typing indicators | Partial | Facebook Messenger and Telegram |
| AI streaming | Partial | Post+edit on Telegram; single post on others |
| File attachments | Yes | Via media upload endpoint |
| Fetch messages | Yes | Full conversation history |
| Fetch thread info | Yes | Participant details, platform, status |
| Webhook verification | Yes | HMAC-SHA256 signature |
| Comment webhooks | Yes | `comment.received` routed through handlers |

### Platform Support Matrix

| Feature | FB | IG | Telegram | WhatsApp | X | Bluesky | Reddit |
|---------|----|----|----------|----------|---|---------|--------|
| Send text | Y | Y | Y | Y | Y | Y | Y |
| Buttons | Y | Y | Y | Y | - | - | - |
| Typing | Y | - | Y | - | - | - | - |
| Delete | - | - | Y | - | Y | Self | Self |
| Reactions | - | - | Y | Y | - | - | - |
| Media | Y | Y | Y | Y | Y | - | - |
| Edit | - | - | Y | - | - | - | - |

## Rich Messages

The adapter maps chat-sdk `Card` elements to native platform formats instead of rendering as fallback text:

```typescript
import { Card, Button, Actions, Text } from "chat";

await thread.post(
  Card({
    title: "Order #1234",
    subtitle: "Total: $50.00",
    imageUrl: "https://example.com/product.jpg",
    children: [
      Text("Your order is ready for pickup."),
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

## AI Streaming

Stream AI responses with the post+edit pattern (works best on Telegram):

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

onNewMessage: async ({ thread, message }) => {
  const result = await generateText({
    model: openai("gpt-4o"),
    prompt: message.text,
  });

  // On Telegram: posts initial message, edits as tokens arrive
  // On other platforms: collects full response, posts once
  await thread.stream(result.textStream);
}
```

## Platform-Specific Data

Access the underlying platform through the raw message:

```typescript
onNewMessage: async ({ message }) => {
  const raw = message.raw;

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
}
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

// Fetch messages
const messages = await client.fetchMessages(conversationId, accountId);

// Send typing indicator
await client.sendTyping(conversationId, accountId);

// Add reaction
await client.addReaction(conversationId, messageId, accountId, "👍");

// Upload media
const { url } = await client.uploadMedia(fileBuffer, "image/jpeg");
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
