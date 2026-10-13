import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Document, type Job, type Page } from "../lib/api";
import { Button } from "../components/ui/button";
import {
  Empty,
  ErrorState,
  Heading,
  Loading,
  Status,
} from "../components/shared";

export function Jobs() {
  const [offset, setOffset] = useState(0);
  const jobs = useQuery({
    queryKey: ["jobs", offset],
    queryFn: () => api<Page<Job>>(`/jobs?limit=20&offset=${offset}`),
    refetchInterval: 2000,
  });
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => api<Page<Document>>("/documents"),
    refetchInterval: 5000,
  });
  return (
    <div className="page">
      <Heading
        eyebrow="BACKGROUND PROCESSING"
        title="From documents to knowledge."
        description="Follow extraction, chunking, embedding, and indexing as they happen locally."
        action={
          <span className="live-badge">
            <Activity size={14} />
            Updates every 2 seconds
          </span>
        }
      />
      <ErrorState error={jobs.error ?? documents.error} />
      <div className="pipeline-steps">
        {["Upload", "Extract", "Chunk", "Embed", "Index", "Ready"].map(
          (step, index) => (
            <span key={step}>
              <i>{index + 1}</i>
              {step}
            </span>
          ),
        )}
      </div>
      {jobs.isLoading ? (
        <Loading />
      ) : !jobs.data?.items.length ? (
        <Empty
          title="Nothing waiting in the wings"
          detail="Upload documents and their processing progress will appear here."
        />
      ) : (
        <div className="job-list">
          {jobs.data.items.map((job) => (
            <article className="panel job-card" key={job.id}>
              <div className="job-top">
                <div className="document-name">
                  <span className="file-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <strong>
                      {documents.data?.items.find(
                        (d) => d.id === job.document_id,
                      )?.filename ?? "Document"}
                    </strong>
                    <small>
                      {job.operation === "delete"
                        ? "Removing document and passages"
                        : job.stage}{" "}
                      · attempt {job.attempts}
                    </small>
                  </div>
                </div>
                <Status value={job.status} />
              </div>
              <progress
                max={100}
                value={job.progress}
                aria-label={`Processing ${job.progress}%`}
              />
              <div className="job-bottom">
                <span>{job.progress}% complete</span>
                {job.error && (
                  <span className="document-error">{job.error}</span>
                )}
                {job.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await api(
                          `/documents/${job.document_id}${job.operation === "delete" ? "" : "/reprocess"}`,
                          {
                            method:
                              job.operation === "delete" ? "DELETE" : "POST",
                          },
                        );
                        await jobs.refetch();
                        toast.success("Retry queued");
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    <RefreshCw size={13} />
                    Retry
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="pagination">
        <Button
          variant="outline"
          size="sm"
          disabled={!offset}
          onClick={() => setOffset((v) => v - 20)}
        >
          Previous
        </Button>
        <span className="muted">Page {offset / 20 + 1}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + 20 >= (jobs.data?.total ?? 0)}
          onClick={() => setOffset((v) => v + 20)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
