import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUp,
  FileText,
  Layers3,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  stream,
  type Collection,
  type Conversation,
  type Document,
  type Message,
  type Page,
  type Source,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import {
  CopyButton,
  ErrorState,
  Heading,
  Markdown,
  SourceCards,
  SourceViewer,
  Spinner,
} from "../components/shared";

export function Chat() {
  const { conversationId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [collection, setCollection] = useState(params.get("collection") ?? "");
  const [question, setQuestion] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Message | null>(null);
  const [userDraft, setUserDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [editing, setEditing] = useState<Conversation | null>(null);
  const [title, setTitle] = useState("");
  const [removing, setRemoving] = useState<Conversation | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<Page<Collection>>("/collections"),
  });
  const selectedCollection = collection || collections.data?.items[0]?.id || "";
  const chats = useQuery({
    queryKey: ["conversations", chatSearch],
    queryFn: () =>
      api<Page<Conversation>>(
        `/conversations?q=${encodeURIComponent(chatSearch)}`,
      ),
  });
  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api<Conversation>(`/conversations/${conversationId}`),
    enabled: !!conversationId,
  });
  const currentCollection =
    conversation.data?.collection_id ?? selectedCollection;
  const documents = useQuery({
    queryKey: ["chat-documents", currentCollection],
    queryFn: () =>
      api<Page<Document>>(
        `/documents?collection_id=${currentCollection}&status=ready`,
      ),
    enabled: !!currentCollection,
  });
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [draft?.content, conversation.data?.messages?.length]);
  async function send(regenerate = false) {
    if (busy || (!question.trim() && !regenerate)) return;
    if (!currentCollection) {
      toast.error("Create a collection and add a document first");
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const content = question.trim();
    let id = conversationId;
    try {
      if (!id) {
        const chat = await api<Conversation>("/conversations", {
          method: "POST",
          body: JSON.stringify({ collection_id: currentCollection }),
        });
        id = chat.id;
        navigate(`/chat/${id}`, { replace: true });
      }
      setQuestion("");
      setUserDraft(regenerate ? "" : content);
      setDraft({
        id: "stream",
        role: "assistant",
        content: "",
        status: "streaming",
        citations: [],
        diagnostics: {},
      });
      let finished = false;
      await stream(
        `/conversations/${id}/messages`,
        { content, document_ids: documentIds, regenerate },
        (kind, raw) => {
          const data = raw as {
            text?: string;
            content?: string;
            citations?: Source[];
            diagnostics?: Record<string, unknown>;
            message?: string;
          };
          if (kind === "delta")
            setDraft((value) =>
              value
                ? { ...value, content: value.content + (data.text ?? "") }
                : value,
            );
          if (kind === "done") {
            finished = true;
            setDraft((value) =>
              value
                ? {
                    ...value,
                    content: data.content ?? "",
                    citations: data.citations ?? [],
                    diagnostics: data.diagnostics ?? {},
                    status: "complete",
                  }
                : value,
            );
          }
          if (kind === "error") throw new Error(data.message);
        },
        controller.signal,
      );
      if (!finished)
        throw new Error("The response was interrupted. You can regenerate it.");
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        toast.error((error as Error).message);
    } finally {
      if (id)
        await client.invalidateQueries({ queryKey: ["conversation", id] });
      await client.invalidateQueries({ queryKey: ["conversations"] });
      setDraft(null);
      setUserDraft("");
      setBusy(false);
      abort.current = null;
    }
  }
  const messages = (conversation.data?.messages ?? []).filter(
    (m) => !(busy && m.status === "streaming"),
  );
  return (
    <div className="page chat-page">
      <Heading
        eyebrow="DOCUMENT SEARCH"
        title="Ask your documents"
        description="Get answers with citations to the source passages."
      />
      <ErrorState
        error={collections.error ?? chats.error ?? conversation.error}
      />
      <div className="chat-layout">
        <aside className="chat-list">
          <Button
            variant="outline"
            className="full-width"
            disabled={busy}
            onClick={() => {
              navigate("/chat");
              setDocumentIds([]);
            }}
          >
            <Plus size={16} />
            New conversation
          </Button>
          <label className="search-input">
            <Search size={15} />
            <input
              placeholder="Find a conversation"
              aria-label="Search conversations"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
            />
          </label>
          <div className="chat-list-label">CONVERSATIONS</div>
          {chats.data?.items.map((chat) => (
            <div
              className={`chat-list-item ${chat.id === conversationId ? "selected" : ""}`}
              key={chat.id}
            >
              <Link
                to={`/chat/${chat.id}`}
                onClick={(e) => {
                  if (busy) e.preventDefault();
                  else setDocumentIds([]);
                }}
              >
                <MessageSquare size={15} />
                <span>{chat.title}</span>
              </Link>
              <div className="chat-item-actions">
                <button
                  aria-label={`Rename ${chat.title}`}
                  disabled={busy}
                  onClick={() => {
                    setEditing(chat);
                    setTitle(chat.title);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  aria-label={`Delete ${chat.title}`}
                  disabled={busy}
                  onClick={() => setRemoving(chat)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {!chats.data?.items.length && (
            <p className="muted chat-list-empty">
              Your conversations will appear here.
            </p>
          )}
        </aside>
        <div className="chat-workspace">
          <div className="chat-toolbar">
            <label className="row">
              <Layers3 size={17} />
              <select
                aria-label="Chat collection"
                disabled={!!conversationId || busy}
                value={currentCollection}
                onChange={(e) => {
                  setCollection(e.target.value);
                  setDocumentIds([]);
                }}
              >
                <option value="" disabled>
                  Select a collection
                </option>
                {collections.data?.items
                  .filter((c) => !c.deleting)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {conversationId && (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={`/api/v1/conversations/${conversationId}/export`}
                  download
                >
                  <ArrowDownToLine size={15} />
                  Export
                </a>
              </Button>
            )}
          </div>
          {!!documents.data?.items.length && (
            <details className="document-scope">
              <summary>
                {documentIds.length
                  ? `${documentIds.length} selected documents`
                  : "All documents in this collection"}
              </summary>
              <div>
                {documents.data.items.map((doc) => (
                  <label key={doc.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={documentIds.includes(doc.id)}
                      onChange={(e) =>
                        setDocumentIds((ids) =>
                          e.target.checked
                            ? [...ids, doc.id]
                            : ids.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    <FileText size={14} />
                    {doc.filename}
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="chat-messages" aria-live="polite">
            {!messages.length && !draft ? (
              <div className="chat-welcome">
                <div className="welcome-mark">
                  <Layers3 size={32} />
                </div>
                <h2>What would you like to know?</h2>
                <p>
                  Explore an idea, summarize a document, or
                  <br />
                  compare what your sources have to say.
                </p>
                <div className="suggestions">
                  {[
                    "What are the key decisions in these documents?",
                    "Compare the main recommendations.",
                    "What questions remain unanswered?",
                  ].map((value) => (
                    <button key={value} onClick={() => setQuestion(value)}>
                      {value}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
                {!documents.data?.items.length && (
                  <p className="muted">
                    <Link to="/upload">Add documents</Link> to give this
                    conversation something to work with.
                  </p>
                )}
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onSource={setSource}
                  />
                ))}
                {userDraft && (
                  <ChatMessage
                    message={{
                      id: "user-draft",
                      role: "user",
                      content: userDraft,
                      status: "complete",
                      citations: [],
                      diagnostics: {},
                    }}
                    onSource={setSource}
                  />
                )}{" "}
                {draft && <ChatMessage message={draft} onSource={setSource} />}
                <div ref={bottom} />
              </>
            )}
          </div>
          <div className="chat-composer-wrap">
            {conversationId && !!messages.length && !busy && (
              <Button size="sm" variant="ghost" onClick={() => void send(true)}>
                <RefreshCw size={13} />
                Regenerate last response
              </Button>
            )}
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                aria-label="Your question"
                placeholder="Ask a question about your documents…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={busy}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {busy ? (
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Stop response"
                  type="button"
                  onClick={() => abort.current?.abort()}
                >
                  <Square size={14} />
                </Button>
              ) : (
                <Button
                  size="icon"
                  aria-label="Send question"
                  disabled={!question.trim() || !currentCollection}
                >
                  <ArrowUp size={18} />
                </Button>
              )}
            </form>
            <p className="composer-note">
              Local models can make mistakes. Inspect the cited passages.
            </p>
          </div>
        </div>
      </div>
      <SourceViewer source={source} onClose={() => setSource(null)} />
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Rename conversation"
      >
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/conversations/${editing!.id}`, {
                method: "PATCH",
                body: JSON.stringify({ title }),
              });
              setEditing(null);
              await client.invalidateQueries({ queryKey: ["conversations"] });
            } catch (error) {
              toast.error((error as Error).message);
            }
          }}
        >
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <Button>Save title</Button>
        </form>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete conversation?"
        description="This removes the conversation and its saved messages."
      >
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              try {
                await api(`/conversations/${removing!.id}`, {
                  method: "DELETE",
                });
                if (removing!.id === conversationId) navigate("/chat");
                setRemoving(null);
                await client.invalidateQueries({ queryKey: ["conversations"] });
              } catch (error) {
                toast.error((error as Error).message);
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ChatMessage({
  message,
  onSource,
}: {
  message: Message;
  onSource: (source: Source) => void;
}) {
  const untrustedExcluded = message.diagnostics.untrusted_passages_excluded;
  return (
    <article className={`chat-message message-${message.role}`}>
      <div className="message-avatar">
        {message.role === "user" ? "You" : <Layers3 size={17} />}
      </div>
      <div className="message-body">
        <div className="message-author">
          {message.role === "user" ? "You" : "LocalDocs"}
          {message.status === "streaming" && (
            <span className="muted">
              <Spinner /> Thinking locally
            </span>
          )}
        </div>
        {message.content ? (
          <Markdown text={message.content} />
        ) : (
          <div className="thinking-dots">
            <span />
            <span />
            <span />
          </div>
        )}{" "}
        {!!message.citations.length && (
          <>
            <span className="sources-label">SOURCES</span>
            <SourceCards sources={message.citations} onSelect={onSource} />
          </>
        )}
        {message.status === "interrupted" && (
          <p className="document-error">
            Response interrupted. Regenerate to try again.
          </p>
        )}
        {message.diagnostics.uncited_answer === true && (
          <p className="document-error">
            This answer has no validated source references. Check the source
            documents.
          </p>
        )}
        {message.diagnostics.unverified_citation === true && (
          <p className="document-error">
            A source reference could not be verified. Check the source
            documents.
          </p>
        )}
        {typeof untrustedExcluded === "number" && untrustedExcluded > 0 && (
          <p className="muted">
            {untrustedExcluded} explicitly untrusted passage
            {untrustedExcluded === 1 ? " was" : "s were"} omitted from this
            answer.
          </p>
        )}
        {message.role === "assistant" && message.status === "complete" && (
          <CopyButton text={message.content} />
        )}
      </div>
    </article>
  );
}
