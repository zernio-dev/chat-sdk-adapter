/**
 * Format converter for the Zernio adapter.
 *
 * Zernio's inbox API accepts plain text for message sending across all platforms.
 * Platforms that support markdown (Telegram, Reddit) render it natively,
 * while others display it as-is. This converter uses a simple markdown
 * passthrough, delegating to chat-sdk's built-in parseMarkdown/stringifyMarkdown.
 */

import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from "chat";
import type { Root } from "mdast";

export class ZernioFormatConverter extends BaseFormatConverter {
  /**
   * Convert platform text to mdast AST.
   * Since Zernio passes through plain text (with optional markdown),
   * we parse it as standard markdown.
   */
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  /**
   * Convert mdast AST back to platform text.
   * Returns standard markdown which Zernio passes through to platforms.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}
