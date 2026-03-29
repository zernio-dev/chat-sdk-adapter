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
});
