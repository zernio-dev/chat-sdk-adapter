import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, extractWebhookHeaders } from "./webhook.js";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";

  /** Helper to compute the expected HMAC-SHA256 hex digest. */
  function sign(body: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
  }

  it("returns true for a valid signature", () => {
    const body = JSON.stringify({ event: "message.received", id: "123" });
    const signature = sign(body);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = JSON.stringify({ event: "message.received", id: "123" });
    const badSignature = sign("different-body");
    expect(verifyWebhookSignature(body, badSignature, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const body = JSON.stringify({ event: "message.received" });
    const signature = sign(body);
    expect(verifyWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("returns false for a malformed signature (wrong length)", () => {
    const body = JSON.stringify({ event: "test" });
    expect(verifyWebhookSignature(body, "abc", secret)).toBe(false);
  });

  it("returns false for an empty signature", () => {
    const body = JSON.stringify({ event: "test" });
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
  });

  it("handles empty body", () => {
    const body = "";
    const signature = sign(body);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });
});

describe("extractWebhookHeaders", () => {
  it("extracts new X-Zernio-* headers", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": "abc123",
        "X-Zernio-Event": "message.received",
      },
    });
    const { signature, event } = extractWebhookHeaders(request);
    expect(signature).toBe("abc123");
    expect(event).toBe("message.received");
  });

  it("falls back to legacy X-Late-* headers", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Late-Signature": "legacy123",
        "X-Late-Event": "message.received",
      },
    });
    const { signature, event } = extractWebhookHeaders(request);
    expect(signature).toBe("legacy123");
    expect(event).toBe("message.received");
  });

  it("prefers X-Zernio-* over X-Late-* when both present", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-Zernio-Signature": "new",
        "X-Late-Signature": "old",
        "X-Zernio-Event": "message.received",
        "X-Late-Event": "message.received",
      },
    });
    const { signature } = extractWebhookHeaders(request);
    expect(signature).toBe("new");
  });

  it("returns null for missing headers", () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
    });
    const { signature, event } = extractWebhookHeaders(request);
    expect(signature).toBeNull();
    expect(event).toBeNull();
  });
});
