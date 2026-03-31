export type PlatformKey = "xhs" | "dianping" | "doubao" | "xianyu" | "unknown";
export type TaskStatus = "queued" | "running" | "done" | "failed";

const BACKEND_PORT = "1027";
let resolvedApiBase: string | null = null;

export interface RuntimeInfo {
  backend: string;
  supports: Partial<Record<PlatformKey, boolean>>;
  startedAt?: number;
  started_at?: number;
  pid?: number;
}

export interface ConfigModel {
  workPath: string;
  folderName: string;
  timeout: number;
  maxRetry: number;
  concurrency: number;
  downloadImages: boolean;
  downloadVideos: boolean;
  folderMode: boolean;
  proxy: string;
  userAgent: string;
  xhsCookie: string;
  doubaoCookie: string;
}

export interface TaskSummary {
  totalFiles: number;
  imageCount: number;
  videoCount: number;
  metaCount: number;
  latestLog: string;
}

export interface ResultItem {
  fileId: string;
  name: string;
  type: "image" | "video" | "meta";
  platform: string;
  size: number;
  mtime: number;
  isPreviewable: boolean;
  mediaUrl: string;
  downloadUrl: string;
  previewUrl: string;
}

export interface TaskItem {
  id: string;
  task_id?: string;
  platform: string;
  status: TaskStatus;
  createdAt?: number;
  created_at?: number;
  startedAt?: number | null;
  started_at?: number | null;
  finishedAt?: number | null;
  finished_at?: number | null;
  returnCode?: number | null;
  return_code?: number | null;
  logs: string[];
  downloadDir?: string | null;
  download_dir?: string | null;
  summary?: TaskSummary;
  results: ResultItem[];
}

export interface GeneratePreviewResponse {
  platform?: string;
  text?: string;
  items?: ResultItem[];
}

export const DEFAULT_CONFIG: ConfigModel = {
  workPath: "",
  folderName: "下载助手",
  timeout: 25,
  maxRetry: 2,
  concurrency: 3,
  downloadImages: true,
  downloadVideos: false,
  folderMode: true,
  proxy: "",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  xhsCookie: "",
  doubaoCookie: "",
};

export const PLATFORM_META: Record<
  PlatformKey,
  { label: string; tone: "primary" | "accent" | "muted" | "success" | "warning" | "danger" | "info" }
> = {
  xhs: { label: "小红书", tone: "danger" },
  dianping: { label: "大众点评", tone: "warning" },
  doubao: { label: "豆包", tone: "info" },
  xianyu: { label: "闲鱼", tone: "accent" },
  unknown: { label: "未识别", tone: "muted" },
};

function trimTrailingSlash(value: string) {
  return String(value || "").replace(/\/+$/g, "");
}

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(String(value || ""));
}

function buildBackendOrigin() {
  if (typeof window === "undefined") return "";
  const { protocol, hostname } = window.location;
  if (!hostname) return "";
  return `${protocol}//${hostname}:${BACKEND_PORT}`;
}

function joinUrl(base: string, path: string) {
  if (!path) return base;
  if (isAbsoluteUrl(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${trimTrailingSlash(base)}${normalizedPath}` : normalizedPath;
}

function buildCandidateBases() {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined) => {
    const normalized = value === null || value === undefined ? null : trimTrailingSlash(value);
    const key = normalized ?? "__null__";
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized ?? "");
  };

  add(resolvedApiBase);
  add(import.meta.env.VITE_API_BASE_URL);
  add("");
  add(buildBackendOrigin());

  return candidates;
}

function rememberResolvedBase(requestUrl: string, explicitBase: string) {
  if (explicitBase) {
    resolvedApiBase = trimTrailingSlash(explicitBase);
    return;
  }

  if (typeof window === "undefined") {
    resolvedApiBase = "";
    return;
  }

  try {
    const parsed = new URL(requestUrl, window.location.origin);
    resolvedApiBase = parsed.origin === window.location.origin ? "" : parsed.origin;
  } catch {
    resolvedApiBase = "";
  }
}

function buildHeaders(headers?: HeadersInit) {
  const next = new Headers(headers || {});
  if (!next.has("Content-Type")) {
    next.set("Content-Type", "application/json");
  }
  return next;
}

function looksLikeHtml(text: string, contentType: string) {
  const body = String(text || "").trimStart();
  const lowerType = String(contentType || "").toLowerCase();
  return (
    lowerType.includes("text/html") ||
    body.startsWith("<!doctype html") ||
    body.startsWith("<html") ||
    body.startsWith("<head") ||
    body.startsWith("<body")
  );
}

function buildApiError(path: string, requestUrl: string, text: string, contentType: string) {
  if (looksLikeHtml(text, contentType)) {
    if (!requestUrl.includes(`:${BACKEND_PORT}`)) {
      return `当前站点的 ${path} 返回了 HTML，前端没有连到 Node 接口，已尝试回退到 ${BACKEND_PORT} 端口。`;
    }
    return `后端 ${requestUrl} 返回了 HTML，请检查 ${BACKEND_PORT} 端口是否实际指向 Downloader 的 Node 服务。`;
  }
  return `接口 ${requestUrl} 返回了非 JSON 内容。`;
}

function resolveAssetUrl(path: string) {
  if (!path) return "";
  if (isAbsoluteUrl(path)) return path;
  if (resolvedApiBase !== null) {
    return joinUrl(resolvedApiBase, path);
  }
  const envBase = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || "");
  if (envBase) return joinUrl(envBase, path);
  return path;
}

function hydrateResult(item: ResultItem): ResultItem {
  return {
    ...item,
    mediaUrl: resolveAssetUrl(item.mediaUrl),
    downloadUrl: resolveAssetUrl(item.downloadUrl),
    previewUrl: resolveAssetUrl(item.previewUrl),
  };
}

function hydrateTask(task: TaskItem): TaskItem {
  return {
    ...task,
    results: Array.isArray(task.results) ? task.results.map(hydrateResult) : [],
  };
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const errors: string[] = [];

  for (const base of buildCandidateBases()) {
    const requestUrl = joinUrl(base, path);
    try {
      const response = await fetch(requestUrl, {
        ...init,
        headers: buildHeaders(init?.headers),
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") || "";

      if (looksLikeHtml(text, contentType)) {
        throw new Error(buildApiError(path, requestUrl, text, contentType));
      }

      let data: unknown = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(buildApiError(path, requestUrl, text, contentType));
        }
      }

      const payload = data as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Request failed: ${response.status}`);
      }

      rememberResolvedBase(requestUrl, base);
      return data as T;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[errors.length - 1] || "请求失败");
}

export async function loadRuntime(): Promise<RuntimeInfo> {
  const payload = await fetchJson<{ runtime: RuntimeInfo }>("/api/runtime");
  return payload.runtime;
}

export async function loadConfig(): Promise<ConfigModel> {
  const payload = await fetchJson<{ config: Partial<ConfigModel> & Record<string, unknown> }>("/api/config");
  return normalizeConfig(payload.config);
}

export async function saveConfig(config: ConfigModel): Promise<ConfigModel> {
  const payload = await fetchJson<{ config: Partial<ConfigModel> & Record<string, unknown> }>("/api/config", {
    method: "POST",
    body: JSON.stringify({ config }),
  });
  return normalizeConfig(payload.config);
}

export async function loadTasks(): Promise<TaskItem[]> {
  const payload = await fetchJson<{ tasks: TaskItem[] }>("/api/tasks");
  return Array.isArray(payload.tasks) ? payload.tasks.map(hydrateTask) : [];
}

export async function loadFiles(): Promise<ResultItem[]> {
  const payload = await fetchJson<{ entries: ResultItem[] }>("/api/files?limit=120");
  return Array.isArray(payload.entries) ? payload.entries.map(hydrateResult) : [];
}

export async function runTask(payload: Record<string, unknown>) {
  return fetchJson<{ taskId?: string; task_id?: string; platform?: string }>("/api/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generatePreview(payload: Record<string, unknown>): Promise<GeneratePreviewResponse> {
  const response = await fetchJson<GeneratePreviewResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    ...response,
    items: Array.isArray(response.items) ? response.items.map(hydrateResult) : [],
  };
}

export async function openDirectory(payload: Record<string, unknown>) {
  return fetchJson("/api/open-dir", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function normalizeConfig(raw: Partial<ConfigModel> & Record<string, unknown>): ConfigModel {
  return {
    workPath: String(raw.workPath ?? raw.work_path ?? DEFAULT_CONFIG.workPath),
    folderName: String(raw.folderName ?? raw.folder_name ?? DEFAULT_CONFIG.folderName),
    timeout: Number(raw.timeout ?? DEFAULT_CONFIG.timeout) || DEFAULT_CONFIG.timeout,
    maxRetry: Number(raw.maxRetry ?? raw.max_retry ?? DEFAULT_CONFIG.maxRetry) || DEFAULT_CONFIG.maxRetry,
    concurrency: Number(raw.concurrency ?? DEFAULT_CONFIG.concurrency) || DEFAULT_CONFIG.concurrency,
    downloadImages: Boolean(raw.downloadImages ?? raw.image_download ?? DEFAULT_CONFIG.downloadImages),
    downloadVideos: Boolean(raw.downloadVideos ?? raw.video_download ?? DEFAULT_CONFIG.downloadVideos),
    folderMode: Boolean(raw.folderMode ?? raw.folder_mode ?? DEFAULT_CONFIG.folderMode),
    proxy: String(raw.proxy ?? DEFAULT_CONFIG.proxy),
    userAgent: String(raw.userAgent ?? raw.user_agent ?? DEFAULT_CONFIG.userAgent),
    xhsCookie: String(raw.xhsCookie ?? raw.cookie ?? DEFAULT_CONFIG.xhsCookie),
    doubaoCookie: String(raw.doubaoCookie ?? DEFAULT_CONFIG.doubaoCookie),
  };
}

export function normalizePlatform(platform: string): PlatformKey {
  if (platform === "cli" || platform === "xhs") return "xhs";
  if (platform === "dianping") return "dianping";
  if (platform === "doubao") return "doubao";
  if (platform === "xianyu") return "xianyu";
  return "unknown";
}

export function detectPlatforms(text: string): PlatformKey[] {
  const source = text.toLowerCase();
  const hits = new Set<PlatformKey>();
  if (/(xiaohongshu\.com|xhslink\.com)/.test(source)) hits.add("xhs");
  if (/(dianping\.com|dpurl\.cn)/.test(source)) hits.add("dianping");
  if (/doubao\.com/.test(source)) hits.add("doubao");
  if (/(goofish\.com|m\.tb\.cn|tb\.cn)/.test(source)) hits.add("xianyu");
  return hits.size ? [...hits] : ["unknown"];
}

export function getTaskTime(task: TaskItem): number {
  return task.createdAt ?? task.created_at ?? 0;
}

export function getTaskEndTime(task: TaskItem): number | null {
  return task.finishedAt ?? task.finished_at ?? null;
}

export function formatDateTime(value?: number | null): string {
  if (!value) return "未开始";
  return new Date(value * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let current = size;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function getStatusLabel(status: TaskStatus): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "下载中";
  if (status === "done") return "已完成";
  return "失败";
}

export function getStatusTone(status: TaskStatus): "warning" | "accent" | "success" | "danger" {
  if (status === "queued") return "warning";
  if (status === "running") return "accent";
  if (status === "done") return "success";
  return "danger";
}
