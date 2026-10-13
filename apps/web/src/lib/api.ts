export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
export interface Collection {
  id: string;
  name: string;
  description: string;
  deleting: boolean;
  created_at: string;
}
export interface Document {
  id: string;
  collection_id: string;
  filename: string;
  extension: string;
  size_bytes: number;
  status: string;
  error: string | null;
  chunk_count: number;
  page_count: number;
  created_at: string;
}
export interface Job {
  id: string;
  document_id: string;
  operation: string;
  stage: string;
  status: string;
  progress: number;
  attempts: number;
  error: string | null;
  created_at: string;
}
export interface Source {
  source_id: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  page: number | null;
  text: string;
  score: number;
  vector_similarity?: number;
  keyword_score?: number;
  available?: boolean;
  metadata: { heading?: string };
}
export interface Message {
  id: string;
  role: string;
  content: string;
  status: string;
  citations: Source[];
  diagnostics: Record<string, unknown>;
}
export interface Conversation {
  id: string;
  collection_id: string;
  title: string;
  updated_at: string;
  messages?: Message[];
}
export interface Settings {
  chat_model: string;
  temperature: number;
  top_k: number;
  context_tokens: number;
  min_similarity: number;
  hybrid: boolean;
}
export interface SearchResult {
  sources: Source[];
  diagnostics: Record<string, unknown>;
}
export interface Health {
  status: string;
  components: Record<string, string>;
}
export interface Model {
  name: string;
  size: number;
  details: { parameter_size: string };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      detail?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function parseEvent(
  frame: string,
): { kind: string; data: unknown } | null {
  const kind = frame
    .split("\n")
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!kind || !data) return null;
  return { kind, data: JSON.parse(data) };
}

export async function stream(
  path: string,
  body: unknown,
  onEvent: (kind: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error?.message ?? "Response could not start");
  }
  if (!response.body) throw new Error("Streaming is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n?/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const parsed = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) onEvent(parsed.kind, parsed.data);
      }
      if (done) {
        const parsed = parseEvent(buffer.trim());
        if (parsed) onEvent(parsed.kind, parsed.data);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
