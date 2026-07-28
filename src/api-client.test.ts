import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AuthenticationError,
  PermissionError,
  ResourceNotFoundError,
  AdapterRateLimitError,
  NetworkError,
} from "@chat-adapter/shared";
import { ZernioApiClient } from "./api-client.js";

describe("ZernioApiClient", () => {
  let client: ZernioApiClient;
  const baseUrl = "https://zernio.com/api";
  const apiKey = "test-api-key";

  beforeEach(() => {
    client = new ZernioApiClient(apiKey, baseUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── sendMessage ────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    it("sends a POST request with correct URL and body", async () => {
      const mockResponse = { success: true, data: { messageId: "msg-1" } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await client.sendMessage("conv-123", {
        accountId: "acc-456",
        message: "Hello!",
      });

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v1/inbox/conversations/conv-123/messages`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(result).toEqual({ messageId: "msg-1" });
    });
  });

  // ─── sendTyping ─────────────────────────────────────────────────────────

  describe("sendTyping", () => {
    it("sends a POST request to the typing endpoint and returns the success flag", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const sent = await client.sendTyping("conv-123", "acc-456");

      expect(sent).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v1/inbox/conversations/conv-123/typing`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ accountId: "acc-456" }),
        }),
      );
    });

    it("returns false when the platform call failed server-side (HTTP 200, success:false)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false }), { status: 200 }),
      );

      await expect(client.sendTyping("conv-123", "acc-456")).resolves.toBe(false);
    });

    it("propagates typed errors so callers can diagnose failures", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
      );

      await expect(client.sendTyping("conv-123", "acc-456")).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });
  });

  // ─── editMessage ────────────────────────────────────────────────────────

  describe("editMessage", () => {
    it("sends a PATCH request", async () => {
      const mockResponse = { success: true, data: { messageId: "msg-1" } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await client.editMessage("conv-123", "msg-1", {
        accountId: "acc-456",
        message: "Edited!",
      });

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v1/inbox/conversations/conv-123/messages/msg-1`,
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(result).toEqual({ messageId: "msg-1" });
    });
  });

  // ─── fetchMessages ──────────────────────────────────────────────────────

  describe("fetchMessages", () => {
    it("sends a GET request with accountId query param", async () => {
      const mockResponse = {
        status: "success",
        messages: [],
        lastUpdated: "2026-03-29T10:00:00Z",
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await client.fetchMessages("conv-123", "acc-456");

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v1/inbox/conversations/conv-123/messages?accountId=acc-456`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  // ─── fetchConversation ──────────────────────────────────────────────────

  describe("fetchConversation", () => {
    it("sends a GET request and returns the data field", async () => {
      const conversation = {
        id: "conv-123",
        accountId: "acc-456",
        platform: "instagram",
        status: "active",
        participantName: "Jane",
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: conversation }), { status: 200 }),
      );

      const result = await client.fetchConversation("conv-123", "acc-456");
      expect(result).toEqual(conversation);
    });
  });

  // ─── listConversations ──────────────────────────────────────────────────

  describe("listConversations", () => {
    it("builds query params correctly", async () => {
      const mockResponse = { data: [], pagination: { hasMore: false, nextCursor: null } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      await client.listConversations({
        platform: "telegram",
        status: "active",
        limit: 10,
      });

      const calledUrl = (fetch as any).mock.calls[0][0] as string;
      expect(calledUrl).toContain("platform=telegram");
      expect(calledUrl).toContain("status=active");
      expect(calledUrl).toContain("limit=10");
    });

    it("works with no params", async () => {
      const mockResponse = { data: [], pagination: { hasMore: false, nextCursor: null } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await client.listConversations();

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v1/inbox/conversations`,
        expect.anything(),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  // ─── Error Mapping ──────────────────────────────────────────────────────

  describe("error mapping", () => {
    it("throws AuthenticationError on 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }),
      );

      await expect(client.fetchMessages("c", "a")).rejects.toThrow(AuthenticationError);
    });

    it("throws PermissionError on 403", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Read-only key" }), { status: 403 }),
      );

      await expect(
        client.sendMessage("c", { accountId: "a", message: "hi" }),
      ).rejects.toThrow(PermissionError);
    });

    it("throws ResourceNotFoundError on 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      );

      await expect(client.fetchConversation("c", "a")).rejects.toThrow(ResourceNotFoundError);
    });

    it("throws AdapterRateLimitError on 429 with retryAfter", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      );

      try {
        await client.fetchMessages("c", "a");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterRateLimitError);
        expect((err as AdapterRateLimitError).retryAfter).toBe(30);
      }
    });

    it("throws NetworkError on 500", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

      await expect(client.fetchMessages("c", "a")).rejects.toThrow(NetworkError);
    });

    it("throws NetworkError on fetch failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("DNS resolution failed"));

      await expect(client.fetchMessages("c", "a")).rejects.toThrow(NetworkError);
    });
  });

  // ─── URL handling ───────────────────────────────────────────────────────

  describe("URL handling", () => {
    it("strips trailing slash from baseUrl", async () => {
      const clientWithSlash = new ZernioApiClient(apiKey, "https://zernio.com/api/");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "success", messages: [], lastUpdated: "" }), { status: 200 }),
      );

      await clientWithSlash.fetchMessages("c", "a");

      const calledUrl = (fetch as any).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("//v1");
    });
  });

  // ─── WhatsApp rich-message helpers ────────────────────────────────────────

  describe("WhatsApp helpers", () => {
    function mockOk() {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { messageId: "m1" } }), { status: 200 }),
      );
    }
    function sentBody(): Record<string, unknown> {
      return JSON.parse((fetch as any).mock.calls[0][1].body);
    }

    it("sendInteractive posts the interactive payload (and replyTo)", async () => {
      mockOk();
      await client.sendInteractive(
        "conv-1",
        "acc-1",
        { type: "button", body: { text: "Pick" }, action: { buttons: [{ type: "reply", reply: { id: "y", title: "Yes" } }] } },
        { replyTo: "wamid.X" },
      );
      const body = sentBody();
      expect((body.interactive as any).type).toBe("button");
      expect(body.replyTo).toBe("wamid.X");
      expect(body.accountId).toBe("acc-1");
    });

    it("sendLocation posts a location pin", async () => {
      mockOk();
      await client.sendLocation("conv-1", "acc-1", { latitude: 41.3, longitude: 2.1, name: "HQ" });
      expect((sentBody().location as any).latitude).toBe(41.3);
    });

    it("sendContacts posts contact cards", async () => {
      mockOk();
      await client.sendContacts("conv-1", "acc-1", [{ name: { formatted_name: "Ana" } }]);
      expect((sentBody().contacts as any)[0].name.formatted_name).toBe("Ana");
    });

    it("sendTemplate wraps the template element", async () => {
      mockOk();
      await client.sendTemplate("conv-1", "acc-1", { name: "hello", language: "en_US" });
      expect((sentBody().template as any).elements[0]).toEqual({ name: "hello", language: "en_US" });
    });

    it("reply quotes a message with replyTo", async () => {
      mockOk();
      await client.reply("conv-1", "acc-1", "wamid.Q", "thanks");
      const body = sentBody();
      expect(body.replyTo).toBe("wamid.Q");
      expect(body.message).toBe("thanks");
    });

    it("createConversation posts to the conversations collection and returns data", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { conversationId: "16505551234", messageId: "wamid.1", participantId: "16505551234", participantName: "16505551234" } }),
          { status: 201 },
        ),
      );
      const data = await client.createConversation({
        accountId: "acc-1",
        participantId: "16505551234",
        templateName: "hello",
        templateLanguage: "en_US",
      });
      expect(data.conversationId).toBe("16505551234");
      expect((fetch as any).mock.calls[0][0]).toBe(`${baseUrl}/v1/inbox/conversations`);
      expect(sentBody().templateName).toBe("hello");
    });
  });
});
