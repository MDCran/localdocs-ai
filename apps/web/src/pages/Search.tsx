import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Search, SlidersHorizontal } from "lucide-react";
import {
  api,
  type Collection,
  type Page,
  type SearchResult,
  type Source,
} from "../lib/api";
import { Button } from "../components/ui/button";
import {
  Empty,
  ErrorState,
  Heading,
  SourceViewer,
  Spinner,
} from "../components/shared";

export function SearchPage({ diagnostics = false }: { diagnostics?: boolean }) {
  const [collection, setCollection] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [topK, setTopK] = useState(6);
  const [page, setPage] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<Page<Collection>>("/collections"),
  });
  const selected = collection || collections.data?.items[0]?.id || "";
  const search = useMutation({
    mutationFn: () =>
      api<SearchResult>(`/retrieval/${diagnostics ? "debug" : "search"}`, {
        method: "POST",
        body: JSON.stringify({
          query,
          collection_id: selected,
          mode,
          top_k: topK,
          page: page ? Number(page) : null,
        }),
      }),
  });
  return (
    <div className="page">
      <Heading
        eyebrow={diagnostics ? "RETRIEVAL ENGINE" : "EXPLORE YOUR LIBRARY"}
        title={
          diagnostics
            ? "See what retrieval finds."
            : "Find the passage you need."
        }
        description={
          diagnostics
            ? "Inspect ranking, model details, and timings for a real retrieval query."
            : "Search by meaning or exact terms. No answer generation required."
        }
      />
      <form
        className="panel search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          search.mutate();
        }}
      >
        <div className="search-main">
          <Search size={22} />
          <input
            aria-label="Search query"
            required
            maxLength={4000}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
          />
          <Button disabled={search.isPending || !selected || !query.trim()}>
            {search.isPending ? <Spinner /> : <Search size={16} />}Search
          </Button>
        </div>
        <div className="search-options">
          <label>
            Collection
            <select
              aria-label="Search collection"
              value={selected}
              onChange={(e) => setCollection(e.target.value)}
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
          <label>
            Search method
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="hybrid">Hybrid</option>
              <option value="vector">Semantic</option>
              <option value="keyword">Keyword</option>
            </select>
          </label>
          <label>
            Results
            <input
              aria-label="Result limit"
              type="number"
              min={1}
              max={20}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
            />
          </label>
          <label>
            PDF page
            <input
              aria-label="Filter by PDF page"
              type="number"
              min={1}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              placeholder="Any"
            />
          </label>
        </div>
      </form>
      <ErrorState error={collections.error ?? search.error} />
      {search.data && (
        <>
          <div className="section-heading">
            <h2>{search.data.sources.length} relevant passages</h2>
            <span className="muted">
              {String(search.data.diagnostics.total_ms)} ms ·{" "}
              {String(search.data.diagnostics.score_kind)}
            </span>
          </div>
          {diagnostics && (
            <div className="diagnostic-grid">
              {Object.entries(search.data.diagnostics).map(([key, value]) => (
                <div className="panel diagnostic" key={key}>
                  <small>{key.replaceAll("_", " ")}</small>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
          )}
          <p className="score-note">
            <SlidersHorizontal size={14} />
            Ranking scores indicate relevance within this search; they are not
            probabilities of correctness.
          </p>
          <div className="search-results">
            {search.data.sources.map((result, index) => (
              <button
                className="panel search-result"
                key={result.chunk_id}
                onClick={() => setSource({ ...result, source_id: index + 1 })}
              >
                <div className="result-heading">
                  <span className="file-icon">
                    <BookOpen size={18} />
                  </span>
                  <strong>{result.document_title}</strong>
                  <span className="muted">
                    {result.page ? `Page ${result.page}` : "Text passage"}
                  </span>
                  <span className="result-score">
                    {result.score.toFixed(4)}
                  </span>
                </div>
                <p>{result.text}</p>
                <span className="text-link">Inspect source →</span>
              </button>
            ))}
          </div>
          {!search.data.sources.length && (
            <Empty
              title="No passages found"
              detail="Try another collection, broader wording, or a different search method."
            />
          )}
        </>
      )}
      {!search.data && !search.isPending && (
        <Empty
          title="Follow an idea into your documents"
          detail="Search a collection to see the passages most relevant to your question."
        />
      )}
      <SourceViewer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
