import { Activity, Ban, Copy, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { PandoApiClient } from "../../src/api/client";
import type {
  ApiHealth,
  ApiJobDetailResponse,
  ApiJobEvent,
  ApiJobSummary,
} from "../../src/api/schema";
import type { JobStatus, StageName } from "../../src/core/types";
import "./styles.css";

interface DashboardAppProps {
  client: PandoApiClient;
}

type StatusFilter = "ALL" | JobStatus;
type LoadState = "idle" | "loading" | "ready" | "error";

const STATUS_TABS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "ALL" },
  { label: "Queued", value: "QUEUED" },
  { label: "Running", value: "IMPL" },
  { label: "Failed", value: "FAILED" },
  { label: "Escalated", value: "ESCALATED" },
  { label: "Done", value: "DONE" },
];

const RETRY_STAGES: readonly StageName[] = ["SPEC", "PLAN", "TEST", "IMPL", "REVIEW", "PR"];

export function DashboardApp({ client }: DashboardAppProps) {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [jobs, setJobs] = useState<ApiJobSummary[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiJobDetailResponse | null>(null);
  const [listState, setListState] = useState<LoadState>("idle");
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryStage, setRetryStage] = useState<StageName>("IMPL");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const listInput = useMemo(() => (filter === "ALL" ? undefined : { status: filter }), [filter]);

  const loadHealth = useCallback(async () => {
    const next = await client.health();
    setHealth(next);
  }, [client]);

  const loadJobs = useCallback(async () => {
    setListState("loading");
    setError(null);
    try {
      const next = await client.listJobs(listInput);
      setJobs(next.jobs);
      setListState("ready");
      return next.jobs;
    } catch (loadError) {
      setListState("error");
      setError(errorMessage(loadError));
      return [];
    }
  }, [client, listInput]);

  const loadDetail = useCallback(
    async (jobId: string) => {
      setSelectedJobId(jobId);
      setDetailState("loading");
      setError(null);
      try {
        const next = await client.getJob(jobId);
        setDetail(next);
        setDetailState("ready");
      } catch (loadError) {
        setDetailState("error");
        setError(errorMessage(loadError));
      }
    },
    [client],
  );

  useEffect(() => {
    void loadHealth().catch((loadError: unknown) => setError(errorMessage(loadError)));
  }, [loadHealth]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const refresh = useCallback(async () => {
    await loadHealth();
    await loadJobs();
    if (selectedJobId !== null) await loadDetail(selectedJobId);
  }, [loadDetail, loadHealth, loadJobs, selectedJobId]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setActionBusy(label);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (actionError) {
        setError(errorMessage(actionError));
      } finally {
        setActionBusy(null);
      }
    },
    [refresh],
  );

  return (
    <main className="dashboard-shell">
      <HealthStrip health={health} onRefresh={() => void refresh()} />
      {error === null ? null : <div className="error-banner">{error}</div>}

      <section className="dashboard-grid">
        <section className="jobs-panel" aria-labelledby="jobs-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Operations</p>
              <h1 id="jobs-heading">Jobs</h1>
            </div>
            <button className="icon-button" type="button" onClick={() => void refresh()}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
          <StatusTabs value={filter} onChange={setFilter} />
          <JobsTable jobs={jobs} loading={listState === "loading"} onOpen={loadDetail} />
        </section>

        <JobDetailPanel
          actionBusy={actionBusy}
          detail={detail}
          loading={detailState === "loading"}
          onCancel={(jobId) =>
            void runAction("cancel", async () => client.cancelJob(jobId, { reason: "dashboard" }))
          }
          onCleanup={(jobId) => void runAction("cleanup", async () => client.cleanupJob(jobId))}
          onRetry={(jobId) =>
            void runAction("retry", async () => client.retryJob(jobId, { from: retryStage }))
          }
          retryStage={retryStage}
          selectedJobId={selectedJobId}
          setRetryStage={setRetryStage}
        />
      </section>

      <BriefSubmitPanel client={client} onSubmitted={() => void refresh()} />
    </main>
  );
}

function HealthStrip({ health, onRefresh }: { health: ApiHealth | null; onRefresh: () => void }) {
  return (
    <section className="health-strip" aria-label="Daemon health">
      <div className="health-main">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>{health === null ? "pando loading" : `${health.service} ${health.status}`}</span>
      </div>
      <span>{health === null ? "jobCount=-" : `jobCount=${health.store.jobCount}`}</span>
      <span>{health === null ? "auth=-" : `auth=${health.auth.mode}`}</span>
      <span className="auth-note">Private network boundary; no built-in auth</span>
      <button className="ghost-button" type="button" onClick={onRefresh}>
        <RefreshCw size={15} aria-hidden="true" />
        Refresh
      </button>
    </section>
  );
}

function StatusTabs({
  onChange,
  value,
}: {
  onChange: (value: StatusFilter) => void;
  value: StatusFilter;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Job status">
      {STATUS_TABS.map((tab) => (
        <button
          aria-selected={value === tab.value}
          className={value === tab.value ? "tab active" : "tab"}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function JobsTable({
  jobs,
  loading,
  onOpen,
}: {
  jobs: ApiJobSummary[];
  loading: boolean;
  onOpen: (jobId: string) => Promise<void>;
}) {
  if (loading && jobs.length === 0) return <div className="skeleton">Loading jobs</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Repo</th>
            <th>Source</th>
            <th>Attempts</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobId}>
              <td>
                <button
                  className="link-button"
                  type="button"
                  onClick={() => void onOpen(job.jobId)}
                >
                  Open {job.jobId}
                </button>
                <div className="muted">{job.title}</div>
              </td>
              <td>
                <StatusBadge status={job.status} />
              </td>
              <td>{job.repo}</td>
              <td>{job.source}</td>
              <td>{job.attemptsLeft}</td>
              <td>{formatTime(job.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobDetailPanel({
  actionBusy,
  detail,
  loading,
  onCancel,
  onCleanup,
  onRetry,
  retryStage,
  selectedJobId,
  setRetryStage,
}: {
  actionBusy: string | null;
  detail: ApiJobDetailResponse | null;
  loading: boolean;
  onCancel: (jobId: string) => void;
  onCleanup: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  retryStage: StageName;
  selectedJobId: string | null;
  setRetryStage: (stage: StageName) => void;
}) {
  if (loading) {
    return (
      <section className="detail-panel" aria-label="Job detail">
        <div className="skeleton">Loading detail</div>
      </section>
    );
  }

  if (detail === null || selectedJobId === null) {
    return (
      <section className="detail-panel empty" aria-label="Job detail">
        <Activity size={22} aria-hidden="true" />
        <h2>Job detail</h2>
      </section>
    );
  }

  const job = detail.job;
  const now = new Date();

  return (
    <section className="detail-panel" aria-label="Job detail">
      <div className="panel-header detail-header">
        <div>
          <p className="eyebrow">{job.repo}</p>
          <h2>{job.jobId}</h2>
          <p className="detail-title">{job.title}</p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <dl className="meta-grid context-strip" data-testid="context-strip">
        <div>
          <dt>Stage</dt>
          <dd>{currentStage(detail.recentEvents)}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{job.branch ?? "-"}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{job.startedAt ? formatTime(job.startedAt) : "-"}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{formatElapsed(job.startedAt, job.finishedAt ? new Date(job.finishedAt) : now)}</dd>
        </div>
      </dl>

      <div className="action-row">
        <label className="compact-field">
          <span>Retry stage</span>
          <select
            value={retryStage}
            onChange={(event) => setRetryStage(event.target.value as StageName)}
          >
            {RETRY_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <button disabled={actionBusy !== null} type="button" onClick={() => onRetry(job.jobId)}>
          <RotateCcw size={16} aria-hidden="true" />
          Retry from {retryStage}
        </button>
        <button disabled={actionBusy !== null} type="button" onClick={() => onCancel(job.jobId)}>
          <Ban size={16} aria-hidden="true" />
          Cancel job
        </button>
        <button disabled={actionBusy !== null} type="button" onClick={() => onCleanup(job.jobId)}>
          <Trash2 size={16} aria-hidden="true" />
          Cleanup worktree
        </button>
      </div>

      <dl className="meta-grid">
        <div>
          <dt>Source</dt>
          <dd>{job.source}</dd>
        </div>
        <div>
          <dt>Attempts left</dt>
          <dd>{job.attemptsLeft}</dd>
        </div>
        <div>
          <dt>Worktree</dt>
          <dd>{job.worktreePath ?? "-"}</dd>
        </div>
      </dl>

      <section>
        <h3>Work item</h3>
        <dl className="meta-grid">
          <div>
            <dt>ID</dt>
            <dd>{job.workItem.id}</dd>
          </div>
          <div>
            <dt>Title</dt>
            <dd>{job.workItem.title}</dd>
          </div>
          <div>
            <dt>Payload</dt>
            <dd>{JSON.stringify(job.workItem.payload)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>Timeline</h3>
        <ol className="event-list">
          {detail.recentEvents.map((event) => (
            <EventRow event={event} key={event.sequence} now={now} />
          ))}
        </ol>
      </section>
    </section>
  );
}

function EventRow({ event, now }: { event: ApiJobEvent; now: Date }) {
  const duration = formatDurationMs(event.payload.durationMs);
  const cost = formatCostUsd(event.payload.costUsd);
  return (
    <li>
      <div className="event-head">
        <span>#{event.sequence}</span>
        <strong>{event.type}</strong>
        <span>{event.stage ?? "-"}</span>
        <span className={`event-status${event.status ? ` ${event.status.toLowerCase()}` : ""}`}>
          {event.status ?? "-"}
        </span>
        <span>{event.gateName ?? "-"}</span>
        <time title={event.createdAt}>{formatAge(event.createdAt, now)}</time>
      </div>
      {duration === null && cost === null ? null : (
        <div className="event-metrics">
          {duration === null ? null : <span className="event-metric">{duration}</span>}
          {cost === null ? null : <span className="event-metric">{cost}</span>}
        </div>
      )}
      {event.reason === null ? null : <p className="event-reason">{event.reason}</p>}
      {event.evidence === null ? null : <EvidenceBlock evidence={event.evidence} />}
    </li>
  );
}

const EVIDENCE_MAX = 160;

function EvidenceBlock({ evidence }: { evidence: string }) {
  const truncated = evidence.length > EVIDENCE_MAX;
  const shown = truncated ? `${evidence.slice(0, EVIDENCE_MAX)}…` : evidence;
  return (
    <div className="event-evidence-block">
      <code className="event-evidence" data-testid="event-evidence">
        {shown}
      </code>
      <button
        className="ghost-button copy-button"
        type="button"
        onClick={() => void copyToClipboard(evidence)}
      >
        <Copy size={13} aria-hidden="true" />
        Copy evidence
      </button>
    </div>
  );
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard?.writeText(value);
}

function BriefSubmitPanel({
  client,
  onSubmitted,
}: {
  client: PandoApiClient;
  onSubmitted: () => void;
}) {
  const [repo, setRepo] = useState("");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [briefPath, setBriefPath] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = [
      repo.trim().length === 0 ? "Repo is required" : null,
      id.trim().length === 0 ? "ID is required" : null,
    ].filter((value): value is string => value !== null);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;

    const response = await client.submitBrief({
      briefPath: optionalField(briefPath),
      id: id.trim(),
      repo: repo.trim(),
      title: optionalField(title),
    });
    setSubmitted(`queued ${response.job.jobId}`);
    onSubmitted();
  }

  return (
    <section className="submit-panel" aria-labelledby="submit-heading">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Intake</p>
          <h2 id="submit-heading">Submit Brief</h2>
        </div>
      </div>
      <form className="brief-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Repo</span>
          <input value={repo} onChange={(event) => setRepo(event.target.value)} />
        </label>
        <label>
          <span>ID</span>
          <input value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Brief path</span>
          <input value={briefPath} onChange={(event) => setBriefPath(event.target.value)} />
        </label>
        <button type="submit">
          <Send size={16} aria-hidden="true" />
          Submit brief
        </button>
      </form>
      {errors.length === 0 ? null : (
        <ul className="form-errors">
          {errors.map((formError) => (
            <li key={formError}>{formError}</li>
          ))}
        </ul>
      )}
      {submitted === null ? null : <p className="success-note">{submitted}</p>}
    </section>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`status-badge ${status.toLowerCase()}`}>{status}</span>;
}

function optionalField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function currentStage(events: ApiJobEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event !== undefined && event.stage !== null) return event.stage;
  }
  return "-";
}

function formatDurationMs(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatCostUsd(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return `$${value.toFixed(4)}`;
}

function formatElapsed(startedAt: string | null, endAt: Date): string {
  if (startedAt === null) return "-";
  const totalSecs = Math.max(
    0,
    Math.floor((endAt.getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

function formatAge(createdAt: string, now: Date): string {
  const totalSecs = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m} m ${s} s ago` : `${s} s ago`;
}

function formatTime(value: string): string {
  return new Date(value).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
