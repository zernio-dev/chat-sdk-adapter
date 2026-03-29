/**
 * HTTP client for the Zernio REST API.
 *
 * Wraps all Zernio inbox API endpoints with typed request/response handling,
 * authentication via Bearer token, and error mapping to chat-sdk error classes.
 */

import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
} from "@chat-adapter/shared";
import type {
  ZernioConversation,
  ZernioConversationListResponse,
  ZernioMessageListResponse,
  ZernioSendMessageBody,
} from "./types.js";

/** Adapter name used in error constructors. */
const ADAPTER_NAME = "zernio";

export class ZernioApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Strip trailing slash
  }

  /**
   * Send a message in a conversation.
   * POST /v1/inbox/conversations/{conversationId}/messages
   *
   * @returns The platform-specific response data (includes messageId, etc.)
   */
  async sendMessage(
    conversationId: string,
    body: ZernioSendMessageBody,
  ): Promise<Record<string, unknown>> {
    const result = await this.request<{ success: boolean; data: Record<string, unknown> }>(
      "POST",
      `/v1/inbox/conversations/${conversationId}/messages`,
      body,
    );
    return result.data ?? {};
  }

  /**
   * Edit an existing message in a conversation.
   * PATCH /v1/inbox/conversations/{conversationId}/messages/{messageId}
   *
   * Note: Only Telegram supports message editing. The Zernio API will return
   * an error for non-Telegram accounts; the adapter lets this propagate.
   */
  async editMessage(
    conversationId: string,
    messageId: string,
    body: { accountId: string; text?: string; replyMarkup?: unknown },
  ): Promise<Record<string, unknown>> {
    const result = await this.request<{ success: boolean; data: Record<string, unknown> }>(
      "PATCH",
      `/v1/inbox/conversations/${conversationId}/messages/${messageId}`,
      body,
    );
    return result.data ?? {};
  }

  /**
   * Fetch messages for a conversation.
   * GET /v1/inbox/conversations/{conversationId}/messages?accountId=...
   */
  async fetchMessages(
    conversationId: string,
    accountId: string,
  ): Promise<ZernioMessageListResponse> {
    return this.request<ZernioMessageListResponse>(
      "GET",
      `/v1/inbox/conversations/${conversationId}/messages?accountId=${encodeURIComponent(accountId)}`,
    );
  }

  /**
   * Fetch a single conversation's details.
   * GET /v1/inbox/conversations/{conversationId}?accountId=...
   */
  async fetchConversation(
    conversationId: string,
    accountId: string,
  ): Promise<ZernioConversation> {
    const result = await this.request<{ data: ZernioConversation }>(
      "GET",
      `/v1/inbox/conversations/${conversationId}?accountId=${encodeURIComponent(accountId)}`,
    );
    return result.data;
  }

  /**
   * List conversations with optional filters and cursor pagination.
   * GET /v1/inbox/conversations?...
   */
  async listConversations(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
    platform?: string;
    accountId?: string;
    profileId?: string;
  }): Promise<ZernioConversationListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.platform) searchParams.set("platform", params.platform);
    if (params?.accountId) searchParams.set("accountId", params.accountId);
    if (params?.profileId) searchParams.set("profileId", params.profileId);

    const query = searchParams.toString();
    return this.request<ZernioConversationListResponse>(
      "GET",
      `/v1/inbox/conversations${query ? `?${query}` : ""}`,
    );
  }

  // ─── Typing ─────────────────────────────────────────────────────────────

  /**
   * Send a typing indicator for a conversation.
   * POST /v1/inbox/conversations/{conversationId}/typing
   *
   * Supported on Facebook Messenger and Telegram. No-op on other platforms.
   */
  async sendTyping(conversationId: string, accountId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      "POST",
      `/v1/inbox/conversations/${conversationId}/typing`,
      { accountId },
    );
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  /**
   * Delete a message from a conversation.
   * DELETE /v1/inbox/conversations/{conversationId}/messages/{messageId}
   *
   * Supported on Telegram, X/Twitter. Self-only delete on Bluesky, Reddit.
   */
  async deleteMessage(
    conversationId: string,
    messageId: string,
    accountId: string,
  ): Promise<void> {
    await this.request<{ success: boolean }>(
      "DELETE",
      `/v1/inbox/conversations/${conversationId}/messages/${messageId}?accountId=${encodeURIComponent(accountId)}`,
    );
  }

  // ─── Reactions ──────────────────────────────────────────────────────────

  /**
   * Add a reaction to a message.
   * POST /v1/inbox/conversations/{conversationId}/messages/{messageId}/reactions
   *
   * Supported on Telegram and WhatsApp.
   */
  async addReaction(
    conversationId: string,
    messageId: string,
    accountId: string,
    emoji: string,
  ): Promise<void> {
    await this.request<{ success: boolean }>(
      "POST",
      `/v1/inbox/conversations/${conversationId}/messages/${messageId}/reactions`,
      { accountId, emoji },
    );
  }

  /**
   * Remove a reaction from a message.
   * DELETE /v1/inbox/conversations/{conversationId}/messages/{messageId}/reactions
   */
  async removeReaction(
    conversationId: string,
    messageId: string,
    accountId: string,
  ): Promise<void> {
    await this.request<{ success: boolean }>(
      "DELETE",
      `/v1/inbox/conversations/${conversationId}/messages/${messageId}/reactions?accountId=${encodeURIComponent(accountId)}`,
    );
  }

  // ─── Media Upload ───────────────────────────────────────────────────────

  /**
   * Upload media (image, video, file) and get back a URL.
   * POST /v1/media/upload
   *
   * Used by the adapter to convert chat-sdk FileUpload buffers into URLs
   * that can be passed as attachmentUrl when sending messages.
   */
  async uploadMedia(
    data: Buffer | ArrayBuffer | Blob,
    mimeType?: string,
  ): Promise<{ url: string; mediaId?: string }> {
    const url = `${this.baseUrl}/v1/media/upload-direct`;
    const formData = new FormData();

    // Convert Buffer/ArrayBuffer to Blob for FormData
    const blob = data instanceof Blob
      ? data
      : new Blob([data], { type: mimeType || "application/octet-stream" });
    formData.append("file", blob, `upload.${mimeType?.split("/")[1] || "bin"}`);
    if (mimeType) formData.append("contentType", mimeType);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
      });
    } catch (error) {
      throw new NetworkError(
        ADAPTER_NAME,
        "Media upload request failed",
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new NetworkError(ADAPTER_NAME, `Media upload failed: ${errorBody}`);
    }

    return response.json() as Promise<{ url: string; mediaId?: string }>;
  }

  /**
   * Internal HTTP request helper.
   * Handles auth headers, JSON serialization, and error mapping.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        ADAPTER_NAME,
        `Request to ${method} ${path} failed`,
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error ?? parsed.message ?? errorBody;
      } catch {
        errorMessage = errorBody || `HTTP ${response.status}`;
      }

      switch (response.status) {
        case 401:
          throw new AuthenticationError(ADAPTER_NAME, errorMessage);
        case 403:
          throw new PermissionError(ADAPTER_NAME, errorMessage);
        case 404:
          throw new ResourceNotFoundError(ADAPTER_NAME, "resource", path);
        case 429: {
          const retryAfter = response.headers.get("retry-after");
          throw new AdapterRateLimitError(
            ADAPTER_NAME,
            retryAfter ? parseInt(retryAfter, 10) : undefined,
          );
        }
        default:
          throw new NetworkError(ADAPTER_NAME, `${method} ${path}: ${errorMessage}`);
      }
    }

    return response.json() as Promise<T>;
  }
}
