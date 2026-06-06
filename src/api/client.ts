import type { JobStatus, StageName } from "../core/types";
import type {
  ApiError,
  ApiBriefSubmitResponse,
  ApiHealth,
  ApiJobActionResponse,
  ApiJobCleanupResponse,
  ApiJobDetailResponse,
  ApiJobEventsResponse,
  ApiJobList,
  ApiResponse,
} from "./schema";

export type PandoApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PandoApiClientOptions {
  baseUrl: string;
  fetch?: PandoApiFetch;
}

export interface ListJobsRequest {
  status?: JobStatus;
}

export interface RetryJobRequest {
  from: StageName;
  attemptsLeft?: number;
}

export interface CancelJobRequest {
  reason?: string;
}

export interface InlineBriefInput {
  title?: string;
  goal?: string;
  userStory?: string;
  acceptanceCriteria?: string[];
  screensOrBehavior?: string;
  nonGoals?: string[];
  assets?: string[];
  openQuestions?: string[];
  body?: string;
}

export interface SubmitBriefRequest {
  branch?: string;
  brief?: InlineBriefInput;
  briefPath?: string;
  id: string;
  repo: string;
  title?: string;
}

export interface PandoApiClient {
  health(): Promise<ApiHealth>;
  listJobs(input?: ListJobsRequest): Promise<ApiJobList>;
  getJob(jobId: string): Promise<ApiJobDetailResponse>;
  listEvents(jobId: string): Promise<ApiJobEventsResponse>;
  retryJob(jobId: string, input: RetryJobRequest): Promise<ApiJobActionResponse>;
  cancelJob(jobId: string, input?: CancelJobRequest): Promise<ApiJobActionResponse>;
  cleanupJob(jobId: string): Promise<ApiJobCleanupResponse>;
  submitBrief(input: SubmitBriefRequest): Promise<ApiBriefSubmitResponse>;
}

export class PandoApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createPandoApiClient(opts: PandoApiClientOptions): PandoApiClient {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(opts.baseUrl);

  return {
    async health() {
      return await request<ApiHealth>(fetcher, baseUrl, "/health");
    },
    async listJobs(input) {
      const query =
        input?.status === undefined ? "" : `?status=${encodeURIComponent(input.status)}`;
      return await request<ApiJobList>(fetcher, baseUrl, `/jobs${query}`);
    },
    async getJob(jobId) {
      return await request<ApiJobDetailResponse>(
        fetcher,
        baseUrl,
        `/jobs/${encodePathPart(jobId)}`,
      );
    },
    async listEvents(jobId) {
      return await request<ApiJobEventsResponse>(
        fetcher,
        baseUrl,
        `/jobs/${encodePathPart(jobId)}/events`,
      );
    },
    async retryJob(jobId, input) {
      return await request<ApiJobActionResponse>(
        fetcher,
        baseUrl,
        `/jobs/${encodePathPart(jobId)}/retry`,
        {
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
    },
    async cancelJob(jobId, input = {}) {
      return await request<ApiJobActionResponse>(
        fetcher,
        baseUrl,
        `/jobs/${encodePathPart(jobId)}/cancel`,
        {
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
    },
    async cleanupJob(jobId) {
      return await request<ApiJobCleanupResponse>(
        fetcher,
        baseUrl,
        `/jobs/${encodePathPart(jobId)}/cleanup`,
        { method: "POST" },
      );
    },
    async submitBrief(input) {
      return await request<ApiBriefSubmitResponse>(fetcher, baseUrl, "/briefs", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    },
  };
}

async function request<T>(
  fetcher: PandoApiFetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetcher(`${baseUrl}${path}`, init);
  const body = (await response.json()) as ApiResponse<T>;
  if (body.ok) return body.data;

  throw clientError(response.status, body);
}

function clientError(status: number, body: ApiError): PandoApiClientError {
  return new PandoApiClientError(status, body.error.code, body.error.message);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}
