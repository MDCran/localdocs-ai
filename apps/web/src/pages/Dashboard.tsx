import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  api,
  type Collection,
  type Document,
  type Job,
  type Page,
} from "../lib/api";
import { date } from "../lib/utils";
import { Button } from "../components/ui/button";
import {
  Empty,
  ErrorState,
  Heading,
  Loading,
  Status,
} from "../components/shared";

export function Dashboard() {
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<Page<Collection>>("/collections"),
  });
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<Page<Document>>("/documents"),
    refetchInterval: 5000,
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<Page<Job>>("/jobs"),
    refetchInterval: 5000,
  });
  const docs = documents.data?.items ?? [];
  const collectionItems = collections.data?.items ?? [];
  const ready = docs.filter((d) => d.status === "ready").length;
  const pending =
    jobs.data?.items.filter(
      (j) => j.status === "queued" || j.status === "processing",
    ).length ?? 0;
  return (
    <div className="page">
      <Heading
        eyebrow="YOUR LOCAL KNOWLEDGE"
        title="Your knowledge, within reach."
        description="Bring your documents together. Find answers with the source attached."
        action={
          <Button asChild>
            <Link to="/upload">
              <Plus size={17} />
              Add documents
            </Link>
          </Button>
        }
      />
      <ErrorState error={collections.error ?? documents.error ?? jobs.error} />
      <div className="overview-hero">
        <div>
          <span className="hero-label">
            <ShieldCheck size={14} /> PRIVATE BY DESIGN
          </span>
          <h2>
            A conversation with
            <br />
            your own documents.
          </h2>
          <p>
            Ask a question, compare ideas, and trace every
            <br className="desktop-only" /> answer back to the passages that
            matter.
          </p>
          <Button asChild>
            <Link to="/chat">
              Open AI workspace
              <ArrowUpRight size={17} />
            </Link>
          </Button>
        </div>
        <div className="hero-graphic" aria-hidden="true">
          <div className="graphic-grid" />
          <div className="paper paper-back">
            <div />
            <div />
            <div />
          </div>
          <div className="paper paper-front">
            <FileText size={25} />
            <span className="paper-line" />
            <span className="paper-line short" />
            <span className="paper-highlight" />
            <span className="paper-line" />
            <span className="paper-line short" />
          </div>
          <div className="graphic-citation">
            <span>01</span>Grounded in your sources
            <ShieldCheck size={15} />
          </div>
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Documents ready",
            value: ready,
            icon: FileText,
            note:
              documents.data && documents.data.total > 100
                ? "In latest 100 documents"
                : "Indexed and searchable",
          },
          {
            label: "Collections",
            value: collections.data?.total ?? 0,
            icon: FolderOpen,
            note: "Organized by what matters",
          },
          {
            label: "In the queue",
            value: pending,
            icon: Upload,
            note: pending ? "Processing locally" : "All caught up",
          },
        ].map((item) => (
          <div className="stat-card" key={item.label}>
            <div className="stat-label">
              {item.label}
              <item.icon size={18} />
            </div>
            <strong>{item.value.toString().padStart(2, "0")}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
      <section>
        <div className="section-heading">
          <div>
            <h2>Collections</h2>
            <p className="muted">A little structure for everything you know.</p>
          </div>
          <Link className="text-link" to="/collections">
            View all
            <ArrowRight size={15} />
          </Link>
        </div>
        {collections.isLoading ? (
          <Loading />
        ) : !collectionItems.length ? (
          <Empty
            title="Start with a collection"
            detail="Group related documents to keep searches and conversations focused."
            action={
              <Button variant="outline" asChild>
                <Link to="/collections">
                  <Plus size={16} />
                  Create a collection
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="collection-grid">
            {collectionItems.slice(0, 3).map((collection, index) => (
              <Link
                to={`/collections/${collection.id}`}
                className="collection-card"
                key={collection.id}
              >
                <div className={`folder-icon folder-${index % 3}`}>
                  <FolderOpen size={22} />
                </div>
                <ArrowUpRight className="card-arrow" size={18} />
                <h3>{collection.name}</h3>
                <p>
                  {collection.description ||
                    "Your documents, organized in one place."}
                </p>
                <div className="card-footer">
                  <span>
                    {
                      docs.filter((d) => d.collection_id === collection.id)
                        .length
                    }{" "}
                    documents
                    {documents.data && documents.data.total > 100
                      ? " in recent list"
                      : ""}
                  </span>
                  <span>{date(collection.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="section-heading panel-heading">
          <div>
            <h2>Recently added</h2>
            <p className="muted">The latest additions to your workspace.</p>
          </div>
          <Link className="text-link" to="/documents">
            Document library
            <ArrowRight size={15} />
          </Link>
        </div>
        {documents.isLoading ? (
          <Loading />
        ) : !docs.length ? (
          <Empty
            title="Your library starts here"
            detail="Upload a PDF, Word document, text file, or Markdown note."
            action={
              <Button variant="outline" asChild>
                <Link to="/upload">Upload your first document</Link>
              </Button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {docs.slice(0, 5).map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <Link
                        className="document-name"
                        to={`/collections/${doc.collection_id}`}
                      >
                        <span className="file-icon">
                          <FileText size={19} />
                        </span>
                        {doc.filename}
                      </Link>
                    </td>
                    <td>
                      {collectionItems.find((c) => c.id === doc.collection_id)
                        ?.name ?? "Collection"}
                    </td>
                    <td>
                      <Status value={doc.status} />
                    </td>
                    <td>{date(doc.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="quick-actions">
        <Link to="/search">
          <Search size={19} />
          <span>
            <strong>Find a passage</strong>
            <small>Search without generating an answer</small>
          </span>
          <ArrowRight size={16} />
        </Link>
        <Link to="/chat">
          <MessageSquare size={19} />
          <span>
            <strong>Connect the dots</strong>
            <small>Ask questions across your documents</small>
          </span>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
