/**
 * Maps chat-sdk CardElement to Zernio's message format.
 *
 * Chat-sdk cards use a JSX-like structure (CardElement with children: CardChild[]).
 * Zernio's API accepts buttons, quickReplies, and templates as separate fields.
 * This module bridges the two, converting cards into rich messages that render
 * natively on Facebook, Instagram, Telegram, and WhatsApp.
 *
 * Platforms that don't support rich messages (X, Bluesky, Reddit) receive
 * fallback text via the format converter's cardToFallbackText().
 */

import type { ZernioSendMessageBody } from "./types.js";

// ─── Card Element Types (mirrored from chat-sdk) ────────────────────────────
// We use structural typing rather than importing the chat-sdk types directly,
// so this module works with any object matching the expected shapes.

interface CardLike {
  type: "card";
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  children: CardChildLike[];
}

type CardChildLike =
  | { type: "text"; content: string; style?: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "divider" }
  | { type: "actions"; children: ActionChildLike[] }
  | { type: "section"; children: CardChildLike[] }
  | { type: "fields"; children: FieldLike[] }
  | { type: "link"; label: string; url: string }
  | { type: "table"; headers: string[]; rows: string[][] };

type ActionChildLike =
  | { type: "button"; id: string; label: string; style?: string; value?: string; disabled?: boolean }
  | { type: "link-button"; label: string; url: string; style?: string }
  | { type: "select"; id: string; placeholder?: string; children?: unknown[] }
  | { type: "radio-select"; id: string; children?: unknown[] };

interface FieldLike {
  type: "field";
  label: string;
  value: string;
}

// ─── Mapper ─────────────────────────────────────────────────────────────────

/**
 * Result of mapping a CardElement to Zernio message fields.
 * Only populated fields should be spread into the send message body.
 */
export interface CardMappingResult {
  /** Text content extracted from the card (title + text children). */
  message: string;
  /** Postback/URL buttons extracted from ActionsElement children. */
  buttons?: ZernioSendMessageBody["buttons"];
  /** Template with elements (for cards with image + title + buttons). */
  template?: ZernioSendMessageBody["template"];
}

/**
 * Map a chat-sdk CardElement to Zernio's send message format.
 *
 * Mapping rules:
 * - Card title/subtitle/text children -> message text
 * - ButtonElement (id + label) -> postback button
 * - LinkButtonElement (label + url) -> URL button
 * - Card with imageUrl + title + buttons -> generic template element
 * - Fields -> rendered as "label: value" lines in message text
 * - Tables -> rendered as text rows in message text
 * - Images -> ignored (Zernio handles media via attachmentUrl separately)
 */
export function mapCardToZernioMessage(card: CardLike): CardMappingResult {
  const textParts: string[] = [];
  const buttons: NonNullable<ZernioSendMessageBody["buttons"]> = [];

  // Extract title and subtitle
  if (card.title) textParts.push(card.title);
  if (card.subtitle) textParts.push(card.subtitle);

  // Walk card children to extract text and buttons
  for (const child of card.children) {
    switch (child.type) {
      case "text":
        textParts.push(child.content);
        break;

      case "actions":
        for (const action of child.children) {
          if (action.type === "button" && !action.disabled) {
            buttons.push({
              type: "postback",
              title: action.label,
              payload: action.value || action.id,
            });
          } else if (action.type === "link-button") {
            buttons.push({
              type: "url",
              title: action.label,
              url: action.url,
            });
          }
          // Select/RadioSelect are not mappable to Zernio's button format
        }
        break;

      case "section":
        // Recursively extract text from section children
        for (const sectionChild of child.children) {
          if (sectionChild.type === "text") {
            textParts.push(sectionChild.content);
          }
        }
        break;

      case "fields":
        // Render fields as "label: value" pairs
        for (const field of child.children) {
          textParts.push(`${field.label}: ${field.value}`);
        }
        break;

      case "link":
        textParts.push(`${child.label}: ${child.url}`);
        break;

      case "table":
        // Render table as simple text rows
        if (child.headers.length > 0) {
          textParts.push(child.headers.join(" | "));
        }
        for (const row of child.rows) {
          textParts.push(row.join(" | "));
        }
        break;

      // "image" and "divider" are skipped in text extraction
    }
  }

  const message = textParts.join("\n");

  // If the card has an image + title + buttons, use a generic template
  // (renders as a carousel card on Facebook/Instagram)
  if (card.imageUrl && card.title && buttons.length > 0) {
    return {
      message,
      template: {
        type: "generic",
        elements: [{
          title: card.title,
          subtitle: card.subtitle,
          imageUrl: card.imageUrl,
          buttons: buttons.map(b => ({
            type: b.type === "url" ? "url" : "postback",
            title: b.title,
            ...(b.url && { url: b.url }),
            ...(b.payload && { payload: b.payload }),
          })),
        }],
      },
    };
  }

  // Otherwise, return text + buttons (buttons render as interactive on supported platforms)
  return {
    message,
    ...(buttons.length > 0 && { buttons }),
  };
}
