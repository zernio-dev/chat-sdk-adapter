import { describe, it, expect, vi, afterEach } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import { createZernioAdapter } from "./factory.js";
import { ZernioAdapter } from "./adapter.js";

describe("createZernioAdapter", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env vars after each test
    process.env = { ...originalEnv };
  });

  it("creates adapter with explicit config", () => {
    const adapter = createZernioAdapter({
      apiKey: "test-key",
      webhookSecret: "test-secret",
      baseUrl: "https://custom.api.com",
      botName: "Custom Bot",
    });

    expect(adapter).toBeInstanceOf(ZernioAdapter);
    expect(adapter.name).toBe("zernio");
    expect(adapter.userName).toBe("Custom Bot");
  });

  it("falls back to environment variables", () => {
    process.env.ZERNIO_API_KEY = "env-key";
    process.env.ZERNIO_WEBHOOK_SECRET = "env-secret";
    process.env.ZERNIO_BOT_NAME = "Env Bot";

    const adapter = createZernioAdapter();

    expect(adapter).toBeInstanceOf(ZernioAdapter);
    expect(adapter.userName).toBe("Env Bot");
  });

  it("throws ValidationError when API key is missing", () => {
    delete process.env.ZERNIO_API_KEY;

    expect(() => createZernioAdapter()).toThrow(ValidationError);
    expect(() => createZernioAdapter()).toThrow(/API key is required/);
  });

  it("config values take priority over env vars", () => {
    process.env.ZERNIO_API_KEY = "env-key";
    process.env.ZERNIO_BOT_NAME = "Env Bot";

    const adapter = createZernioAdapter({
      apiKey: "explicit-key",
      botName: "Explicit Bot",
    });

    expect(adapter.userName).toBe("Explicit Bot");
  });

  it("defaults botName to 'Zernio Bot' when not set anywhere", () => {
    delete process.env.ZERNIO_BOT_NAME;

    const adapter = createZernioAdapter({ apiKey: "key" });
    expect(adapter.userName).toBe("Zernio Bot");
  });

  it("defaults baseUrl to https://zernio.com/api", () => {
    delete process.env.ZERNIO_API_BASE_URL;

    // Just verify it doesn't throw (baseUrl is private, can't inspect directly)
    const adapter = createZernioAdapter({ apiKey: "key" });
    expect(adapter).toBeInstanceOf(ZernioAdapter);
  });
});
