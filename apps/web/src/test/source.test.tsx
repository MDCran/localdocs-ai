import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Markdown, SourceCards, SourceViewer } from "../components/shared";
import type { Source } from "../lib/api";
const source: Source = {
  source_id: 1,
  chunk_id: "chunk",
  document_id: "doc",
  document_title: "handbook.pdf",
  page: 2,
  text: "Retention is 30 days.",
  score: 0.5,
  metadata: {},
};
it("opens the actual source selected by keyboard", async () => {
  const select = vi.fn();
  render(<SourceCards sources={[source]} onSelect={select} />);
  const user = userEvent.setup();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(select).toHaveBeenCalledWith(source);
});
it("retains saved excerpts when a document has been deleted", () => {
  render(
    <SourceViewer
      source={{ ...source, available: false }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText("Retention is 30 days.")).toBeInTheDocument();
  expect(screen.getByText(/Original document removed/)).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Open original/ }),
  ).not.toBeInTheDocument();
});
it("does not interpret document HTML as executable markup", async () => {
  const { container } = render(
    <Markdown
      text={"<script>alert(1)</script>\n\n[bad](javascript:alert(1))"}
    />,
  );
  await waitFor(() => {
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).not.toContain(
      "javascript:",
    );
  });
});
