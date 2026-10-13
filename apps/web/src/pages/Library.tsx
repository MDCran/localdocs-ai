import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Eye,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type Collection,
  type Document,
  type Page,
  type Source,
} from "../lib/api";
import { bytes, date } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import {
  Empty,
  ErrorState,
  Heading,
  Loading,
  SourceViewer,
  Spinner,
  Status,
} from "../components/shared";

export function Library({
  collectionsOnly = false,
  initialUpload = false,
}: {
  collectionsOnly?: boolean;
  initialUpload?: boolean;
}) {
  const { collectionId } = useParams();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(initialUpload);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetCollection, setTargetCollection] = useState(collectionId ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [removing, setRemoving] = useState<{
    kind: string;
    id: string;
    name: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<Page<Collection>>("/collections"),
    refetchInterval: 5000,
  });
  const documents = useQuery({
    queryKey: ["documents", collectionId, query, status, offset],
    queryFn: () =>
      api<Page<Document>>(
        `/documents?${new URLSearchParams({ q: query, status, offset: String(offset), limit: "20", ...(collectionId ? { collection_id: collectionId } : {}) })}`,
      ),
    refetchInterval: 3000,
    enabled: !collectionsOnly,
  });
  const current = collections.data?.items.find((c) => c.id === collectionId);
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["collections"] });
    await client.invalidateQueries({ queryKey: ["documents"] });
    await client.invalidateQueries({ queryKey: ["jobs"] });
  }
  const saveCollection = useMutation({
    mutationFn: () =>
      api(`/collections${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ name, description }),
      }),
    onSuccess: () => {
      setCollectionOpen(false);
      setName("");
      setDescription("");
      setEditing(null);
      void refresh();
      toast.success("Collection saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const selected = targetCollection || collections.data?.items[0]?.id;
      if (!selected) throw new Error("Create a collection first");
      if (!files.length) throw new Error("Choose at least one document");
      const errors: string[] = [];
      for (const [index, file] of files.entries()) {
        const form = new FormData();
        form.set("collection_id", selected);
        form.set("file", file);
        try {
          await api("/documents", { method: "POST", body: form });
        } catch (error) {
          errors.push(`${file.name}: ${(error as Error).message}`);
        }
        setUploadProgress(Math.round(((index + 1) / files.length) * 100));
      }
      await refresh();
      if (errors.length) throw new Error(errors.join("; "));
    },
    onSuccess: () => {
      setUploadOpen(false);
      setFiles([]);
      setUploadProgress(0);
      toast.success("Documents added to the processing queue");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/${removing!.kind}/${removing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
      toast.success("Deletion queued");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  async function inspectDocument(doc: Document) {
    try {
      const result = await api<
        Page<{
          id: string;
          text: string;
          page: number | null;
          metadata_: { heading?: string };
        }>
      >(`/documents/${doc.id}/chunks?limit=1`);
      const chunk = result.items[0];
      if (!chunk) {
        toast.info(doc.error ?? "This document has no indexed passages yet");
        return;
      }
      setSource({
        source_id: 1,
        chunk_id: chunk.id,
        document_id: doc.id,
        document_title: doc.filename,
        page: chunk.page,
        text: chunk.text,
        score: 0,
        metadata: chunk.metadata_,
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function openCollection(collection: Collection | null) {
    setEditing(collection);
    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
    setCollectionOpen(true);
  }
  return (
    <div className="page">
      <Heading
        eyebrow={collectionId ? "COLLECTION" : "YOUR KNOWLEDGE"}
        title={
          collectionsOnly
            ? "Collections"
            : (current?.name ?? "Document library")
        }
        description={
          current?.description ||
          (collectionsOnly
            ? "Organize related documents into focused spaces."
            : "A home for your PDFs, documents, and notes.")
        }
        action={
          <div className="row">
            <Button variant="outline" onClick={() => openCollection(null)}>
              <FolderOpen size={16} />
              New collection
            </Button>
            {!collectionsOnly && (
              <Button onClick={() => setUploadOpen(true)}>
                <Plus size={16} />
                Upload documents
              </Button>
            )}
          </div>
        }
      />
      <ErrorState error={collections.error ?? documents.error} />
      {collectionsOnly ? (
        collections.isLoading ? (
          <Loading />
        ) : (
          <div className="collection-grid">
            {collections.data?.items.map((collection, index) => (
              <article className="collection-card" key={collection.id}>
                <div className={`folder-icon folder-${index % 3}`}>
                  <FolderOpen size={22} />
                </div>
                <h3>
                  <Link to={`/collections/${collection.id}`}>
                    {collection.name}
                  </Link>
                </h3>
                <p>{collection.description || "No description yet."}</p>
                <div className="card-footer">
                  <span>
                    {collection.deleting
                      ? "Deleting…"
                      : date(collection.created_at)}
                  </span>
                  <div className="row">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${collection.name}`}
                      onClick={() => openCollection(collection)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${collection.name}`}
                      onClick={() =>
                        setRemoving({
                          kind: "collections",
                          id: collection.id,
                          name: collection.name,
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
            {!collections.data?.items.length && (
              <Empty
                title="Make room for a topic"
                detail="Create a collection, then add the documents you want to explore together."
                action={
                  <Button onClick={() => openCollection(null)}>
                    Create collection
                  </Button>
                }
              />
            )}
          </div>
        )
      ) : (
        <>
          {collectionId && (
            <div className="row collection-toolbar">
              <Button variant="outline" asChild>
                <Link to={`/chat?collection=${collectionId}`}>
                  Ask this collection
                </Link>
              </Button>
              <Button
                variant="ghost"
                onClick={() => current && openCollection(current)}
              >
                Edit collection
              </Button>
            </div>
          )}
          <div className="panel">
            <div className="table-toolbar">
              <label className="search-input">
                <Search size={17} />
                <input
                  aria-label="Search documents"
                  placeholder="Search documents…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All statuses</option>
                <option value="ready">Ready</option>
                <option value="queued">Queued</option>
                <option value="embedding">Embedding</option>
                <option value="failed">Failed</option>
              </select>
              <span className="muted">
                {documents.data?.total ?? 0} documents
              </span>
            </div>
            {documents.isLoading ? (
              <Loading />
            ) : !documents.data?.items.length ? (
              <Empty
                title={
                  query || status
                    ? "No documents match"
                    : "Add your first document"
                }
                detail={
                  query || status
                    ? "Try another name or status filter."
                    : "Supported formats: PDF, DOCX, TXT, and Markdown. Up to 25 MB each."
                }
                action={
                  !query && !status ? (
                    <Button
                      variant="outline"
                      onClick={() => setUploadOpen(true)}
                    >
                      <Plus size={16} />
                      Upload documents
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Status</th>
                      <th>Passages</th>
                      <th>Size</th>
                      <th>Added</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.data.items.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <div className="document-name">
                            <span className="file-icon">
                              <FileText size={19} />
                            </span>
                            <span>
                              <strong>{doc.filename}</strong>
                              {doc.error && (
                                <small className="document-error">
                                  {doc.error}
                                </small>
                              )}
                            </span>
                          </div>
                        </td>
                        <td>
                          <Status value={doc.status} />
                        </td>
                        <td>{doc.chunk_count}</td>
                        <td>{bytes(doc.size_bytes)}</td>
                        <td>{date(doc.created_at)}</td>
                        <td>
                          <div className="row">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`View ${doc.filename}`}
                              onClick={() => void inspectDocument(doc)}
                            >
                              <Eye size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Reprocess ${doc.filename}`}
                              onClick={async () => {
                                try {
                                  await api(`/documents/${doc.id}/reprocess`, {
                                    method: "POST",
                                  });
                                  await refresh();
                                  toast.success("Reprocessing queued");
                                } catch (error) {
                                  toast.error((error as Error).message);
                                }
                              }}
                            >
                              <RefreshCw size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${doc.filename}`}
                              onClick={() =>
                                setRemoving({
                                  kind: "documents",
                                  id: doc.id,
                                  name: doc.filename,
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - 20))}
              >
                Previous
              </Button>
              <span className="muted">Page {Math.floor(offset / 20) + 1}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 20 >= (documents.data?.total ?? 0)}
                onClick={() => setOffset((v) => v + 20)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
      <Dialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        title={editing ? "Edit collection" : "Create a collection"}
        description="Keep a set of related documents together."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveCollection.mutate();
          }}
          className="form-stack"
        >
          <label>
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product research"
              autoFocus
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What belongs in this collection?"
            />
          </label>
          <Button disabled={saveCollection.isPending || !name.trim()}>
            {saveCollection.isPending && <Spinner />}Save collection
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Add documents"
        description="Files are processed locally and become searchable when ready."
      >
        <div className="form-stack">
          <label>
            Collection
            <select
              value={targetCollection || collections.data?.items[0]?.id || ""}
              onChange={(e) => setTargetCollection(e.target.value)}
            >
              {collections.data?.items
                .filter((c) => !c.deleting)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {!collections.data?.items.length && (
            <Button
              variant="outline"
              onClick={() => {
                setUploadOpen(false);
                openCollection(null);
              }}
            >
              Create a collection first
            </Button>
          )}
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <UploadCloud size={34} />
            <strong>Drop documents here, or browse</strong>
            <span>PDF, DOCX, TXT, Markdown · 25 MB per file</span>
            <input
              type="file"
              aria-label="Choose documents"
              accept=".pdf,.docx,.txt,.md"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          {files.length > 0 && (
            <ul className="selected-files">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <FileText size={15} />
                  {file.name}
                  <small>{bytes(file.size)}</small>
                </li>
              ))}
            </ul>
          )}
          {upload.isPending && (
            <progress
              max={100}
              value={uploadProgress}
              aria-label="Upload progress"
            />
          )}
          <Button
            disabled={
              upload.isPending ||
              !files.length ||
              !collections.data?.items.length
            }
            onClick={() => upload.mutate()}
          >
            {upload.isPending ? <Spinner /> : <UploadCloud size={16} />}Upload{" "}
            {files.length || ""} document{files.length === 1 ? "" : "s"}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete from workspace?"
        description={`This removes ${removing?.name ?? "this item"} and its indexed passages. Saved chat excerpts remain available.`}
      >
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete
          </Button>
        </div>
      </Dialog>
      <SourceViewer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
