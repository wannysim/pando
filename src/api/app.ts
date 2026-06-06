import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JobStatus, WorkItem } from "../core/types";
import type {
  CancelJobInput,
  EnqueueJobInput,
  JobCleanupRequest,
  JobEventRecord,
  JobRecord,
  RequestJobCleanupInput,
  RetryJobInput,
} from "../db/index";
import {
  type ApiBriefSubmitResponse,
  formatStageList,
  formatStatusList,
  isJobStatus,
  isStageName,
  type ApiJobCleanupResponse,
  toApiJobDetail,
  toApiJobEvent,
  toApiJobSummary,
  type ApiError,
  type ApiHealth,
  type ApiJobActionResponse,
  type ApiJobDetailResponse,
  type ApiJobEventsResponse,
  type ApiJobList,
  type ApiResponse,
} from "./schema";

export interface PandoApiStore {
  enqueueJob(input: EnqueueJobInput): JobRecord;
  listJobs(input?: { status?: JobStatus }): JobRecord[];
  getJob(jobId: string): JobRecord | undefined;
  listEvents(jobId: string): JobEventRecord[];
  retryJob(input: RetryJobInput): JobRecord;
  cancelJob(input: CancelJobInput): JobRecord;
  requestJobCleanup(input: RequestJobCleanupInput): JobCleanupRequest;
}

export interface PandoApiOptions {
  store: PandoApiStore;
  defaultRetryBudget?: number;
  staticDashboard?: StaticDashboardOptions;
}

export interface StaticDashboardOptions {
  root: string;
  basePath?: string;
}

interface ApiRouteError {
  code: string;
  message: string;
  status: ContentfulStatusCode;
}

class ApiHttpError extends Error implements ApiRouteError {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ContentfulStatusCode,
  ) {
    super(message);
  }
}

export function createPandoApiApp(opts: PandoApiOptions): Hono {
  const app = new Hono();

  app.onError((error, context) => jsonError(context, routeErrorFrom(error)));
  app.notFound((context) =>
    jsonError(context, routeError("route_not_found", "route not found", 404)),
  );

  app.get("/health", (context) => {
    const data: ApiHealth = {
      apiVersion: "v1",
      auth: { mode: "private-network" },
      daemon: { status: "ok" },
      service: "pando",
      status: "ok",
      store: { jobCount: opts.store.listJobs().length, status: "ok" },
    };
    return jsonOk(context, data);
  });

  app.get("/jobs", (context) => {
    const status = parseStatusFilter(context.req.query("status"));
    const jobs = opts.store.listJobs(status === undefined ? undefined : { status });
    return jsonOk<ApiJobList>(context, { jobs: jobs.map(toApiJobSummary) });
  });

  app.get("/jobs/:jobId", (context) => {
    const jobId = context.req.param("jobId");
    const job = requireJob(opts.store, jobId);
    return jsonOk<ApiJobDetailResponse>(context, {
      job: toApiJobDetail(job),
      recentEvents: opts.store.listEvents(jobId).map(toApiJobEvent),
    });
  });

  app.get("/jobs/:jobId/events", (context) => {
    const jobId = context.req.param("jobId");
    requireJob(opts.store, jobId);
    return jsonOk<ApiJobEventsResponse>(context, {
      events: opts.store.listEvents(jobId).map(toApiJobEvent),
    });
  });

  app.post("/jobs/:jobId/retry", async (context) => {
    const jobId = context.req.param("jobId");
    requireJob(opts.store, jobId);
    const body = await readJsonObject(context);
    const from = parseRetryStage(body.from);
    const attemptsLeft = parseAttemptsLeft(body.attemptsLeft, opts.defaultRetryBudget ?? 10);
    const job = opts.store.retryJob({ attemptsLeft, from, jobId });
    return jsonOk<ApiJobActionResponse>(context, {
      action: { status: "retried", type: "retry" },
      job: toApiJobSummary(job),
    });
  });

  app.post("/jobs/:jobId/cancel", async (context) => {
    const jobId = context.req.param("jobId");
    requireJob(opts.store, jobId);
    const body = await readJsonObject(context);
    const input: CancelJobInput = {
      jobId,
      requestedBy: "api",
      reason: optionalString(body.reason, "reason"),
    };
    const job = opts.store.cancelJob(input);
    const action =
      job.status === "CANCELED"
        ? ({ status: "canceled", type: "cancel" } as const)
        : ({ status: "cancel_requested", type: "cancel" } as const);

    return jsonOk<ApiJobActionResponse>(
      context,
      {
        action,
        job: toApiJobSummary(job),
      },
      job.status === "CANCELED" ? 200 : 202,
    );
  });

  app.post("/jobs/:jobId/cleanup", (context) => {
    const jobId = context.req.param("jobId");
    requireJob(opts.store, jobId);
    const request = opts.store.requestJobCleanup({ jobId, requestedBy: "api" });

    return jsonOk<ApiJobCleanupResponse>(
      context,
      {
        action: {
          status: "cleanup_requested",
          type: "cleanup",
          worktreePath: request.worktreePath,
        },
        job: toApiJobSummary(request.job),
      },
      202,
    );
  });

  app.post("/briefs", async (context) => {
    const body = await readJsonObject(context);
    const item = briefWorkItem(body);
    const job = opts.store.enqueueJob({
      item,
      retryBudget: opts.defaultRetryBudget ?? 10,
    });

    return jsonOk<ApiBriefSubmitResponse>(context, { job: toApiJobSummary(job) }, 201);
  });

  if (opts.staticDashboard !== undefined) {
    mountStaticDashboard(app, opts.staticDashboard);
  }

  return app;
}

function mountStaticDashboard(app: Hono, opts: StaticDashboardOptions): void {
  const basePath = normalizeBasePath(opts.basePath ?? "/dashboard");

  app.get(basePath, (context) => serveDashboardIndex(context, opts.root));
  app.get(`${basePath}/assets/*`, (context) => {
    const requestPath = new URL(context.req.url).pathname;
    const relativePath = decodePathPart(requestPath.slice(`${basePath}/`.length));
    return serveDashboardFile(context, opts.root, relativePath);
  });
  app.get(`${basePath}/*`, (context) => serveDashboardIndex(context, opts.root));
}

async function serveDashboardIndex(context: Context, root: string): Promise<Response> {
  return serveDashboardFile(context, root, "index.html");
}

async function serveDashboardFile(
  context: Context,
  root: string,
  relativePath: string,
): Promise<Response> {
  const filePath = safeJoin(root, relativePath);
  if (filePath === undefined) {
    return jsonError(context, routeError("invalid_static_path", "invalid static asset path", 400));
  }

  try {
    const body = await readFile(filePath);
    return new Response(body, {
      headers: { "content-type": contentType(filePath) },
      status: 200,
    });
  } catch (error) {
    if (isNotFound(error)) {
      return jsonError(
        context,
        routeError("static_asset_not_found", "static asset not found", 404),
      );
    }
    throw error;
  }
}

function safeJoin(root: string, relativePath: string): string | undefined {
  const filePath = join(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (
    pathFromRoot.length === 0 ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith("../") ||
    pathFromRoot.startsWith("..\\")
  ) {
    return undefined;
  }
  return filePath;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") && withLeadingSlash !== "/"
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseStatusFilter(value: string | undefined): JobStatus | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (isJobStatus(value)) return value;
  throw routeError("invalid_status", `status must be one of ${formatStatusList()}`, 400);
}

function parseRetryStage(value: unknown): RetryJobInput["from"] {
  if (typeof value === "string" && isStageName(value)) return value;
  throw routeError("invalid_stage", `from must be one of ${formatStageList()}`, 400);
}

function parseAttemptsLeft(value: unknown, defaultRetryBudget: number): number {
  if (value === undefined) return defaultRetryBudget;
  if (Number.isInteger(value) && typeof value === "number" && value > 0) return value;
  throw routeError("invalid_attempts", "attemptsLeft must be a positive integer", 400);
}

function requireJob(store: PandoApiStore, jobId: string): JobRecord {
  const job = store.getJob(jobId);
  if (job !== undefined) return job;
  throw routeError("job_not_found", `job not found: ${jobId}`, 404);
}

function briefWorkItem(body: Record<string, unknown>): WorkItem {
  const id = requiredString(body.id, "id");
  const repo = requiredString(body.repo, "repo");
  const briefPath = optionalString(body.briefPath, "briefPath") ?? `briefs/${id}/brief.md`;

  return {
    branch: optionalString(body.branch, "branch"),
    id,
    payload: { briefPath, kind: "brief" },
    repo,
    source: "brief",
    title: optionalString(body.title, "title") ?? id,
  };
}

async function readJsonObject(context: Context): Promise<Record<string, unknown>> {
  const text = await context.req.text();
  if (text.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw routeError("invalid_json", "request body must be a JSON object", 400);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw routeError("invalid_json", "request body must be a JSON object", 400);
  }
  return parsed as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw routeError("invalid_request", `${field} must be a string`, 400);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw routeError("invalid_request", `${field} is required`, 400);
}

function jsonOk<T>(context: Context, data: T, status: ContentfulStatusCode = 200): Response {
  return context.json<ApiResponse<T>>({ data, ok: true }, status);
}

function jsonError(context: Context, error: ApiRouteError): Response {
  return context.json<ApiError>(
    {
      error: { code: error.code, message: error.message },
      ok: false,
    },
    error.status,
  );
}

function routeError(code: string, message: string, status: ContentfulStatusCode): ApiRouteError {
  return new ApiHttpError(code, message, status);
}

function routeErrorFrom(error: Error): ApiRouteError {
  if (isRouteError(error)) return error;

  const message = error.message;
  if (message.startsWith("job not found: ")) {
    return routeError("job_not_found", message, 404);
  }
  if (message.includes(" is not terminal: ") || message.includes(" is terminal: ")) {
    return routeError("invalid_job_state", message, 409);
  }
  if (message.includes(" has no worktree path to cleanup")) {
    return routeError("invalid_job_state", message, 409);
  }
  return routeError("internal_error", "internal error", 500);
}

function isRouteError(error: Error): error is Error & ApiRouteError {
  const maybe = error as Partial<ApiRouteError>;
  return (
    typeof maybe.code === "string" &&
    typeof maybe.message === "string" &&
    typeof maybe.status === "number"
  );
}
