import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JobStatus } from "../core/types";
import type { CancelJobInput, JobEventRecord, JobRecord, RetryJobInput } from "../db/index";
import {
  formatStageList,
  formatStatusList,
  isJobStatus,
  isStageName,
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
  listJobs(input?: { status?: JobStatus }): JobRecord[];
  getJob(jobId: string): JobRecord | undefined;
  listEvents(jobId: string): JobEventRecord[];
  retryJob(input: RetryJobInput): JobRecord;
  cancelJob(input: CancelJobInput): JobRecord;
}

export interface PandoApiOptions {
  store: PandoApiStore;
  defaultRetryBudget?: number;
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

  return app;
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
