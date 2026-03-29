import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Message } from "chat";
import { ValidationError, AdapterError } from "@chat-adapter/shared";
import { ZernioAdapter } from "./adapter.js";
import type { ZernioRawMessage, ZernioWebhookPayload } from "./types.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const TEST_CONFIG = {
  apiKey: "test-api-key",
  webhookSecret: "test-secret",
  baseUrl: "https://zernio.com/api",
  botName: "Test Bot",
};

/** Creates a minimal valid ZernioRawMessage. */
function makeRawMessage(overrides?: Partial<ZernioRawMessage>): ZernioRawMessage {
  return {
    id: "msg-123",
    conversationId: "conv-456",
    platform: "instagram",
    platformMessageId: "ig-msg-789",
    direction: "incoming",
    text: "Hello from Instagram",
    attachments: [],
    sender: {
      id: "user-001",
      name: "Jane Doe",
      username: "janedoe",
      picture: "https://example.com/pic.jpg",
    },
    sentAt: "2026-03-29T10:00:00.000Z",
    isRead: false,
    ...overrides,
  };
}

/** Creates a minimal valid webhook payload. */
function makeWebhookPayload(overrides?: Partial<ZernioWebhookPayload>): ZernioWebhookPayload {
  return {
    id: "evt-001",
    event: "message.received",
    timestamp: "2026-03-29T10:00:00.000Z",
    message: makeRawMessage(),
    conversation: {
      id: "conv-456",
      platformConversationId: "ig-conv-456",
      participantName: "Jane Doe",
      participantUsername: "janedoe",
      status: "active",
    },
    account: {
      id: "acc-789",
      platform: "instagram",
      username: "mybrand",
      displayName: "My Brand",
    },
    ...overrides,
  };
}

/** Sign a payload with the test secret. */
function signPayload(body: string): string {
  return createHmac("sha256", TEST_CONFIG.webhookSecret).update(body).digest("hex");
}

// ─── Thread ID Tests ────────────────────────────────────────────────────────

describe("Thread ID encode/decode", () => {
  const adapter = new ZernioAdapter(TEST_CONFIG);

  it("encodes a thread ID correctly", () => {
    const threadId = adapter.encodeThreadId({
      accountId: "acc-123",
      conversationId: "conv-456",
    });
    expect(threadId).toBe("zernio:acc-123:conv-456");
  });

  it("decodes a thread ID correctly", () => {
    const decoded = adapter.decodeThreadId("zernio:acc-123:conv-456");
    expect(decoded).toEqual({
      accountId: "acc-123",
      conversationId: "conv-456",
    });
  });

  it("roundtrips encode/decode", () => {
    const original = { accountId: "acc-abc", conversationId: "conv-xyz" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("handles conversationId with colons", () => {
    const original = { accountId: "acc-1", conversationId: "some:complex:id" };
    const encoded = adapter.encodeThreadId(original);
    expect(encoded).toBe("zernio:acc-1:some:complex:id");
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("throws ValidationError for invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("bad-format")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:abc:def")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("zernio:only-one")).toThrow(ValidationError);
  });

  it("extracts channelId (accountId) from thread ID", () => {
    const channelId = adapter.channelIdFromThreadId("zernio:acc-123:conv-456");
    expect(channelId).toBe("acc-123");
  });
});

// ─── parseMessage Tests ─────────────────────────────────────────────────────

describe("parseMessage", () => {
  const adapter = new ZernioAdapter(TEST_CONFIG);

  it("maps raw message to chat-sdk Message", () => {
    const raw = makeRawMessage();
    const msg = adapter.parseMessage(raw);

    expect(msg).toBeInstanceOf(Message);
    expect(msg.id).toBe("msg-123");
    expect(msg.text).toBe("Hello from Instagram");
    expect(msg.raw).toBe(raw);
  });

  it("maps author fields correctly", () => {
    const raw = makeRawMessage();
    const msg = adapter.parseMessage(raw);

    expect(msg.author.userId).toBe("user-001");
    expect(msg.author.userName).toBe("janedoe");
    expect(msg.author.fullName).toBe("Jane Doe");
    expect(msg.author.isBot).toBe(false);
    expect(msg.author.isMe).toBe(false);
  });

  it("maps metadata correctly", () => {
    const raw = makeRawMessage();
    const msg = adapter.parseMessage(raw);

    expect(msg.metadata.dateSent).toEqual(new Date("2026-03-29T10:00:00.000Z"));
    expect(msg.metadata.edited).toBe(false);
  });

  it("handles null text", () => {
    const raw = makeRawMessage({ text: null });
    const msg = adapter.parseMessage(raw);
    expect(msg.text).toBe("");
  });

  it("falls back username to sender ID when username is missing", () => {
    const raw = makeRawMessage({
      sender: { id: "user-999" },
    });
    const msg = adapter.parseMessage(raw);
    expect(msg.author.userName).toBe("user-999");
    expect(msg.author.fullName).toBe("");
  });

  it("maps attachments", () => {
    const raw = makeRawMessage({
      attachments: [
        { type: "image", url: "https://example.com/photo.jpg" },
        { type: "video", url: "https://example.com/video.mp4" },
      ],
    });
    const msg = adapter.parseMessage(raw);
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments[0]).toEqual({ type: "image", url: "https://example.com/photo.jpg" });
    expect(msg.attachments[1]).toEqual({ type: "video", url: "https://example.com/video.mp4" });
  });
});

// ─── handleWebhook Tests ────────────────────────────────────────────────────

describe("handleWebhook", () => {
  let adapter: ZernioAdapter;
  let mockChat: any;

  beforeEach(() => {
    adapter = new ZernioAdapter(TEST_CONFIG);
    mockChat = {
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      processMessage: vi.fn(),
    };
    adapter.initialize(mockChat);
  });

  it("returns 401 for invalid signature", async () => {
    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": "invalid-hex-signature",
        "X-Zernio-Event": "message.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const body = "not valid json{{{";
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "message.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("returns 200 and calls processMessage for valid incoming message", async () => {
    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "message.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();

    // Verify processMessage was called with correct adapter, threadId, factory, options
    const [adapterArg, threadIdArg, factoryArg] = mockChat.processMessage.mock.calls[0];
    expect(adapterArg).toBe(adapter);
    expect(threadIdArg).toBe("zernio:acc-789:conv-456");
    expect(typeof factoryArg).toBe("function");
  });

  it("skips outgoing messages (prevents echo loop)", async () => {
    const payload = makeWebhookPayload({
      message: makeRawMessage({ direction: "outgoing" }),
    });
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "message.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("skips unhandled event types", async () => {
    const payload = {
      ...makeWebhookPayload(),
      event: "post.published",
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "post.published",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("processes comment.received events", async () => {
    const payload = {
      id: "evt-002",
      event: "comment.received",
      timestamp: "2026-03-29T10:00:00.000Z",
      comment: {
        id: "cmt-001",
        postId: "post-123",
        platformPostId: "ig-post-123",
        platform: "instagram",
        text: "Great post!",
        author: { id: "user-002", username: "commenter", name: "Commenter" },
        createdAt: "2026-03-29T10:00:00.000Z",
        isReply: false,
        parentCommentId: null,
      },
      post: { id: "post-123", platformPostId: "ig-post-123" },
      account: { id: "acc-789", platform: "instagram", username: "mybrand" },
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "comment.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();

    const [, threadIdArg] = mockChat.processMessage.mock.calls[0];
    expect(threadIdArg).toBe("zernio:acc-789:comment:post-123");
  });

  it("skips signature verification when no webhookSecret is configured", async () => {
    const adapterNoSecret = new ZernioAdapter({
      ...TEST_CONFIG,
      webhookSecret: undefined,
    });
    adapterNoSecret.initialize(mockChat);

    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);

    // No signature header at all
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const response = await adapterNoSecret.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();
  });
});

// ─── API-Backed Method Tests ────────────────────────────────────────────────

describe("API-backed methods", () => {
  let adapter: ZernioAdapter;

  beforeEach(() => {
    adapter = new ZernioAdapter(TEST_CONFIG);
    adapter.initialize({
      getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
      processMessage: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deleteMessage calls the API DELETE endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await adapter.deleteMessage("zernio:acc-1:conv-2", "msg-3");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/inbox/conversations/conv-2/messages/msg-3"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("addReaction calls the API POST endpoint with emoji", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await adapter.addReaction("zernio:acc-1:conv-2", "msg-3", "👍");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.emoji).toBe("👍");
    expect(body.accountId).toBe("acc-1");
  });

  it("removeReaction calls the API DELETE endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await adapter.removeReaction("zernio:acc-1:conv-2", "msg-3", "👍");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/inbox/conversations/conv-2/messages/msg-3/reactions"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("startTyping calls the API and does not throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await expect(adapter.startTyping("zernio:acc-1:conv-2")).resolves.toBeUndefined();
  });

  it("startTyping silently swallows errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    await expect(adapter.startTyping("zernio:acc-1:conv-2")).resolves.toBeUndefined();
  });

  it("postMessage sends text via API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { messageId: "m1" } }), { status: 200 }),
    );
    const result = await adapter.postMessage("zernio:acc-1:conv-2", "Hello!");
    expect(result.id).toBe("m1");
    expect(result.threadId).toBe("zernio:acc-1:conv-2");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.message).toBe("Hello!");
    expect(body.accountId).toBe("acc-1");
  });

  it("editMessage sends text field (not message) to API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { messageId: 42 } }), { status: 200 }),
    );
    await adapter.editMessage("zernio:acc-1:conv-2", "42", "Updated text");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.text).toBe("Updated text");
    expect(body.message).toBeUndefined();
  });

  it("fetchMessages returns parsed messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        messages: [makeRawMessage()],
        lastUpdated: "2026-03-29T10:00:00Z",
      }), { status: 200 }),
    );
    const result = await adapter.fetchMessages("zernio:acc-1:conv-2");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Hello from Instagram");
    expect(result.nextCursor).toBeUndefined();
  });

  it("fetchThread returns thread info with metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: {
          id: "conv-2",
          accountId: "acc-1",
          platform: "telegram",
          status: "active",
          participantName: "Jane",
          participantUsername: "janedoe",
        },
      }), { status: 200 }),
    );
    const result = await adapter.fetchThread("zernio:acc-1:conv-2");
    expect(result.id).toBe("zernio:acc-1:conv-2");
    expect(result.channelId).toBe("acc-1");
    expect(result.isDM).toBe(true);
    expect(result.metadata.platform).toBe("telegram");
  });
});

// ─── Optional Method Tests ──────────────────────────────────────────────────

describe("optional methods", () => {
  const adapter = new ZernioAdapter(TEST_CONFIG);

  it("isDM always returns true", () => {
    expect(adapter.isDM("zernio:a:b")).toBe(true);
    expect(adapter.isDM("zernio:x:y")).toBe(true);
  });
});

// ─── Adapter Properties Tests ───────────────────────────────────────────────

describe("adapter properties", () => {
  it("has correct name", () => {
    const adapter = new ZernioAdapter(TEST_CONFIG);
    expect(adapter.name).toBe("zernio");
  });

  it("uses botName as userName", () => {
    const adapter = new ZernioAdapter(TEST_CONFIG);
    expect(adapter.userName).toBe("Test Bot");
  });

  it("defaults userName to 'Zernio Bot'", () => {
    const adapter = new ZernioAdapter({ apiKey: "key" });
    expect(adapter.userName).toBe("Zernio Bot");
  });

  it("persistMessageHistory is false", () => {
    const adapter = new ZernioAdapter(TEST_CONFIG);
    expect(adapter.persistMessageHistory).toBe(false);
  });
});
