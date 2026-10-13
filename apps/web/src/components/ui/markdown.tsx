import ReactMarkdown from "react-markdown";

export function MarkdownContent({ text }: { text: string }) {
  return <ReactMarkdown>{text}</ReactMarkdown>;
}
