import { lazy, Suspense, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  FileText,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { Source } from "../lib/api";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";

const MarkdownContent = lazy(() =>
  import("./ui/markdown").then(({ MarkdownContent }) => ({
    default: MarkdownContent,
  })),
);

export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow ?? "WORKSPACE"}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderOpen size={28} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="skeleton-grid" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function ErrorState({ error }: { error: Error | null }) {
  return error ? (
    <div className="error-state" role="alert">
      <AlertCircle size={18} />
      <span>{error.message}</span>
      <Button variant="ghost" onClick={() => window.location.reload()}>
        Retry
      </Button>
    </div>
  ) : null;
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {value === "ready" ? "Ready" : value.replace(/_/g, " ")}
    </span>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Suspense fallback={<div className="markdown-pending" role="status" />}>
        <MarkdownContent text={text} />
      </Suspense>
    </div>
  );
}
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Copy response"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Clipboard is unavailable");
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}Copy
    </Button>
  );
}
export function SourceViewer({
  source,
  onClose,
}: {
  source: Source | null;
  onClose: () => void;
}) {
  const [showPdf, setShowPdf] = useState(false);
  const pdf = source?.document_title.toLowerCase().endsWith(".pdf");
  return (
    <Dialog
      open={!!source}
      onOpenChange={(open) => {
        if (!open) {
          setShowPdf(false);
          onClose();
        }
      }}
      title={source?.document_title ?? "Source"}
      description={
        source?.page
          ? `Page ${source.page} · Retrieved source passage`
          : "Retrieved source passage"
      }
      wide
    >
      {source && (
        <>
          <div className="source-meta">
            <span className="status status-ready">
              <FileText size={14} /> Source {source.source_id || "passage"}
            </span>
            {source.available === false && (
              <span className="muted">
                Original document removed · saved excerpt
              </span>
            )}
          </div>
          <blockquote className="source-excerpt">{source.text}</blockquote>
          {source.available !== false && (
            <div className="row">
              <Button variant="outline" asChild>
                <a
                  href={`/api/v1/documents/${source.document_id}/file${source.page ? `#page=${source.page}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original{source.page ? ` · page ${source.page}` : ""}
                </a>
              </Button>
              {pdf && (
                <Button variant="outline" onClick={() => setShowPdf((v) => !v)}>
                  Preview PDF
                </Button>
              )}
            </div>
          )}
          {showPdf && pdf && (
            <iframe
              className="pdf-preview"
              title={`PDF page ${source.page ?? 1}`}
              src={`/api/v1/documents/${source.document_id}/file#page=${source.page ?? 1}`}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
export function SourceCards({
  sources,
  onSelect,
}: {
  sources: Source[];
  onSelect: (source: Source) => void;
}) {
  return (
    <div className="source-cards">
      {sources.map((source) => (
        <button
          key={source.chunk_id}
          className="source-card"
          onClick={() => onSelect(source)}
        >
          <span className="source-number">
            {source.source_id || <FileText size={14} />}
          </span>
          <span>
            <strong>{source.document_title}</strong>
            <small>
              {source.page
                ? `Page ${source.page}`
                : (source.metadata.heading ?? "Source passage")}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
export function Spinner() {
  return <Loader2 size={16} className="spin" />;
}
