# @zernio/chat-sdk-adapter

Official [Zernio](https://zernio.com) adapter for [Chat SDK](https://chat-sdk.dev). Build chatbots that work across **Instagram, Facebook, Twitter/X, Telegram, WhatsApp, Bluesky, and Reddit** through a single integration.

Instead of configuring seven separate platform adapters, one Zernio adapter covers every messaging platform Zernio supports.

## Installation

```bash
npm install @zernio/chat-sdk-adapter chat
```

## Quick Start

```typescript
import { Chat } from "chat";
import { createZernioAdapter } from "@zernio/chat-sdk-adapter";

const bot = new Chat({
  adapters: {
    zernio: createZernioAdapter(),
  },
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
| `ZERNIO_API_BASE_URL` | No | Override API base URL (default: `https://api.zernio.com`) |
| `ZERNIO_BOT_NAME` | No | Bot display name (default: `"Zernio Bot"`) |

### Explicit Configuration

```typescript
const adapter = createZernioAdapter({
  apiKey: "your-api-key",
  webhookSecret: "your-webhook-secret",
  baseUrl: "https://api.zernio.com",
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
- **Events**: Select `message.received`
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
| Edit messages | Partial | Telegram only (API constraint) |
| Delete messages | No | Not exposed by Zernio API |
| Reactions | No | Not exposed by Zernio API |
| Typing indicators | No | Not exposed by Zernio API |
| Fetch messages | Yes | Full conversation history |
| Fetch thread info | Yes | Participant details, platform, status |
| Webhook verification | Yes | HMAC-SHA256 signature |
| File attachments | Yes | Via `attachmentUrl` in message body |
| Cards/Rich messages | Partial | Rendered as fallback text |
| Streaming | No | REST-based API |

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

const client = new ZernioApiClient("your-api-key", "https://api.zernio.com");

// List conversations
const { data, pagination } = await client.listConversations({
  platform: "instagram",
  status: "active",
  limit: 20,
});

// Fetch messages
const messages = await client.fetchMessages(conversationId, accountId);
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
