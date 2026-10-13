import { describe, expect, it, vi } from "vitest";
import { parseEvent, stream } from "../lib/api";
describe("SSE frames", () => {
  it("parses source references independently from text", () => {
    expect(parseEvent('event: delta\ndata: {"text":"Retention [1]"}')).toEqual({
      kind: "delta",
      data: { text: "Retention [1]" },
    });
    expect(parseEvent(": heartbeat")).toBeNull();
  });
  it("preserves Unicode and multiline JSON", () => {
    expect(
      parseEvent('event: done\ndata: {\ndata: "content": "Café"\ndata: }'),
    ).toEqual({ kind: "done", data: { content: "Café" } });
  });

  it("reads split CRLF frames and a final frame without a delimiter", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: delta\r\ndata: {"text":"The answer is 30 days."}\r\n\r\n',
      'event: done\r\ndata: {"content":"The answer is 30 days."}',
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
              controller.close();
            },
          }),
        ),
      ),
    );
    const events: Array<[string, unknown]> = [];
    try {
      await stream("/conversations/test/messages", {}, (kind, data) => {
        events.push([kind, data]);
      }, new AbortController().signal);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(events).toEqual([
      ["delta", { text: "The answer is 30 days." }],
      ["done", { content: "The answer is 30 days." }],
    ]);
  });
});
