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
        eyebrow="WORKSPACE"
        title="Overview"
        description="Documents, collections, and recent activity."
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
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-content">
        <section>
          <div className="section-heading">
            <div>
              <h2>Collections</h2>
              <p className="muted">Browse documents by collection.</p>
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
              title="No collections yet"
              detail="Create a collection to organize documents for search and chat."
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
            <div
              className={`collection-grid collection-count-${Math.min(collectionItems.length, 3)}`}
            >
              {collectionItems.slice(0, 3).map((collection, index) => (
                <Link
                  to={`/collections/${collection.id}`}
                  className="collection-card"
                  key={collection.id}
                >
                  <div className={`folder-icon folder-${index % 3}`}>
                    <FolderOpen size={20} />
                  </div>
                  <ArrowUpRight className="card-arrow" size={17} />
                  <h3>{collection.name}</h3>
                  <p>
                    {collection.description || "Documents in this collection."}
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
        <aside className="dashboard-shortcuts panel">
          <div>
            <h2>Work with your documents</h2>
            <p>Search passages or ask a question with cited sources.</p>
          </div>
          <Link to="/search">
            <Search size={17} />
            <span>Search passages</span>
            <ArrowRight size={15} />
          </Link>
          <Link to="/chat">
            <MessageSquare size={17} />
            <span>Start a conversation</span>
            <ArrowRight size={15} />
          </Link>
        </aside>
      </div>
      <section className="panel">
        <div className="section-heading panel-heading">
          <div>
            <h2>Recently added</h2>
            <p className="muted">Most recently added to your library.</p>
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
    </div>
  );
}
