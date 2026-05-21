import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/**
 * Creates a message in the shape the REST GET /messages endpoint actually
 * returns (flat senderId/senderName/message/createdAt), which is DIFFERENT from
 * the nested webhook payload shape that `makeRawMessage` produces. See
 * libs/inbox/message-fetching.ts in the Zernio API repo. Regression fixture for
 * GitHub issue #3 (fetchMessages threw on this shape).
 */
function makeRestMessage(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "wamid.ABC",
    conversationId: "conv-456",
    accountId: "acc-1",
    platform: "whatsapp",
    message: "hi there",
    senderId: "13866666863",
    senderName: "13866666863",
    senderPhoneNumber: "+13866666863",
    direction: "incoming",
    createdAt: "2026-03-29T10:00:00.000Z",
    attachments: [],
    sentAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

/** Builds an async iterable of string chunks for stream() tests. */
async function* asyncChunks(...chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
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
      processReaction: vi.fn(),
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

  it("routes reaction.received to processReaction (not processMessage)", async () => {
    const payload = {
      id: "evt-003",
      event: "reaction.received",
      timestamp: "2026-03-29T10:00:00.000Z",
      reaction: {
        emoji: "👍",
        action: "added",
        messageId: "msg-zernio-1",
        platformMessageId: "wamid.REACTED",
        sender: { id: "13866666863", name: "Yair", phoneNumber: "+13866666863" },
        reactedAt: "2026-03-29T10:00:00.000Z",
      },
      conversation: { id: "conv-456", platformConversationId: "wa-conv", status: "active" },
      account: { id: "acc-789", platform: "whatsapp", username: "mybrand" },
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "reaction.received",
        "Content-Type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processReaction).toHaveBeenCalledOnce();
    expect(mockChat.processMessage).not.toHaveBeenCalled();

    const [event] = mockChat.processReaction.mock.calls[0];
    expect(event.threadId).toBe("zernio:acc-789:conv-456");
    expect(event.added).toBe(true);
    expect(event.rawEmoji).toBe("👍");
    expect(event.messageId).toBe("msg-zernio-1");
    expect(event.user.userId).toBe("13866666863");
    // Normalized to a known name via the unicode resolver.
    expect(event.emoji.name).toBe("thumbs_up");
  });

  it("falls back to platformMessageId when reaction has no resolved messageId", async () => {
    const payload = {
      id: "evt-004",
      event: "reaction.received",
      timestamp: "2026-03-29T10:00:00.000Z",
      reaction: {
        emoji: "",
        action: "removed",
        platformMessageId: "wamid.REACTED",
        sender: { id: "13866666863" },
        reactedAt: "2026-03-29T10:00:00.000Z",
      },
      conversation: { id: "conv-456", platformConversationId: "wa-conv", status: "active" },
      account: { id: "acc-789", platform: "whatsapp", username: "mybrand" },
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": signature,
        "X-Zernio-Event": "reaction.received",
        "Content-Type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);
    const [event] = mockChat.processReaction.mock.calls[0];
    expect(event.added).toBe(false);
    expect(event.messageId).toBe("wamid.REACTED");
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

  it("fetchMessages parses the real REST flat shape (issue #3)", async () => {
    // Regression: parseMessage used to read raw.sender.id, but the REST endpoint
    // returns a flat senderId. This must not throw.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        messages: [makeRestMessage({ message: "hi there" })],
        pagination: { hasMore: false, nextCursor: null },
        sortOrderApplied: "desc",
        lastUpdated: "2026-03-29T10:00:00Z",
      }), { status: 200 }),
    );
    const result = await adapter.fetchMessages("zernio:acc-1:conv-2", { limit: 10 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("hi there");
    expect(result.messages[0].author.userId).toBe("13866666863");
    expect(result.messages[0].author.fullName).toBe("13866666863");
  });

  it("fetchMessages still tolerates the nested webhook shape", async () => {
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
    expect(result.messages[0].author.userId).toBe("user-001");
  });

  it("fetchMessages forwards limit/cursor and maps default direction to desc", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        messages: [],
        pagination: { hasMore: false, nextCursor: null },
        lastUpdated: "2026-03-29T10:00:00Z",
      }), { status: 200 }),
    );
    await adapter.fetchMessages("zernio:acc-1:conv-2", { limit: 10, cursor: "db:abc_1" });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("limit=10");
    expect(url).toContain("sortOrder=desc"); // default direction "backward" = most recent
    expect(url).toContain("cursor=db%3Aabc_1");
  });

  it("fetchMessages direction:forward maps to sortOrder=asc", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "success", messages: [], lastUpdated: "x" }), { status: 200 }),
    );
    await adapter.fetchMessages("zernio:acc-1:conv-2", { direction: "forward" });
    expect(String(spy.mock.calls[0][0])).toContain("sortOrder=asc");
  });

  it("fetchMessages returns most-recent page oldest-first (reverses desc) and wires nextCursor", async () => {
    // REST desc gives newest-first; FetchResult requires oldest-first within the page.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        messages: [
          makeRestMessage({ id: "m3", message: "third", createdAt: "2026-03-29T10:03:00.000Z" }),
          makeRestMessage({ id: "m2", message: "second", createdAt: "2026-03-29T10:02:00.000Z" }),
          makeRestMessage({ id: "m1", message: "first", createdAt: "2026-03-29T10:01:00.000Z" }),
        ],
        pagination: { hasMore: true, nextCursor: "db:older_1" },
        sortOrderApplied: "desc",
        lastUpdated: "x",
      }), { status: 200 }),
    );
    const result = await adapter.fetchMessages("zernio:acc-1:conv-2", { limit: 3 });
    expect(result.messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
    expect(result.nextCursor).toBe("db:older_1");
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

// ─── Streaming Tests ────────────────────────────────────────────────────────

describe("stream", () => {
  let adapter: ZernioAdapter;

  beforeEach(() => {
    adapter = new ZernioAdapter(TEST_CONFIG);
  });

  // Restore the fetch spy between tests so a persistent mockResolvedValue
  // from one stream test cannot leak into the next.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mock for the GET fetchThread call that stream() uses to learn the platform. */
  function mockFetchThread(platform: string): Response {
    return new Response(JSON.stringify({
      data: { id: "conv-2", accountId: "acc-1", platform, status: "active" },
    }), { status: 200 });
  }

  it("non-editable platform: buffers full stream and posts ONCE with complete text", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchThread("whatsapp"))      // fetchThread
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { messageId: "wamid.X" } }), { status: 200 })); // sendMessage

    const result = await adapter.stream("zernio:acc-1:conv-2", asyncChunks("Hello", " ", "world"));

    // Exactly one POST send (after the GET fetchThread); no PATCH edits.
    const calls = spy.mock.calls;
    const sendCalls = calls.filter((c) => c[1]?.method === "POST");
    const editCalls = calls.filter((c) => c[1]?.method === "PATCH");
    expect(sendCalls).toHaveLength(1);
    expect(editCalls).toHaveLength(0);
    expect(JSON.parse(sendCalls[0][1].body as string).message).toBe("Hello world");
    expect(result.raw.text).toBe("Hello world");
  });

  it("telegram: posts then edits (live streaming)", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: { messageId: "tg-1" } }), { status: 200 }));
    // First call is fetchThread (GET) returning telegram
    spy.mockResolvedValueOnce(mockFetchThread("telegram"));

    const result = await adapter.stream("zernio:acc-1:conv-2", asyncChunks("Hel", "lo"));
    const editCalls = spy.mock.calls.filter((c) => c[1]?.method === "PATCH");
    expect(editCalls.length).toBeGreaterThanOrEqual(1); // at least the final edit
    expect(result.raw.text).toBe("Hello");
  });

  it("falls back to post-once if platform detection fails", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))  // fetchThread fails
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { messageId: "x" } }), { status: 200 }));

    const result = await adapter.stream("zernio:acc-1:conv-2", asyncChunks("a", "b", "c"));
    const editCalls = spy.mock.calls.filter((c) => c[1]?.method === "PATCH");
    expect(editCalls).toHaveLength(0);
    expect(result.raw.text).toBe("abc");
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
