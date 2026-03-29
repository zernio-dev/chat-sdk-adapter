/**
 * Webhook signature verification for Zernio webhooks.
 *
 * Zernio signs webhook payloads using HMAC-SHA256 with the webhook secret.
 * The signature is sent in the X-Zernio-Signature header as a hex digest.
 * The legacy X-Late-Signature header is also supported for backward compatibility.
 * Verification uses timing-safe comparison to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Zernio webhook signature against the raw request body.
 *
 * @param rawBody - The raw JSON string exactly as received (not re-serialized)
 * @param signature - The hex digest from the X-Zernio-Signature (or X-Late-Signature) header
 * @param secret - The webhook secret configured in Zernio
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const computed = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Both values are hex strings, so convert to buffers for timing-safe comparison
  const sigBuffer = Buffer.from(signature, "hex");
  const computedBuffer = Buffer.from(computed, "hex");

  // Length mismatch means invalid signature (timingSafeEqual requires equal lengths)
  if (sigBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, computedBuffer);
}

/**
 * Extract Zernio-specific webhook headers from a Request.
 * Prefers the new X-Zernio-* headers, falls back to legacy X-Late-* headers.
 *
 * @param request - The incoming webhook Request
 * @returns Object with signature and event header values (null if absent)
 */
export function extractWebhookHeaders(request: Request): {
  signature: string | null;
  event: string | null;
} {
  return {
    signature:
      request.headers.get("x-zernio-signature") ??
      request.headers.get("x-late-signature"),
    event:
      request.headers.get("x-zernio-event") ??
      request.headers.get("x-late-event"),
  };
}
