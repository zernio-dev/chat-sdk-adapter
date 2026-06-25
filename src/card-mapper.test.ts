import { describe, it, expect } from "vitest";
import { mapCardToZernioMessage } from "./card-mapper.js";

describe("mapCardToZernioMessage", () => {
  it("extracts title and subtitle as message text", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Order #1234",
      subtitle: "Total: $50.00",
      children: [],
    });
    expect(result.message).toBe("Order #1234\nTotal: $50.00");
    expect(result.buttons).toBeUndefined();
    expect(result.template).toBeUndefined();
  });

  it("extracts text children", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Hello",
      children: [
        { type: "text", content: "First paragraph" },
        { type: "text", content: "Second paragraph" },
      ],
    });
    expect(result.message).toBe("Hello\nFirst paragraph\nSecond paragraph");
  });

  it("maps ButtonElement to postback buttons", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Choose an option",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "approve", label: "Approve", value: "yes" },
            { type: "button", id: "reject", label: "Reject", value: "no" },
          ],
        },
      ],
    });
    expect(result.buttons).toEqual([
      { type: "postback", title: "Approve", payload: "yes" },
      { type: "postback", title: "Reject", payload: "no" },
    ]);
  });

  it("falls back to button id when value is missing", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "action_1", label: "Click Me" },
          ],
        },
      ],
    });
    expect(result.buttons![0].payload).toBe("action_1");
  });

  it("maps LinkButtonElement to URL buttons", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "link-button", label: "Visit Site", url: "https://example.com" },
          ],
        },
      ],
    });
    expect(result.buttons).toEqual([
      { type: "url", title: "Visit Site", url: "https://example.com" },
    ]);
  });

  it("skips disabled buttons", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "active", label: "Active", disabled: false },
            { type: "button", id: "disabled", label: "Disabled", disabled: true },
          ],
        },
      ],
    });
    expect(result.buttons).toHaveLength(1);
    expect(result.buttons![0].title).toBe("Active");
  });

  it("creates a generic template when card has imageUrl + title + buttons", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Product Name",
      subtitle: "$29.99",
      imageUrl: "https://example.com/product.jpg",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "buy", label: "Buy Now", value: "buy" },
            { type: "link-button", label: "Details", url: "https://example.com/product" },
          ],
        },
      ],
    });
    expect(result.template).toBeDefined();
    expect(result.template!.type).toBe("generic");
    expect(result.template!.elements).toHaveLength(1);
    expect(result.template!.elements[0].title).toBe("Product Name");
    expect(result.template!.elements[0].subtitle).toBe("$29.99");
    expect(result.template!.elements[0].imageUrl).toBe("https://example.com/product.jpg");
    expect(result.template!.elements[0].buttons).toHaveLength(2);
    // When template is used, buttons should NOT be in the top-level result
    expect(result.buttons).toBeUndefined();
  });

  it("renders fields as label: value pairs", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "User Info",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Name", value: "Jane Doe" },
            { type: "field", label: "Email", value: "jane@example.com" },
          ],
        },
      ],
    });
    expect(result.message).toContain("Name: Jane Doe");
    expect(result.message).toContain("Email: jane@example.com");
  });

  it("renders tables as text rows", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "table",
          headers: ["Platform", "Status"],
          rows: [
            ["Instagram", "Active"],
            ["Telegram", "Active"],
          ],
        },
      ],
    });
    expect(result.message).toContain("Platform | Status");
    expect(result.message).toContain("Instagram | Active");
  });

  it("renders links as label: url pairs", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        { type: "link", label: "Documentation", url: "https://docs.example.com" },
      ],
    });
    expect(result.message).toContain("Documentation: https://docs.example.com");
  });

  it("extracts text from section children", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "section",
          children: [
            { type: "text", content: "Inside a section" },
          ],
        },
      ],
    });
    expect(result.message).toContain("Inside a section");
  });

  it("handles empty card", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [],
    });
    expect(result.message).toBe("");
    expect(result.buttons).toBeUndefined();
    expect(result.template).toBeUndefined();
  });

  it("handles mixed button types in single actions element", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Mixed",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "a", label: "Action", value: "do_it" },
            { type: "link-button", label: "Open", url: "https://example.com" },
            { type: "select", id: "sel" }, // Should be ignored
          ],
        },
      ],
    });
    expect(result.buttons).toHaveLength(2);
    expect(result.buttons![0].type).toBe("postback");
    expect(result.buttons![1].type).toBe("url");
  });

  // ─── WhatsApp interactive list (Select / RadioSelect) ──────────────────────

  it("maps a Select into a WhatsApp interactive list", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      title: "Pick a plan",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "plan",
              placeholder: "Choose plan",
              options: [
                { label: "Basic", value: "basic", description: "$10/mo" },
                { label: "Pro", value: "pro" },
              ],
            } as any,
          ],
        },
      ],
    });

    expect(result.interactive).toBeDefined();
    expect(result.interactive!.type).toBe("list");
    const list = result.interactive as Extract<typeof result.interactive, { type: "list" }>;
    expect(list.body.text).toBe("Pick a plan");
    expect(list.action.button).toBe("Choose plan");
    expect(list.action.sections[0].rows).toEqual([
      { id: "basic", title: "Basic", description: "$10/mo" },
      { id: "pro", title: "Pro" },
    ]);
    // Buttons are dropped: a list can't coexist with reply buttons on WhatsApp.
    expect(result.buttons).toBeUndefined();
  });

  it("maps a RadioSelect (radio_select) into a list and prefers it over buttons", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "ignored", label: "Ignored" } as any,
            {
              type: "radio_select",
              id: "size",
              label: "Size",
              options: [{ label: "Small", value: "s" }],
            } as any,
          ],
        },
      ],
    });

    expect(result.interactive?.type).toBe("list");
    expect(result.buttons).toBeUndefined();
  });

  it("truncates list button/row labels to WhatsApp limits", () => {
    const result = mapCardToZernioMessage({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "x",
              placeholder: "This button label is definitely way too long",
              options: [{ label: "A very long row title that exceeds the limit here", value: "v" }],
            } as any,
          ],
        },
      ],
    });
    const list = result.interactive as Extract<typeof result.interactive, { type: "list" }>;
    expect(list.action.button.length).toBeLessThanOrEqual(20);
    expect(list.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(24);
  });
});
