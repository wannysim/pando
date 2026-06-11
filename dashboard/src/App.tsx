import {
  Activity,
  Ban,
  Copy,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { PandoApiClient } from "../../src/api/client";
import type {
  ApiAnalyticsResponse,
  ApiHealth,
  ApiJobDetailResponse,
  ApiJobEvent,
  ApiJobSummary,
  ApiRepoSummary,
} from "../../src/api/schema";
import type { JobStatus, StageName } from "../../src/core/types";
import { groupEventsByStage, type StageTimelineEntry } from "./lib/timeline";
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
import { MagicCard } from "./components/magicui/magic-card";
import { ShineBorder } from "./components/magicui/shine-border";
import "./styles.css";

interface DashboardAppProps {
  client: PandoApiClient;
}

type StatusFilter = "ALL" | JobStatus;
type LoadState = "idle" | "loading" | "ready" | "error";
type ThemePreference = "dark" | "light" | "system";

const STATUS_TABS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "ALL" },
  { label: "Queued", value: "QUEUED" },
  { label: "Running", value: "IMPL" },
  { label: "Failed", value: "FAILED" },
  { label: "Escalated", value: "ESCALATED" },
  { label: "Done", value: "DONE" },
];

const RETRY_STAGES: readonly StageName[] = ["SPEC", "PLAN", "TEST", "IMPL", "REVIEW", "PR"];

const POLL_INTERVAL_MS = 4000;
const THEME_STORAGE_KEY = "pando-dashboard-theme";
const TERMINAL_STATUSES = new Set<JobStatus>(["DONE", "FAILED", "ESCALATED", "CANCELED"]);

function isActiveStatus(status: JobStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

export function DashboardApp({ client }: DashboardAppProps) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [analytics, setAnalytics] = useState<ApiAnalyticsResponse | null>(null);
  const [repos, setRepos] = useState<ApiRepoSummary[]>([]);
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

  useEffect(() => {
    applyThemePreference(themePreference);
    writeThemePreference(themePreference);
  }, [themePreference]);

  const loadHealth = useCallback(async () => {
    const next = await client.health();
    setHealth(next);
  }, [client]);

  const loadAnalytics = useCallback(async () => {
    const next = await client.analytics();
    setAnalytics(next);
  }, [client]);

  const loadRepos = useCallback(async () => {
    const next = await client.listRepos();
    setRepos(next.repos);
  }, [client]);

  const loadJobs = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setListState("loading");
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
    },
    [client, listInput],
  );

  const loadDetail = useCallback(
    async (jobId: string, { silent = false }: { silent?: boolean } = {}) => {
      setSelectedJobId(jobId);
      // A background poll must never flip to the loading skeleton: that unmounts
      // the detail panel, collapsing expanded timelines and resetting scroll.
      if (!silent) setDetailState("loading");
      setError(null);
      try {
        const next = await client.getJob(jobId);
        setDetail(next);
        setDetailState("ready");
      } catch (loadError) {
        if (!silent) setDetailState("error");
        setError(errorMessage(loadError));
      }
    },
    [client],
  );

  useEffect(() => {
    void loadHealth().catch((loadError: unknown) => setError(errorMessage(loadError)));
    void loadAnalytics().catch((loadError: unknown) => setError(errorMessage(loadError)));
    void loadRepos().catch(() => setRepos([]));
  }, [loadAnalytics, loadHealth, loadRepos]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const refresh = useCallback(async () => {
    await loadHealth();
    await loadAnalytics();
    await loadJobs({ silent: true });
    if (selectedJobId !== null) await loadDetail(selectedJobId, { silent: true });
  }, [loadAnalytics, loadDetail, loadHealth, loadJobs, selectedJobId]);

  const hasActiveJobs = useMemo(() => jobs.some((job) => isActiveStatus(job.status)), [jobs]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const handle = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [hasActiveJobs, refresh]);

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
      <HealthStrip
        health={health}
        onRefresh={() => void refresh()}
        onThemeChange={setThemePreference}
        themePreference={themePreference}
      />
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
            <div className="jobs-actions">
              {hasActiveJobs ? (
                <Badge className="live-badge" variant="secondary">
                  <Loader2 className="spin" size={13} aria-hidden="true" />
                  Live · auto-refresh
                </Badge>
              ) : null}
              <Button variant="outline" type="button" onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </Button>
            </div>
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
          <InlineBriefPanel client={client} repos={repos} onSubmitted={() => void refresh()} />
          <BriefSubmitPanel client={client} repos={repos} onSubmitted={() => void refresh()} />
        </div>
      </section>
    </main>
  );
}

function RepoField({
  label,
  repos,
  value,
  onChange,
}: {
  label: string;
  repos: ApiRepoSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Label>
      <span>{label}</span>
      {repos.length === 0 ? (
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select a repo…</option>
          {repos.map((repo) => (
            <option key={repo.name} value={repo.name}>
              {repo.name}
            </option>
          ))}
        </Select>
      )}
    </Label>
  );
}

function InlineBriefPanel({
  client,
  repos,
  onSubmitted,
}: {
  client: PandoApiClient;
  repos: ApiRepoSummary[];
  onSubmitted: () => void;
}) {
  const [repo, setRepo] = useState("");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [references, setReferences] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const acceptanceCriteria = splitLines(acceptance);
    const nextErrors = [
      repo.trim().length === 0 ? "Repo is required" : null,
      id.trim().length === 0 ? "ID is required" : null,
      body.trim().length === 0 ? "Describe what to build" : null,
      acceptanceCriteria.length === 0 ? "Add at least one acceptance criterion" : null,
    ].filter((value): value is string => value !== null);
    setErrors(nextErrors);
    setSubmitted(null);
    if (nextErrors.length > 0) return;

    const assets = splitLines(references);

    try {
      const response = await client.submitBrief({
        brief: {
          acceptanceCriteria,
          assets: assets.length > 0 ? assets : undefined,
          body: body.trim(),
          title: optionalField(title),
        },
        id: id.trim(),
        repo: repo.trim(),
      });
      setSubmitted(`queued ${response.job.jobId}`);
      onSubmitted();
    } catch (submitError) {
      setErrors([errorMessage(submitError)]);
    }
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
          <RepoField label="Task repo" repos={repos} value={repo} onChange={setRepo} />
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
            <span>Acceptance criteria (one per line)</span>
            <Textarea
              rows={3}
              value={acceptance}
              onChange={(event) => setAcceptance(event.target.value)}
              placeholder="One checkable outcome per line (required)."
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
            {readiness.claude === null ? null : (
              <Badge variant={readiness.claude.liveRunnable ? "success" : "warning"}>
                claude: {readiness.claude.mode}
                {readiness.claude.liveRunnable ? "" : " (not live-runnable)"}
              </Badge>
            )}
          </div>
          {readiness.claude?.blocker === undefined ? null : (
            <Text className="readiness-blocker" variant="description">
              {readiness.claude.blocker.reason}
            </Text>
          )}
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

function HealthStrip({
  health,
  onRefresh,
  onThemeChange,
  themePreference,
}: {
  health: ApiHealth | null;
  onRefresh: () => void;
  onThemeChange: (preference: ThemePreference) => void;
  themePreference: ThemePreference;
}) {
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
      <div className="health-actions">
        <ThemeControl onChange={onThemeChange} value={themePreference} />
        <Button className="health-refresh" variant="ghost" type="button" onClick={onRefresh}>
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </Button>
      </div>
    </Card>
  );
}

function ThemeControl({
  onChange,
  value,
}: {
  onChange: (preference: ThemePreference) => void;
  value: ThemePreference;
}) {
  const options: Array<{
    icon: typeof Monitor;
    label: string;
    value: ThemePreference;
  }> = [
    { icon: Monitor, label: "Use system theme", value: "system" },
    { icon: Sun, label: "Use light theme", value: "light" },
    { icon: Moon, label: "Use dark theme", value: "dark" },
  ];

  return (
    <div className="theme-control" role="group" aria-label="Color theme">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <Button
            aria-label={option.label}
            className={
              value === option.value ? "theme-control__button active" : "theme-control__button"
            }
            key={option.value}
            onClick={() => onChange(option.value)}
            size="icon"
            title={option.label}
            type="button"
            variant="ghost"
          >
            <Icon size={15} aria-hidden="true" />
          </Button>
        );
      })}
    </div>
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
                <StatusSignal
                  active={isActiveStatus(job.status)}
                  status={job.status}
                  testId={`job-status-${job.jobId}`}
                />
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
  const cancelPending = job.cancelRequestedAt !== null && isActiveStatus(job.status);

  return (
    <Card className="detail-panel" aria-label="Job detail">
      <CardHeader className="panel-header detail-header">
        <div>
          <Text variant="eyebrow">{job.repo}</Text>
          <CardTitle>{job.jobId}</CardTitle>
          <Text variant="description">{job.title}</Text>
        </div>
        <div className="detail-status">
          <StatusSignal active={isActiveStatus(job.status)} status={job.status} />
          {cancelPending ? (
            <Badge className="live-badge" variant="warning">
              <Loader2 className="spin" size={12} aria-hidden="true" />
              Canceling…
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {stoppedReason(job.status, detail.recentEvents) === null ? null : (
          <Alert className="stop-reason" variant="destructive" data-testid="stop-reason">
            <strong>{job.status}</strong> · {stoppedReason(job.status, detail.recentEvents)}
          </Alert>
        )}

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
            disabled={actionBusy !== null || cancelPending}
            variant="outline"
            type="button"
            onClick={() => onCancel(job.jobId)}
          >
            <Ban size={16} aria-hidden="true" />
            {cancelPending ? "Cancel requested" : "Cancel job"}
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
            Stage timeline
          </CardTitle>
          <StageTimeline events={detail.recentEvents} now={now} />
        </section>
      </CardContent>
    </Card>
  );
}

function StageTimeline({ events, now }: { events: ApiJobEvent[]; now: Date }) {
  const entries = groupEventsByStage(events);
  if (entries.length === 0) {
    return <Text variant="description">No stage activity yet.</Text>;
  }
  return (
    <Timeline>
      {entries.map((entry) => (
        <StageEntryRow entry={entry} key={entry.key} now={now} />
      ))}
    </Timeline>
  );
}

const STAGE_OUTCOME_VARIANT = {
  failed: "destructive",
  passed: "success",
  running: "secondary",
} as const;

function StageEntryRow({ entry, now }: { entry: StageTimelineEntry; now: Date }) {
  const duration = formatDurationMs(entry.durationMs);
  const cost = formatCostUsd(entry.costUsd);
  return (
    <TimelineItem>
      <div className="stage-head">
        <strong className="stage-name">{entry.stage ?? "step"}</strong>
        {entry.attempt > 1 ? <Badge variant="outline">attempt {entry.attempt}</Badge> : null}
        <Badge variant={STAGE_OUTCOME_VARIANT[entry.outcome]}>{entry.outcome}</Badge>
        {entry.gateName === null ? null : <span className="stage-gate">{entry.gateName}</span>}
      </div>
      <div className="stage-times">
        <span>start {formatClock(entry.startedAt)}</span>
        {duration === null ? null : <span className="stage-duration">{duration}</span>}
        {entry.endedAt === null ? (
          <span>running · {formatAge(entry.startedAt, now)}</span>
        ) : (
          <span>end {formatClock(entry.endedAt)}</span>
        )}
        {cost === null ? null : <span className="stage-cost">{cost}</span>}
      </div>
      {entry.reason === null ? null : <Text className="event-reason">{entry.reason}</Text>}
      {entry.evidence === null ? null : <EvidenceBlock evidence={entry.evidence} />}
      <RawEvents events={entry.events} />
    </TimelineItem>
  );
}

function RawEvents({ events }: { events: ApiJobEvent[] }) {
  return (
    <details className="raw-events">
      <summary>Raw events ({events.length})</summary>
      <div className="raw-event-list">
        {events.map((event) => (
          <div className="raw-event" key={event.sequence}>
            <span className="raw-event-seq">#{event.sequence}</span>
            <span className="raw-event-type">{event.type}</span>
            <time title={event.createdAt}>{formatClock(event.createdAt)}</time>
          </div>
        ))}
      </div>
    </details>
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
  repos,
  onSubmitted,
}: {
  client: PandoApiClient;
  repos: ApiRepoSummary[];
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
          <RepoField label="Repo" repos={repos} value={repo} onChange={setRepo} />
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

interface StatusSignalProps {
  active: boolean;
  status: JobStatus;
  testId?: string;
}

const STATUS_SIGNAL_META: Record<
  JobStatus,
  {
    label: string;
    progress: number;
    tone: "danger" | "neutral" | "success" | "warning";
  }
> = {
  CANCELED: {
    label: "Canceled",
    progress: 0,
    tone: "neutral",
  },
  DONE: {
    label: "Completed",
    progress: 100,
    tone: "success",
  },
  ESCALATED: {
    label: "Needs review",
    progress: 25,
    tone: "warning",
  },
  FAILED: {
    label: "Failed",
    progress: 0,
    tone: "danger",
  },
  IMPL: {
    label: "Implementing",
    progress: 66,
    tone: "neutral",
  },
  PLAN: {
    label: "Planning",
    progress: 33,
    tone: "neutral",
  },
  PR: {
    label: "Preparing PR",
    progress: 92,
    tone: "neutral",
  },
  QUEUED: {
    label: "Queued",
    progress: 8,
    tone: "warning",
  },
  REVIEW: {
    label: "Reviewing",
    progress: 82,
    tone: "neutral",
  },
  SPEC: {
    label: "Specifying",
    progress: 18,
    tone: "neutral",
  },
  TEST: {
    label: "Testing",
    progress: 50,
    tone: "neutral",
  },
};

function StatusSignal({ active, status, testId }: StatusSignalProps) {
  const meta = STATUS_SIGNAL_META[status];
  return (
    <MagicCard className={`status-signal status-signal--${meta.tone}`} data-testid={testId}>
      <ShineBorder data-testid="status-shine-border" />
      <span className="status-signal__heading">
        {active ? <Loader2 className="spin" size={13} aria-label="in progress" /> : null}
        <strong>{status}</strong>
      </span>
      <span className="status-signal__label">{meta.label}</span>
      <span className="status-signal__meter" aria-label={`progress ${meta.progress}%`}>
        <span className={`status-signal__meter-fill status-signal__meter-fill--${meta.progress}`} />
      </span>
    </MagicCard>
  );
}

function isThemePreference(value: string): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored !== null && isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writeThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // localStorage can be unavailable in constrained browser contexts.
  }
}

function applyThemePreference(preference: ThemePreference) {
  document.documentElement.dataset.themePreference = preference;
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "light dark";
    return;
  }
  document.documentElement.dataset.theme = preference;
  document.documentElement.style.colorScheme = preference;
}

function optionalField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const FAILURE_EVENT_TYPES = new Set([
  "stage-failed",
  "gate-fail",
  "gate-blocking",
  "engine-fail",
  "daemon-error",
]);

function stoppedReason(status: JobStatus, events: ApiJobEvent[]): string | null {
  if (status !== "FAILED" && status !== "ESCALATED") return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event !== undefined && event.reason !== null && FAILURE_EVENT_TYPES.has(event.type)) {
      return event.reason;
    }
  }
  return status === "ESCALATED" ? "escalated for human input" : "job failed";
}

function formatClock(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(11, 19);
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
