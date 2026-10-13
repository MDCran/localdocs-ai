import { describe, expect, it } from "vitest";
import { parseEvent } from "../lib/api";
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
});
