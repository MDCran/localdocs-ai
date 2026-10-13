import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Cpu, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, type Health, type Model, type Settings } from "../lib/api";
import { bytes } from "../lib/utils";
import { Button } from "../components/ui/button";
import {
  ErrorState,
  Heading,
  Loading,
  Spinner,
  Status,
} from "../components/shared";

export function SettingsPage() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () =>
      api<{ items: Model[]; embedding_model: string; dimensions: number }>(
        "/models",
      ),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30000,
  });
  return (
    <div className="page">
      <Heading
        eyebrow="WORKSPACE SETTINGS"
        title="A setup that works for you."
        description="Choose a local model and tune how documents inform each answer."
      />
      <ErrorState error={settings.error ?? models.error} />
      {settings.isLoading ? (
        <Loading />
      ) : (
        settings.data && (
          <SettingsForm
            key={JSON.stringify(settings.data)}
            initial={settings.data}
            models={models.data?.items ?? []}
            onSaved={() =>
              void client.invalidateQueries({ queryKey: ["settings"] })
            }
          />
        )
      )}
      <section className="panel settings-section">
        <div className="settings-section-title">
          <Cpu size={20} />
          <div>
            <h2>Local models</h2>
            <p className="muted">Downloaded models available through Ollama.</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh models"
            onClick={() => void models.refetch()}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        {models.data?.items.map((model) => (
          <div className="model-row" key={model.name}>
            <span className="model-icon">
              <Cpu size={18} />
            </span>
            <span>
              <strong>{model.name}</strong>
              <small>
                {model.details.parameter_size} · {bytes(model.size)}
              </small>
            </span>
            <Check size={17} />
          </div>
        ))}
        <div className="settings-note">
          Embedding model:{" "}
          <strong>{models.data?.embedding_model ?? "nomic-embed-text"}</strong>{" "}
          · {models.data?.dimensions ?? 768} dimensions. Change the embedding
          model in your local configuration, then reprocess affected documents.
        </div>
      </section>
      <section className="panel settings-section">
        <div className="settings-section-title">
          <ShieldCheck size={20} />
          <div>
            <h2>Service health & privacy</h2>
            <p className="muted">
              Inference, indexing, and storage stay on your machine.
            </p>
          </div>
        </div>
        {Object.entries(health.data?.components ?? {}).map(([key, value]) => (
          <div className="health-row" key={key}>
            <span>{key.replaceAll("_", " ")}</span>
            <Status value={value} />
          </div>
        ))}
        <p className="settings-note">
          Single-user local workspace. Keep application ports bound to
          localhost. Authentication is required before exposing it on a shared
          network.
        </p>
      </section>
    </div>
  );
}

function SettingsForm({
  initial,
  models,
  onSaved,
}: {
  initial: Settings;
  models: Model[];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial);
  const mutation = useMutation({
    mutationFn: () =>
      api<Settings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(value),
      }),
    onSuccess: () => {
      toast.success("Settings saved");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <form
      className="panel settings-section"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="settings-section-title">
        <div>
          <h2>Answer generation</h2>
          <p className="muted">
            Balance response style, context size, and retrieval breadth.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <label>
          Chat model
          <input
            required
            list="local-models"
            value={value.chat_model}
            onChange={(e) =>
              setValue((v) => ({ ...v, chat_model: e.target.value }))
            }
          />
          <datalist id="local-models">
            {models.map((model) => (
              <option key={model.name} value={model.name} />
            ))}
          </datalist>
          <small>Default: llama3.2:3b. The model must be downloaded.</small>
        </label>
        <label>
          Temperature
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={value.temperature}
            onChange={(e) =>
              setValue((v) => ({ ...v, temperature: Number(e.target.value) }))
            }
          />
          <small>Lower values favor more consistent wording.</small>
        </label>
        <label>
          Retrieved passages
          <input
            type="number"
            min={1}
            max={20}
            value={value.top_k}
            onChange={(e) =>
              setValue((v) => ({ ...v, top_k: Number(e.target.value) }))
            }
          />
          <small>Maximum passages considered for each answer.</small>
        </label>
        <label>
          Context token budget
          <input
            type="number"
            min={256}
            max={8000}
            value={value.context_tokens}
            onChange={(e) =>
              setValue((v) => ({
                ...v,
                context_tokens: Number(e.target.value),
              }))
            }
          />
          <small>Conservative text estimate; not a model tokenizer.</small>
        </label>
        <label>
          Minimum semantic similarity
          <input
            type="number"
            min={-1}
            max={1}
            step={0.05}
            value={value.min_similarity}
            onChange={(e) =>
              setValue((v) => ({
                ...v,
                min_similarity: Number(e.target.value),
              }))
            }
          />
          <small>A relevance gate, not a confidence score.</small>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={value.hybrid}
            onChange={(e) =>
              setValue((v) => ({ ...v, hybrid: e.target.checked }))
            }
          />
          Combine semantic and keyword search
        </label>
      </div>
      <div className="settings-footer">
        <Button disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}Save settings
        </Button>
      </div>
    </form>
  );
}
