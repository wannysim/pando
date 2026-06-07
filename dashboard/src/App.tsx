import { Activity, Ban, Copy, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { PandoApiClient } from "../../src/api/client";
import type {
  ApiAnalyticsResponse,
  ApiHealth,
  ApiJobDetailResponse,
  ApiJobEvent,
  ApiJobSummary,
} from "../../src/api/schema";
import type { JobStatus, StageName } from "../../src/core/types";
import { Alert } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { CodeBlock } from "./components/ui/code-block";
import {
  DescriptionDetails,
  DescriptionItem,
  DescriptionList,
  DescriptionTerm,
} from "./components/ui/description-list";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select } from "./components/ui/select";
import { Skeleton } from "./components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { Timeline, TimelineItem } from "./components/ui/timeline";
import { Text } from "./components/ui/typography";
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
  const [analytics, setAnalytics] = useState<ApiAnalyticsResponse | null>(null);
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

  const loadAnalytics = useCallback(async () => {
    const next = await client.analytics();
    setAnalytics(next);
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
    void loadAnalytics().catch((loadError: unknown) => setError(errorMessage(loadError)));
  }, [loadAnalytics, loadHealth]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const refresh = useCallback(async () => {
    await loadHealth();
    await loadAnalytics();
    await loadJobs();
    if (selectedJobId !== null) await loadDetail(selectedJobId);
  }, [loadAnalytics, loadDetail, loadHealth, loadJobs, selectedJobId]);

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
      {error === null ? null : (
        <Alert className="error-banner" variant="destructive">
          {error}
        </Alert>
      )}

      <section className="dashboard-workspace">
        <Card className="jobs-panel" aria-labelledby="jobs-heading">
          <CardHeader className="panel-header">
            <div>
              <Text variant="eyebrow">Operations</Text>
              <CardTitle id="jobs-heading" level={1}>
                Jobs
              </CardTitle>
            </div>
            <Button variant="outline" type="button" onClick={() => void refresh()}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <StatusTabs value={filter} onChange={setFilter} />
            <JobsTable jobs={jobs} loading={listState === "loading"} onOpen={loadDetail} />
          </CardContent>
        </Card>

        <AnalyticsPanel analytics={analytics} />

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

        <div className="intake-grid">
          <InlineBriefPanel client={client} onSubmitted={() => void refresh()} />
          <BriefSubmitPanel client={client} onSubmitted={() => void refresh()} />
        </div>
      </section>
    </main>
  );
}

function InlineBriefPanel({
  client,
  onSubmitted,
}: {
  client: PandoApiClient;
  onSubmitted: () => void;
}) {
  const [repo, setRepo] = useState("");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [references, setReferences] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = [
      repo.trim().length === 0 ? "Repo is required" : null,
      id.trim().length === 0 ? "ID is required" : null,
      body.trim().length === 0 ? "Describe what to build" : null,
    ].filter((value): value is string => value !== null);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;

    const assets = references
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const response = await client.submitBrief({
      brief: {
        assets: assets.length > 0 ? assets : undefined,
        body: body.trim(),
        title: optionalField(title),
      },
      id: id.trim(),
      repo: repo.trim(),
    });
    setSubmitted(`queued ${response.job.jobId}`);
    onSubmitted();
  }

  return (
    <Card className="submit-panel" aria-labelledby="inline-heading">
      <CardHeader className="panel-header">
        <div>
          <Text variant="eyebrow">Intake</Text>
          <CardTitle id="inline-heading">Describe a task</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form className="brief-form inline-brief-form" onSubmit={(event) => void submit(event)}>
          <Label>
            <span>Task repo</span>
            <Input value={repo} onChange={(event) => setRepo(event.target.value)} />
          </Label>
          <Label>
            <span>Task ID</span>
            <Input value={id} onChange={(event) => setId(event.target.value)} />
          </Label>
          <Label>
            <span>Task title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Label>
          <Label className="brief-form-wide">
            <span>What to build</span>
            <Textarea
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe the change in plain language."
            />
          </Label>
          <Label className="brief-form-wide">
            <span>References (one per line)</span>
            <Textarea
              rows={3}
              value={references}
              onChange={(event) => setReferences(event.target.value)}
              placeholder="spec/docs/asset paths, one per line"
            />
          </Label>
          <Button type="submit">
            <Send size={16} aria-hidden="true" />
            Describe task
          </Button>
        </form>
        {errors.length === 0 ? null : (
          <Alert className="form-errors" variant="destructive">
            <ul>
              {errors.map((formError) => (
                <li key={formError}>{formError}</li>
              ))}
            </ul>
          </Alert>
        )}
        {submitted === null ? null : (
          <Alert className="success-note" variant="success">
            {submitted}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticsPanel({ analytics }: { analytics: ApiAnalyticsResponse | null }) {
  if (analytics === null) {
    return (
      <Card
        className="analytics-panel"
        aria-label="Failure analytics"
        data-testid="analytics-panel"
      >
        <Skeleton>Loading analytics</Skeleton>
      </Card>
    );
  }

  const { failures, readiness } = analytics;
  const passPercent = Math.round(failures.passRate * 100);

  return (
    <Card
      className="analytics-panel"
      aria-labelledby="analytics-heading"
      data-testid="analytics-panel"
    >
      <CardHeader className="panel-header">
        <div>
          <Text variant="eyebrow">Reliability</Text>
          <CardTitle id="analytics-heading">Failure analytics</CardTitle>
        </div>
        <Badge variant={failures.totals.success === failures.totalJobs ? "success" : "warning"}>
          pass {passPercent}% ({failures.totals.success}/{failures.totalJobs})
        </Badge>
      </CardHeader>
      <CardContent>
        <DescriptionList className="analytics-totals">
          <DescriptionItem>
            <DescriptionTerm>Failure</DescriptionTerm>
            <DescriptionDetails>{failures.totals.failure}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Timeout</DescriptionTerm>
            <DescriptionDetails>{failures.totals.timeout}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Escalated</DescriptionTerm>
            <DescriptionDetails>{failures.totals.escalated}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Running</DescriptionTerm>
            <DescriptionDetails>{failures.totals.running}</DescriptionDetails>
          </DescriptionItem>
        </DescriptionList>

        <section>
          <CardTitle className="section-title" level={3}>
            Failure reasons
          </CardTitle>
          {failures.failureReasons.length === 0 ? (
            <Text variant="description">No terminal failures recorded.</Text>
          ) : (
            <div className="table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failures.failureReasons.map((reason) => (
                    <TableRow key={`${reason.terminalStatus} ${reason.reason}`}>
                      <TableCell>{reason.terminalStatus}</TableCell>
                      <TableCell>{reason.reason}</TableCell>
                      <TableCell>{reason.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <ReadinessSection readiness={readiness} />
      </CardContent>
    </Card>
  );
}

function ReadinessSection({ readiness }: { readiness: ApiAnalyticsResponse["readiness"] }) {
  return (
    <section data-testid="readiness-section">
      <CardTitle className="section-title" level={3}>
        Worker readiness
      </CardTitle>
      {readiness === null ? (
        <Text variant="description">No readiness evidence configured.</Text>
      ) : (
        <>
          <div className="readiness-head">
            <Badge variant="outline">target={readiness.target}</Badge>
            <Badge variant="outline">mode={readiness.mode}</Badge>
            <Badge variant={readiness.ok ? "success" : "destructive"}>
              {readiness.ok ? "ready" : "blocked"}
            </Badge>
          </div>
          {readiness.blockers.length > 0 ? (
            <div className="readiness-blockers">
              {readiness.blockers.map((blocker) => (
                <Text className="readiness-blocker" key={blocker} variant="description">
                  {blocker}
                </Text>
              ))}
            </div>
          ) : null}
          <DescriptionList className="readiness-checks">
            {readiness.checks.map((check) => (
              <DescriptionItem key={check.name}>
                <DescriptionTerm>{check.name}</DescriptionTerm>
                <DescriptionDetails>{check.pass ? "pass" : "fail"}</DescriptionDetails>
              </DescriptionItem>
            ))}
          </DescriptionList>
        </>
      )}
    </section>
  );
}

function HealthStrip({ health, onRefresh }: { health: ApiHealth | null; onRefresh: () => void }) {
  return (
    <Card className="health-strip" aria-label="Daemon health">
      <div className="health-main">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>{health === null ? "pando loading" : `${health.service} ${health.status}`}</span>
      </div>
      <Badge variant="secondary">
        {health === null ? "jobCount=-" : `jobCount=${health.store.jobCount}`}
      </Badge>
      <Badge variant="outline">{health === null ? "auth=-" : `auth=${health.auth.mode}`}</Badge>
      <Badge className="auth-note" variant="warning">
        Private network boundary; no built-in auth
      </Badge>
      <Button className="health-refresh" variant="ghost" type="button" onClick={onRefresh}>
        <RefreshCw size={15} aria-hidden="true" />
        Refresh
      </Button>
    </Card>
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
    <TabsList role="tablist" aria-label="Job status">
      {STATUS_TABS.map((tab) => (
        <TabsTrigger
          active={value === tab.value}
          aria-selected={value === tab.value}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          role="tab"
          type="button"
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
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
  if (loading && jobs.length === 0) return <Skeleton>Loading jobs</Skeleton>;

  return (
    <div className="table-wrap">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Repo</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.jobId}>
              <TableCell>
                <Button variant="link" type="button" onClick={() => void onOpen(job.jobId)}>
                  Open {job.jobId}
                </Button>
                <Text className="job-title" variant="description">
                  {job.title}
                </Text>
              </TableCell>
              <TableCell>
                <StatusBadge status={job.status} />
              </TableCell>
              <TableCell>{job.repo}</TableCell>
              <TableCell>{job.source}</TableCell>
              <TableCell>{job.attemptsLeft}</TableCell>
              <TableCell>{formatTime(job.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <Card className="detail-panel" aria-label="Job detail">
        <Skeleton>Loading detail</Skeleton>
      </Card>
    );
  }

  if (detail === null || selectedJobId === null) {
    return (
      <Card className="detail-panel empty" aria-label="Job detail">
        <Activity size={22} aria-hidden="true" />
        <CardTitle>Job detail</CardTitle>
      </Card>
    );
  }

  const job = detail.job;
  const now = new Date();

  return (
    <Card className="detail-panel" aria-label="Job detail">
      <CardHeader className="panel-header detail-header">
        <div>
          <Text variant="eyebrow">{job.repo}</Text>
          <CardTitle>{job.jobId}</CardTitle>
          <Text variant="description">{job.title}</Text>
        </div>
        <StatusBadge status={job.status} />
      </CardHeader>

      <CardContent>
        <DescriptionList className="context-strip" data-testid="context-strip">
          <DescriptionItem>
            <DescriptionTerm>Stage</DescriptionTerm>
            <DescriptionDetails>{currentStage(detail.recentEvents)}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Branch</DescriptionTerm>
            <DescriptionDetails>{job.branch ?? "-"}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Started</DescriptionTerm>
            <DescriptionDetails>
              {job.startedAt ? formatTime(job.startedAt) : "-"}
            </DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Elapsed</DescriptionTerm>
            <DescriptionDetails>
              {formatElapsed(job.startedAt, job.finishedAt ? new Date(job.finishedAt) : now)}
            </DescriptionDetails>
          </DescriptionItem>
        </DescriptionList>

        <div className="action-row">
          <Label className="compact-field">
            <span>Retry stage</span>
            <Select
              value={retryStage}
              onChange={(event) => setRetryStage(event.target.value as StageName)}
            >
              {RETRY_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </Select>
          </Label>
          <Button disabled={actionBusy !== null} type="button" onClick={() => onRetry(job.jobId)}>
            <RotateCcw size={16} aria-hidden="true" />
            Retry from {retryStage}
          </Button>
          <Button
            disabled={actionBusy !== null}
            variant="outline"
            type="button"
            onClick={() => onCancel(job.jobId)}
          >
            <Ban size={16} aria-hidden="true" />
            Cancel job
          </Button>
          <Button
            disabled={actionBusy !== null}
            variant="secondary"
            type="button"
            onClick={() => onCleanup(job.jobId)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Cleanup worktree
          </Button>
        </div>

        <DescriptionList>
          <DescriptionItem>
            <DescriptionTerm>Source</DescriptionTerm>
            <DescriptionDetails>{job.source}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Attempts left</DescriptionTerm>
            <DescriptionDetails>{job.attemptsLeft}</DescriptionDetails>
          </DescriptionItem>
          <DescriptionItem>
            <DescriptionTerm>Worktree</DescriptionTerm>
            <DescriptionDetails>{job.worktreePath ?? "-"}</DescriptionDetails>
          </DescriptionItem>
        </DescriptionList>

        <section>
          <CardTitle className="section-title" level={3}>
            Work item
          </CardTitle>
          <DescriptionList>
            <DescriptionItem>
              <DescriptionTerm>ID</DescriptionTerm>
              <DescriptionDetails>{job.workItem.id}</DescriptionDetails>
            </DescriptionItem>
            <DescriptionItem>
              <DescriptionTerm>Title</DescriptionTerm>
              <DescriptionDetails>{job.workItem.title}</DescriptionDetails>
            </DescriptionItem>
            <DescriptionItem>
              <DescriptionTerm>Payload</DescriptionTerm>
              <DescriptionDetails>{JSON.stringify(job.workItem.payload)}</DescriptionDetails>
            </DescriptionItem>
          </DescriptionList>
        </section>

        <section>
          <CardTitle className="section-title" level={3}>
            Timeline
          </CardTitle>
          <Timeline>
            {detail.recentEvents.map((event) => (
              <EventRow event={event} key={event.sequence} now={now} />
            ))}
          </Timeline>
        </section>
      </CardContent>
    </Card>
  );
}

function EventRow({ event, now }: { event: ApiJobEvent; now: Date }) {
  const duration = formatDurationMs(event.payload.durationMs);
  const cost = formatCostUsd(event.payload.costUsd);
  return (
    <TimelineItem>
      <div className="event-head">
        <span>#{event.sequence}</span>
        <strong>{event.type}</strong>
        <span>{event.stage ?? "-"}</span>
        {event.status === null ? (
          <Badge variant="secondary">-</Badge>
        ) : (
          <StatusBadge status={event.status} />
        )}
        <span>{event.gateName ?? "-"}</span>
        <time title={event.createdAt}>{formatAge(event.createdAt, now)}</time>
      </div>
      {duration === null && cost === null ? null : (
        <div className="event-metrics">
          {duration === null ? null : <Badge variant="secondary">{duration}</Badge>}
          {cost === null ? null : <Badge variant="secondary">{cost}</Badge>}
        </div>
      )}
      {event.reason === null ? null : <Text className="event-reason">{event.reason}</Text>}
      {event.evidence === null ? null : <EvidenceBlock evidence={event.evidence} />}
    </TimelineItem>
  );
}

const EVIDENCE_MAX = 160;

function EvidenceBlock({ evidence }: { evidence: string }) {
  const truncated = evidence.length > EVIDENCE_MAX;
  const shown = truncated ? `${evidence.slice(0, EVIDENCE_MAX)}…` : evidence;
  return (
    <div className="event-evidence-block">
      <CodeBlock className="event-evidence" data-testid="event-evidence">
        {shown}
      </CodeBlock>
      <Button
        className="copy-button"
        size="sm"
        variant="ghost"
        type="button"
        onClick={() => void copyToClipboard(evidence)}
      >
        <Copy size={13} aria-hidden="true" />
        Copy evidence
      </Button>
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
    <Card className="submit-panel" aria-labelledby="submit-heading">
      <CardHeader className="panel-header">
        <div>
          <Text variant="eyebrow">Intake</Text>
          <CardTitle id="submit-heading">Submit Brief</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form className="brief-form" onSubmit={(event) => void submit(event)}>
          <Label>
            <span>Repo</span>
            <Input value={repo} onChange={(event) => setRepo(event.target.value)} />
          </Label>
          <Label>
            <span>ID</span>
            <Input value={id} onChange={(event) => setId(event.target.value)} />
          </Label>
          <Label>
            <span>Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Label>
          <Label>
            <span>Brief path</span>
            <Input value={briefPath} onChange={(event) => setBriefPath(event.target.value)} />
          </Label>
          <Button type="submit">
            <Send size={16} aria-hidden="true" />
            Submit brief
          </Button>
        </form>
        {errors.length === 0 ? null : (
          <Alert className="form-errors" variant="destructive">
            <ul>
              {errors.map((formError) => (
                <li key={formError}>{formError}</li>
              ))}
            </ul>
          </Alert>
        )}
        {submitted === null ? null : (
          <Alert className="success-note" variant="success">
            {submitted}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return <Badge className={`status-badge ${status.toLowerCase()}`}>{status}</Badge>;
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
