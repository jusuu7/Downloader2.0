"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const DATA_DIR = path.join(ROOT_DIR, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "config.json");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const XHS_RUNNER = "__XHS_NOTE__";
const DEFAULT_SETTINGS = Object.freeze({
  workPath: DOWNLOADS_DIR,
  folderName: "下载助手",
  timeout: 25,
  maxRetry: 2,
  concurrency: 3,
  downloadImages: true,
  downloadVideos: false,
  folderMode: true,
  proxy: "",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  xhsCookie: "",
  doubaoCookie: "",
});

const DEFAULT_MAX_LOG_LINES = 800;
const PROCESS_STARTED_AT = Date.now() / 1000;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".m3u8"]);
const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const QWIK_TOKEN_PATTERN = /^[0-9a-z]+$/i;
const TRAILING_URL_CHARS = ".,;!?)]}>'\"";

const XHS_HOST_SUFFIXES = ["xiaohongshu.com", "xhslink.com"];
const XHS_PROFILE_PATH_PREFIX = "/user/profile/";
const XHS_PROFILE_MAX_PAGES = 60;
const DP_SHORT_HOSTS = new Set(["dpurl.cn", "www.dpurl.cn"]);
const TB_SHORT_HOSTS = new Set(["m.tb.cn", "tb.cn", "www.tb.cn"]);
const DIANPING_HOST_SUFFIX = "dianping.com";
const DIANPING_FEED_PATH = "/feeddetail/";
const DIANPING_RUNNER = "__DIANPING_FEED__";

const DOUBAO_HOST_SUFFIX = "doubao.com";
const DOUBAO_THREAD_PATH_PREFIX = "/thread/";
const DOUBAO_RUNNER = "__DOUBAO_THREAD__";
const DOUBAO_HOME_URL = "https://www.doubao.com/";

const XIANYU_HOST_SUFFIX = "goofish.com";
const XIANYU_ITEM_PATH_PREFIX = "/item";
const XIANYU_RUNNER = "__XIANYU_ITEM__";
const XIANYU_HOME_URL = "https://h5.m.goofish.com/";
const XIANYU_MTOP_BASE = "https://h5api.m.goofish.com/h5";
const XIANYU_MTOP_API = "mtop.taobao.idle.awesome.detail";
const XIANYU_MTOP_VERSION = "1.0";
const XIANYU_MTOP_APP_KEY = "12574478";
const XIANYU_VIDEO_SKIP_KEY_PATTERN = /(cover|poster|thumb|snapshot|image|img|pic)/i;

const DIANPING_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DOUBAO_URL_SCAN_PATTERN = /https?:\/\/[^\s\"'<>\\]+/gi;
const DOUBAO_IMAGE_EXT_PATTERN = /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i;
const DOUBAO_THREAD_CONCURRENCY = 3;
const CLI_URL_CONCURRENCY = 3;
const CLI_TEMP_NAMESPACE_ENV = "HEOS_TEMP_NS";
const CLI_SUMMARY_PATTERN = /共处理\s*(\d+)\s*个作品，成功\s*(\d+)\s*个，失败\s*(\d+)\s*个，跳过\s*(\d+)\s*个/;

const SOURCE_FOLDER_NAMES = {
  cli: "小红书",
  dianping: "大众点评",
  doubao: "豆包",
  xianyu: "闲鱼",
};
const LEGACY_SOURCE_SUFFIXES = {
  cli: ["Heos", "XHS"],
  dianping: ["Dianping"],
  doubao: ["Doubao"],
  xianyu: [],
};
const SOURCE_FOLDER_MODES = ["cli", "dianping", "doubao", "xianyu"];

const MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
};

function nowTs() {
  return Date.now() / 1000;
}

function stripBom(text) {
  if (typeof text !== "string") return "";
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJsonFileSync(filePath) {
  try {
    const raw = stripBom(fs.readFileSync(filePath, "utf8"));
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeJsonFileSync(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4), "utf8");
}

function normalizeSettings(raw = {}) {
  const next = {
    ...DEFAULT_SETTINGS,
    ...raw,
  };
  if (raw.work_path && !raw.workPath) next.workPath = String(raw.work_path);
  if (raw.folder_name && !raw.folderName) next.folderName = String(raw.folder_name);
  if (raw.max_retry !== undefined && raw.maxRetry === undefined) next.maxRetry = Number(raw.max_retry) || DEFAULT_SETTINGS.maxRetry;
  if (raw.user_agent && !raw.userAgent) next.userAgent = String(raw.user_agent);
  if (raw.downloadImages === undefined && raw.image_download !== undefined) next.downloadImages = !!raw.image_download;
  if (raw.downloadVideos === undefined && raw.video_download !== undefined) next.downloadVideos = !!raw.video_download;
  if (raw.folderMode === undefined && raw.folder_mode !== undefined) next.folderMode = !!raw.folder_mode;
  if (raw.xhsCookie === undefined && raw.cookie !== undefined) next.xhsCookie = String(raw.cookie || "");

  next.workPath = String(next.workPath || DEFAULT_SETTINGS.workPath);
  next.folderName = String(next.folderName || DEFAULT_SETTINGS.folderName);
  next.timeout = Math.max(5, Number(next.timeout) || DEFAULT_SETTINGS.timeout);
  next.maxRetry = Math.max(0, Number(next.maxRetry) || DEFAULT_SETTINGS.maxRetry);
  next.concurrency = Math.max(1, Math.min(8, Number(next.concurrency) || DEFAULT_SETTINGS.concurrency));
  next.downloadImages = parseBool(next.downloadImages) ?? DEFAULT_SETTINGS.downloadImages;
  next.downloadVideos = parseBool(next.downloadVideos) ?? DEFAULT_SETTINGS.downloadVideos;
  next.folderMode = parseBool(next.folderMode) ?? DEFAULT_SETTINGS.folderMode;
  next.proxy = String(next.proxy || "");
  next.userAgent = String(next.userAgent || DEFAULT_SETTINGS.userAgent);
  next.xhsCookie = String(next.xhsCookie || "");
  next.doubaoCookie = String(next.doubaoCookie || "");

  // Backward-compatible aliases for the migrated Heos logic.
  next.work_path = next.workPath;
  next.folder_name = next.folderName;
  next.max_retry = next.maxRetry;
  next.user_agent = next.userAgent;
  next.folder_mode = next.folderMode;
  next.image_download = next.downloadImages;
  next.video_download = next.downloadVideos;
  next.cookie = next.xhsCookie;
  return next;
}

function getSettings() {
  const current = normalizeSettings(readJsonFileSync(SETTINGS_PATH));
  if (!fs.existsSync(SETTINGS_PATH)) {
    writeJsonFileSync(SETTINGS_PATH, current);
  }
  return current;
}

function updateSettings(partial = {}) {
  const merged = normalizeSettings({ ...getSettings(), ...partial });
  writeJsonFileSync(SETTINGS_PATH, merged);
  return merged;
}

function parseBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
  }
  return null;
}

function parseCommandText(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

function getPythonLaunchCommand() {
  const fromEnv = parseCommandText(process.env.HEOS_PYTHON_LAUNCH);
  if (fromEnv.length > 0) return fromEnv;
  return ["py", "-3.12"];
}

function normalizeUrls(raw) {
  if (!raw) return "";
  return String(raw)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
}

function cleanUrlToken(url) {
  let token = String(url || "").trim().replace(/^[<>\[\]\(\)\{\}\"']+|[<>\[\]\(\)\{\}\"']+$/g, "");
  while (token && TRAILING_URL_CHARS.includes(token[token.length - 1])) {
    token = token.slice(0, -1);
  }
  return token;
}

function extractUrls(raw) {
  const text = String(raw || "");
  const found = text.match(URL_PATTERN) || [];
  const urls = [];
  const seen = new Set();
  for (const item of found) {
    const cleaned = cleanUrlToken(item);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
  }
  return urls;
}

function getUrlHost(urlText) {
  try {
    return new URL(urlText).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isXhsUrl(urlText) {
  const host = getUrlHost(urlText);
  return XHS_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isXhsProfileUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    if (!isXhsUrl(urlText)) return false;
    return (parsed.pathname || "").startsWith(XHS_PROFILE_PATH_PREFIX);
  } catch {
    return false;
  }
}

function getXhsProfileUserId(urlText) {
  try {
    const parsed = new URL(urlText);
    const match = (parsed.pathname || "").match(/^\/user\/profile\/([^/?#]+)/i);
    return match ? String(match[1] || "").trim() : "";
  } catch {
    return "";
  }
}

function isDianpingFeedUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!(host === DIANPING_HOST_SUFFIX || host.endsWith(`.${DIANPING_HOST_SUFFIX}`))) return false;
    return (parsed.pathname || "").includes(DIANPING_FEED_PATH);
  } catch {
    return false;
  }
}

function isDoubaoThreadUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!(host === DOUBAO_HOST_SUFFIX || host.endsWith(`.${DOUBAO_HOST_SUFFIX}`))) return false;
    return (parsed.pathname || "").startsWith(DOUBAO_THREAD_PATH_PREFIX);
  } catch {
    return false;
  }
}

function isTbShortUrl(urlText) {
  return TB_SHORT_HOSTS.has(getUrlHost(urlText));
}

function isTbScanErrorUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!TB_SHORT_HOSTS.has(host)) return false;
    return (parsed.pathname || "").toLowerCase().includes("scanerror");
  } catch {
    return false;
  }
}

function isXianyuItemUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (!(host === XIANYU_HOST_SUFFIX || host.endsWith(`.${XIANYU_HOST_SUFFIX}`))) return false;
    return (parsed.pathname || "").startsWith(XIANYU_ITEM_PATH_PREFIX);
  } catch {
    return false;
  }
}

function getXianyuItemIdFromUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    const itemId = normalizeText(parsed.searchParams.get("itemId")) || normalizeText(parsed.searchParams.get("id"));
    if (itemId) return itemId;
    const pathMatch = (parsed.pathname || "").match(/\/item\/(\d+)/i);
    return pathMatch ? String(pathMatch[1] || "").trim() : "";
  } catch {
    return "";
  }
}

function detectCharset(contentTypeHeader) {
  const text = String(contentTypeHeader || "");
  const match = /charset=([^;]+)/i.exec(text);
  return match ? match[1].trim() : "utf-8";
}

function decodeBytes(buffer, preferredCharset = "utf-8") {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const candidates = [preferredCharset, "utf-8", "gb18030"];
  for (const encoding of candidates) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchTextUrl(urlText, options = {}) {
  const timeout = options.timeout ?? 25000;
  const headers = {
    "User-Agent": DIANPING_UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  if (options.referer) headers.Referer = options.referer;
  if (options.extraHeaders && typeof options.extraHeaders === "object") {
    for (const [k, v] of Object.entries(options.extraHeaders)) {
      if (v) headers[String(k)] = String(v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(urlText, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const charset = detectCharset(response.headers.get("content-type"));
    const text = decodeBytes(arrayBuffer, charset);
    return { text, finalUrl: response.url || urlText };
  } finally {
    clearTimeout(timer);
  }
}

function extractTbShortTargetUrls(htmlText) {
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = normalizeEmbeddedUrl(value);
    if (!normalized || !normalized.startsWith("http")) return;
    candidates.push(normalized);
  };

  for (const match of htmlText.matchAll(/\burl\s*=\s*(['"])(https?:\/\/[^'"]+)\1/gi)) {
    pushCandidate(match[2]);
  }
  for (const match of htmlText.matchAll(/["']url["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi)) {
    pushCandidate(match[1]);
  }
  for (const value of extractUrls(htmlText)) {
    pushCandidate(value);
  }
  return uniqueItems(candidates);
}

async function resolveDpShortUrl(urlText) {
  let finalUrl = urlText;
  try {
    const result = await fetchTextUrl(urlText, { timeout: 20000 });
    finalUrl = result.finalUrl || urlText;
  } catch (err) {
    throw new Error(`短链解析失败: ${err.message || err}`);
  }
  if (DP_SHORT_HOSTS.has(getUrlHost(finalUrl))) {
    throw new Error("短链解析失败，未获取到目标链接。");
  }
  return finalUrl;
}

async function resolveTbShortUrl(urlText) {
  let finalUrl = urlText;
  let htmlText = "";
  try {
    const result = await fetchTextUrl(urlText, { timeout: 20000, referer: XIANYU_HOME_URL });
    finalUrl = result.finalUrl || urlText;
    htmlText = String(result.text || "");
  } catch (err) {
    throw new Error(`闲鱼短链解析失败: ${err.message || err}`);
  }

  const candidates = extractTbShortTargetUrls(htmlText).filter((item) => !isTbScanErrorUrl(item));
  const xianyuTarget = candidates.find((item) => isXianyuItemUrl(item));
  if (xianyuTarget) return xianyuTarget;
  if (isXianyuItemUrl(finalUrl)) return finalUrl;
  if (isTbScanErrorUrl(finalUrl)) throw new Error("闲鱼短链解析失败，链接已失效。");
  if (isTbShortUrl(finalUrl)) throw new Error("闲鱼短链解析失败，未获取到目标商品链接。");
  return finalUrl;
}

async function resolveShortUrl(urlText) {
  const host = getUrlHost(urlText);
  if (DP_SHORT_HOSTS.has(host)) return resolveDpShortUrl(urlText);
  if (TB_SHORT_HOSTS.has(host)) return resolveTbShortUrl(urlText);
  return urlText;
}

async function resolvePayloadUrl(rawInput) {
  const extracted = extractUrls(rawInput);
  if (!extracted.length) {
    return { mode: "cli", normalizedUrl: normalizeUrls(rawInput) };
  }

  const resolved = [];
  for (const item of extracted) {
    resolved.push(await resolveShortUrl(item));
  }

  const xhsUrls = uniqueItems(resolved.filter((x) => isXhsUrl(x)));
  if (xhsUrls.length) return { mode: "cli", normalizedUrl: xhsUrls.join(" ") };

  const dianpingUrls = uniqueItems(resolved.filter((x) => isDianpingFeedUrl(x)));
  if (dianpingUrls.length) return { mode: "dianping", normalizedUrl: dianpingUrls[0] };

  const doubaoUrls = uniqueItems(resolved.filter((x) => isDoubaoThreadUrl(x)));
  if (doubaoUrls.length) return { mode: "doubao", normalizedUrl: doubaoUrls.join(" ") };

  const xianyuUrls = uniqueItems(resolved.filter((x) => isXianyuItemUrl(x)));
  if (xianyuUrls.length) return { mode: "xianyu", normalizedUrl: xianyuUrls.join(" ") };

  return { mode: "cli", normalizedUrl: resolved.join(" ") };
}

function maskCookie(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 12) return "*".repeat(text.length);
  return `${text.slice(0, 6)}...${text.slice(-6)}`;
}

function stripSourceFolderSuffix(folderName) {
  const value = String(folderName || "").trim() || "Download";
  const suffixes = [
    ...Object.values(LEGACY_SOURCE_SUFFIXES).flatMap((items) => items),
    ...Object.values(SOURCE_FOLDER_NAMES),
  ];
  for (const suffix of suffixes) {
    const marker = `_${suffix}`;
    if (value.toLowerCase().endsWith(marker.toLowerCase())) {
      const trimmed = value.slice(0, -marker.length).trim();
      return trimmed || "Download";
    }
  }
  return value;
}

function getModeFolderName(baseFolderName, sourceMode) {
  const mode = normalizeSourceMode(sourceMode) || "cli";
  return SOURCE_FOLDER_NAMES[mode] || stripSourceFolderSuffix(baseFolderName);
}

function getSourceDownloadDirs(workPath, baseFolderName) {
  const safeWorkPath = String(workPath || ROOT_DIR);
  const safeBaseFolder = stripSourceFolderSuffix(baseFolderName);
  const baseRoot = path.join(safeWorkPath, safeBaseFolder);
  const result = {};
  for (const mode of SOURCE_FOLDER_MODES) {
    result[mode] = path.join(baseRoot, getModeFolderName(safeBaseFolder, mode));
  }
  return result;
}

function getLegacySourceDownloadDirs(workPath, baseFolderName) {
  const safeWorkPath = path.resolve(String(workPath || ROOT_DIR));
  const baseFolder = stripSourceFolderSuffix(baseFolderName);
  const baseCandidates = new Set([baseFolder, "Download"]);
  const rootCandidates = new Set([safeWorkPath, path.resolve(ROOT_DIR)]);
  const result = {};
  for (const mode of SOURCE_FOLDER_MODES) {
    const suffixes = LEGACY_SOURCE_SUFFIXES[mode] || [];
    const set = new Set();
    for (const rootDir of rootCandidates) {
      for (const baseName of baseCandidates) {
        for (const suffix of suffixes) {
          set.add(path.join(rootDir, `${baseName}_${suffix}`));
        }
      }
    }
    result[mode] = [...set];
  }
  return result;
}

function normalizeSourceMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return SOURCE_FOLDER_MODES.includes(mode) ? mode : null;
}

function getSourceDownloadDirByMode(sourceMode) {
  const mode = normalizeSourceMode(sourceMode) || "cli";
  const settings = getSettings();
  const workPath = String(settings.work_path || ROOT_DIR);
  const folderName = String(settings.folder_name || "Download");
  const dirs = getSourceDownloadDirs(workPath, folderName);
  return dirs[mode] || dirs.cli;
}

function getDefaultDownloadDir() {
  const settings = getSettings();
  const workPath = String(settings.work_path || DOWNLOADS_DIR);
  const folderName = String(settings.folder_name || DEFAULT_SETTINGS.folderName);
  const dirs = getSourceDownloadDirs(workPath, folderName);
  return dirs.cli;
}

function getDownloadTargetFromPayload(payload, sourceMode = "cli") {
  const settings = getSettings();
  const defaultWorkPath = String(settings.work_path || DOWNLOADS_DIR);
  const defaultFolderName = String(settings.folder_name || DEFAULT_SETTINGS.folderName);
  const workPath = String(payload.workPath || payload.work_path || "").trim() || defaultWorkPath;
  const configuredFolderName = String(payload.folderName || payload.folder_name || "").trim() || defaultFolderName;
  const mode = normalizeSourceMode(sourceMode) || "cli";
  const dirs = getSourceDownloadDirs(workPath, configuredFolderName);
  const targetDir = dirs[mode] || dirs.cli;
  return {
    workPath: path.dirname(targetDir),
    folderName: path.basename(targetDir),
  };
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureUniqueMigrationPath(targetPath) {
  const basePath = path.resolve(targetPath);
  if (!(await pathExists(basePath))) return basePath;
  const parsed = path.parse(basePath);
  for (let i = 1; i <= 9999; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (migrated-${i})${parsed.ext}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate unique migration path for: ${basePath}`);
}

async function moveFileForMigration(sourcePath, targetPath) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (err) {
    if (err && err.code === "EXDEV") {
      await fsp.copyFile(sourcePath, targetPath);
      await fsp.unlink(sourcePath);
      return;
    }
    throw err;
  }
}

async function removeEmptyDirectoryTree(rootDir) {
  let entries;
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of entries) {
    if (!item.isDirectory()) continue;
    await removeEmptyDirectoryTree(path.join(rootDir, item.name));
  }
  try {
    const remains = await fsp.readdir(rootDir);
    if (!remains.length) await fsp.rmdir(rootDir);
  } catch {
    // ignore cleanup errors
  }
}

async function migrateLegacyDirectoryContents(sourceRoot, targetRoot, relativePath, report) {
  const currentSource = relativePath ? path.join(sourceRoot, relativePath) : sourceRoot;
  let entries = [];
  try {
    entries = await fsp.readdir(currentSource, { withFileTypes: true });
  } catch (err) {
    report.failed += 1;
    report.errors.push(`${currentSource}: ${err.message || err}`);
    return;
  }
  for (const item of entries) {
    const childRel = relativePath ? path.join(relativePath, item.name) : item.name;
    const sourcePath = path.join(sourceRoot, childRel);
    if (item.isDirectory()) {
      await migrateLegacyDirectoryContents(sourceRoot, targetRoot, childRel, report);
      continue;
    }
    if (!item.isFile()) continue;
    const desiredTarget = path.join(targetRoot, childRel);
    try {
      const finalTarget = await ensureUniqueMigrationPath(desiredTarget);
      await moveFileForMigration(sourcePath, finalTarget);
      report.moved += 1;
      if (path.resolve(finalTarget) !== path.resolve(desiredTarget)) {
        report.renamed += 1;
      }
    } catch (err) {
      report.failed += 1;
      report.errors.push(`${sourcePath}: ${err.message || err}`);
    }
  }
}

async function migrateLegacyDownloadDirsOnStartup() {
  const settings = getSettings();
  const workPath = String(settings.work_path || DOWNLOADS_DIR);
  const baseFolderName = String(settings.folder_name || DEFAULT_SETTINGS.folderName);
  const targetDirs = getSourceDownloadDirs(workPath, baseFolderName);
  const legacyDirs = getLegacySourceDownloadDirs(workPath, baseFolderName);
  const total = { dirs: 0, moved: 0, renamed: 0, failed: 0 };

  for (const mode of SOURCE_FOLDER_MODES) {
    const targetDir = path.resolve(targetDirs[mode]);
    await fsp.mkdir(targetDir, { recursive: true });
    const candidates = Array.isArray(legacyDirs[mode]) ? legacyDirs[mode] : [];
    for (const rawSourceDir of candidates) {
      const sourceDir = path.resolve(rawSourceDir);
      if (sourceDir === targetDir) continue;
      if (!(await pathExists(sourceDir))) continue;
      let stat;
      try {
        stat = await fsp.stat(sourceDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      total.dirs += 1;
      const report = { moved: 0, renamed: 0, failed: 0, errors: [] };
      await migrateLegacyDirectoryContents(sourceDir, targetDir, "", report);
      await removeEmptyDirectoryTree(sourceDir);
      total.moved += report.moved;
      total.renamed += report.renamed;
      total.failed += report.failed;
      if (report.moved || report.renamed || report.failed) {
        console.log(
          `[migration] ${mode}: ${sourceDir} -> ${targetDir}, moved=${report.moved}, renamed=${report.renamed}, failed=${report.failed}`,
        );
      }
      for (const detail of report.errors.slice(0, 5)) {
        console.warn(`[migration] error: ${detail}`);
      }
      if (report.errors.length > 5) {
        console.warn(`[migration] ... ${report.errors.length - 5} more error(s)`);
      }
    }
  }

  if (total.dirs === 0) {
    console.log("[migration] no legacy download folders found.");
    return;
  }
  console.log(
    `[migration] done: dirs=${total.dirs}, moved=${total.moved}, renamed=${total.renamed}, failed=${total.failed}`,
  );
}

function syncRuntimeSettingsFile() {
  updateSettings({});
}

function ensurePython312() {
  const launch = getPythonLaunchCommand();
  const probe = spawnSync(launch[0], [...launch.slice(1), "-V"], {
    encoding: "utf8",
    timeout: 10000,
  });
  const versionOutput = `${probe.stdout || ""} ${probe.stderr || ""}`.trim();
  if (probe.status !== 0 || !/Python\s+3\.12(\.\d+)?/i.test(versionOutput)) {
    throw new Error("Python 3.12 is required for the compat runner.");
  }
}

function buildCliCommand(payload, urlOverride = null, sourceMode = "cli") {
  const settings = getSettings();
  const cmd = [XHS_RUNNER];
  const urlValue = normalizeUrls(urlOverride !== null ? urlOverride : String(payload.url || ""));
  if (!urlValue) throw new Error("The url field is required.");
  cmd.push("--url", urlValue);

  const { workPath, folderName } = getDownloadTargetFromPayload(payload, sourceMode);
  fs.mkdirSync(path.join(workPath, folderName), { recursive: true });
  cmd.push("--work_path", workPath, "--folder_name", folderName);

  const strMap = {
    name_format: "--name_format",
    user_agent: "--user_agent",
    cookie: "--cookie",
    proxy: "--proxy",
  };
  const derivedPayload = {
    ...payload,
    user_agent: payload.userAgent || payload.user_agent || settings.userAgent,
    proxy: payload.proxy ?? settings.proxy,
    cookie: payload.xhsCookie || payload.cookie || settings.xhsCookie,
  };
  for (const [key, option] of Object.entries(strMap)) {
    const value = derivedPayload[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;
    cmd.push(option, text);
  }

  const intMap = { timeout: "--timeout", maxRetry: "--max_retry", concurrency: "--concurrency" };
  for (const [key, option] of Object.entries(intMap)) {
    const value = derivedPayload[key] ?? derivedPayload[key === "maxRetry" ? "max_retry" : key];
    if (value === null || value === undefined || value === "") continue;
    cmd.push(option, String(parseInt(value, 10)));
  }

  const boolMap = {
    folderMode: "--folder_mode",
    downloadImages: "--download_images",
    downloadVideos: "--download_videos",
  };
  for (const [key, option] of Object.entries(boolMap)) {
    const value = derivedPayload[key] ?? derivedPayload[key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)];
    const parsed = parseBool(value);
    if (parsed === null) continue;
    cmd.push(option, parsed ? "true" : "false");
  }

  return cmd;
}

function buildDianpingCommand(payload, urlValue) {
  const cmd = [DIANPING_RUNNER, "--url", urlValue];
  const { workPath, folderName } = getDownloadTargetFromPayload(payload, "dianping");
  fs.mkdirSync(path.join(workPath, folderName), { recursive: true });
  cmd.push("--work_path", workPath, "--folder_name", folderName);
  const settings = getSettings();
  const concurrency = Number(payload.concurrency || settings.concurrency);
  if (concurrency > 0) cmd.push("--concurrency", String(Math.min(8, Math.max(1, concurrency))));
  return cmd;
}

function buildDoubaoCommand(payload, urlValue) {
  const cmd = [DOUBAO_RUNNER, "--url", urlValue];
  const { workPath, folderName } = getDownloadTargetFromPayload(payload, "doubao");
  fs.mkdirSync(path.join(workPath, folderName), { recursive: true });
  cmd.push("--work_path", workPath, "--folder_name", folderName);
  const settings = getSettings();
  const cookie = String(payload.doubaoCookie || payload.cookie || settings.doubaoCookie || "").trim();
  if (cookie) cmd.push("--cookie", cookie);
  const concurrency = Number(payload.concurrency || settings.concurrency);
  if (concurrency > 0) cmd.push("--concurrency", String(Math.min(8, Math.max(1, concurrency))));
  return cmd;
}

function buildXianyuCommand(payload, urlValue) {
  const cmd = [XIANYU_RUNNER, "--url", urlValue];
  const { workPath, folderName } = getDownloadTargetFromPayload(payload, "xianyu");
  fs.mkdirSync(path.join(workPath, folderName), { recursive: true });
  cmd.push("--work_path", workPath, "--folder_name", folderName);
  const settings = getSettings();
  const concurrency = Number(payload.concurrency || settings.concurrency);
  if (concurrency > 0) cmd.push("--concurrency", String(Math.min(8, Math.max(1, concurrency))));
  return cmd;
}

function parseCommandOption(command, option) {
  const idx = command.indexOf(option);
  if (idx < 0 || idx + 1 >= command.length) return null;
  return command[idx + 1];
}

function setCommandOption(command, option, value) {
  const next = Array.isArray(command) ? [...command] : [];
  const idx = next.indexOf(option);
  if (idx < 0) {
    next.push(option, value);
    return next;
  }
  if (idx + 1 < next.length) {
    next[idx + 1] = value;
  } else {
    next.push(value);
  }
  return next;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function htmlUnescape(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaContent(htmlText, attrName, attrValue) {
  const targetAttr = attrName.toLowerCase();
  const targetValue = String(attrValue || "").trim();
  const metaTags = htmlText.match(/<meta[^>]+>/gi) || [];
  for (const tag of metaTags) {
    const attrs = {};
    const regex = /([a-zA-Z_:\-]+)\s*=\s*(["'])(.*?)\2/g;
    let match;
    while ((match = regex.exec(tag)) !== null) {
      attrs[match[1].toLowerCase()] = htmlUnescape(match[3]).trim();
    }
    if (attrs[targetAttr] === targetValue) return attrs.content || "";
  }
  return "";
}

function uniqueItems(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function qwikTokenToIndex(token, size) {
  if (typeof token !== "string" || !QWIK_TOKEN_PATTERN.test(token)) return null;
  const index = Number.parseInt(token, 36);
  if (!Number.isFinite(index) || index < 0 || index >= size) return null;
  return index;
}

function decodeQwikValue(value, objects, cache, stack) {
  if (typeof value === "string") {
    const index = qwikTokenToIndex(value, objects.length);
    if (index === null) return value;
    if (cache.has(index)) return cache.get(index);
    if (stack.has(index)) return null;
    stack.add(index);
    const decoded = decodeQwikValue(objects[index], objects, cache, stack);
    stack.delete(index);
    cache.set(index, decoded);
    return decoded;
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeQwikValue(item, objects, cache, stack));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeQwikValue(v, objects, cache, stack);
    return out;
  }
  return value;
}

function extractDianpingQwikData(htmlText) {
  const match = /<script\s+type=["']qwik\/json["']>([\s\S]*?)<\/script>/i.exec(htmlText);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function extractDianpingFeedDataFromQwik(data) {
  const objects = data.objs;
  if (!Array.isArray(objects)) return {};

  const state = objects.find((item) => item && typeof item === "object" && "feedMain" in item);
  if (!state || typeof state !== "object") return {};

  const cache = new Map();
  const feedMain = decodeQwikValue(state.feedMain, objects, cache, new Set());
  if (!feedMain || typeof feedMain !== "object") return {};

  const title = normalizeText(feedMain.title);
  const description = normalizeText(feedMain.content);
  const feedId = normalizeText(feedMain.mainId);
  let author = "";
  if (feedMain.feedUser && typeof feedMain.feedUser === "object") {
    author = normalizeText(feedMain.feedUser.username);
  }

  const imageUrls = [];
  if (Array.isArray(feedMain.feedPicList)) {
    for (const item of feedMain.feedPicList) {
      if (!item || typeof item !== "object") continue;
      const imageUrl = normalizeText(item.url);
      if (imageUrl.startsWith("http")) imageUrls.push(imageUrl);
    }
  }

  return {
    feed_id: feedId,
    title,
    description,
    author,
    image_urls: uniqueItems(imageUrls),
  };
}

function extractDianpingFallbackImages(htmlText) {
  const found = htmlText.match(/https:\/\/qcloud\.dpfile\.com\/pc\/[A-Za-z0-9_\-.]+\.jpg/gi) || [];
  return uniqueItems(found);
}

async function parseDianpingFeed(urlText) {
  const { text: htmlText, finalUrl } = await fetchTextUrl(urlText, {
    timeout: 25000,
    referer: "https://m.dianping.com/",
  });
  const parsed = {
    source_url: finalUrl,
    feed_id: "",
    title: extractMetaContent(htmlText, "property", "og:title"),
    description: extractMetaContent(htmlText, "property", "og:description"),
    author: "",
    image_urls: [],
  };

  const qwik = extractDianpingQwikData(htmlText);
  if (qwik) {
    const ext = extractDianpingFeedDataFromQwik(qwik);
    if (ext.feed_id) parsed.feed_id = ext.feed_id;
    if (ext.title) parsed.title = ext.title;
    if (ext.description) parsed.description = ext.description;
    if (ext.author) parsed.author = ext.author;
    if (Array.isArray(ext.image_urls) && ext.image_urls.length) parsed.image_urls = ext.image_urls;
  }
  if (!parsed.image_urls.length) parsed.image_urls = extractDianpingFallbackImages(htmlText);
  if (!parsed.image_urls.length) throw new Error("未从大众点评页面提取到可下载图片。");

  if (!parsed.feed_id) {
    const match = /\/feeddetail\/(\d+)/.exec(finalUrl);
    if (match) parsed.feed_id = match[1];
  }
  if (!parsed.title) parsed.title = parsed.feed_id || "dianping_note";
  return parsed;
}

function trimFilenamePart(text, maxLength) {
  const value = normalizeText(text);
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).replace(/[ ._]+$/g, "");
}

function sanitizeFilename(text) {
  const cleaned = String(text || "").replace(/[\\/:*?\"<>|]+/g, "_").replace(/^[ ._]+|[ ._]+$/g, "");
  return cleaned || "output";
}

function guessImageExtension(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    const ext = path.extname(parsed.pathname || "").toLowerCase();
    if (IMAGE_EXTS.has(ext)) return ext;
  } catch {
    // ignore
  }
  return ".jpg";
}
async function downloadBinaryFile(urlText, targetPath, referer, extraHeaders = null) {
  const headers = {
    "User-Agent": DIANPING_UA,
    Referer: referer,
  };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v) headers[String(k)] = String(v);
    }
  }
  const response = await fetch(urlText, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, Buffer.from(arrayBuffer));
}

function parseJsonText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 2 || (text[0] !== "{" && text[0] !== "[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeEmbeddedUrl(value) {
  let url = normalizeText(value);
  if (!url) return "";
  url = htmlUnescape(url);
  url = url.replace(/\\\\u0026/g, "&").replace(/\\u0026/g, "&");
  url = url.replace(/\\\//g, "/");
  url = url.replace(/^[\"']+|[\"']+$/g, "");
  while (url && TRAILING_URL_CHARS.includes(url[url.length - 1])) {
    url = url.slice(0, -1);
  }
  return url;
}

function extractDoubaoScriptPayload(htmlText) {
  const scripts = [...htmlText.matchAll(/<script\b([^>]*)>/gi)];
  let bestPayload = null;
  let bestScore = -1;
  for (const item of scripts) {
    const attrs = item[1] || "";
    const match = /data-fn-args="([\s\S]*?)"/i.exec(attrs);
    if (!match) continue;
    const decoded = htmlUnescape(match[1]);
    const parsed = parseJsonText(decoded);
    if (!Array.isArray(parsed) || parsed.length < 3 || typeof parsed[2] !== "object") continue;
    const payload = parsed[2];
    if (!payload || typeof payload !== "object") continue;
    if (!payload.data || typeof payload.data !== "object") continue;
    if (!payload.data.share_info || typeof payload.data.share_info !== "object") continue;
    const score = JSON.stringify(payload).split("byteimg.com").length - 1;
    if (score > bestScore) {
      bestScore = score;
      bestPayload = payload;
    }
  }
  return bestPayload;
}

function isDoubaoImageUrl(urlText) {
  const lower = String(urlText || "").toLowerCase();
  if (!lower.includes("byteimg.com")) return false;
  if (lower.includes("/user-avatar/")) return false;
  return DOUBAO_IMAGE_EXT_PATTERN.test(lower);
}

function doubaoImageGroupKey(urlText) {
  try {
    const parsed = new URL(urlText);
    let value = (parsed.pathname || "").toLowerCase();
    if (value.includes("~")) value = value.split("~", 1)[0];
    return value;
  } catch {
    return "";
  }
}

function doubaoImageRank(urlText) {
  const value = String(urlText || "").toLowerCase();
  let score = 20;
  if (value.includes("image_raw_b")) score = 1;
  else if (value.includes("image_dld_watermark")) score = 2;
  else if (value.includes("image_pre_watermark")) score = 3;
  else if (value.includes("downsize_watermark")) score = 4;
  if (!value.includes("x-signature=")) score += 10;
  return score;
}

function pickPreferredDoubaoUrls(urls) {
  const order = [];
  const best = new Map();
  for (const item of urls) {
    const url = normalizeEmbeddedUrl(item);
    if (!url || !isDoubaoImageUrl(url)) continue;
    const key = doubaoImageGroupKey(url) || url.toLowerCase();
    const rank = doubaoImageRank(url);
    if (!best.has(key)) {
      best.set(key, [rank, url]);
      order.push(key);
      continue;
    }
    const [oldRank] = best.get(key);
    if (rank < oldRank) best.set(key, [rank, url]);
  }
  return order.map((key) => best.get(key)[1]);
}

function extractDoubaoTextFromValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = normalizeText(value.text);
    if (text) return text;
    if (value.text_block && typeof value.text_block === "object") {
      const blockText = normalizeText(value.text_block.text);
      if (blockText) return blockText;
    }
    for (const child of Object.values(value)) {
      const nested = extractDoubaoTextFromValue(child);
      if (nested) return nested;
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const nested = extractDoubaoTextFromValue(child);
      if (nested) return nested;
    }
  }
  return "";
}

function extractDoubaoMessageText(message) {
  const parsed = parseJsonText(message.content);
  let text = extractDoubaoTextFromValue(parsed);
  if (text) return text;
  if (!Array.isArray(message.content_block)) return "";
  for (const block of message.content_block) {
    if (!block || typeof block !== "object") continue;
    for (const field of ["content_v2", "content"]) {
      text = extractDoubaoTextFromValue(parseJsonText(block[field]));
      if (text) return text;
    }
  }
  return "";
}

function extractDoubaoCreationItems(messageList) {
  const items = [];
  const seenKeys = new Set();

  function addCreations(creations) {
    if (!Array.isArray(creations)) return;
    for (const creation of creations) {
      if (!creation || typeof creation !== "object") continue;
      const image = creation.image;
      if (!image || typeof image !== "object") continue;
      let key = normalizeText(image.key);
      const candidates = [];
      for (const field of ["image_ori_raw", "image_ori", "image_preview", "image_thumb"]) {
        const source = image[field];
        const url = source && typeof source === "object" ? normalizeEmbeddedUrl(source.url) : normalizeEmbeddedUrl(source);
        if (!url || !isDoubaoImageUrl(url) || candidates.includes(url)) continue;
        candidates.push(url);
      }
      if (!candidates.length) continue;
      if (!key) key = doubaoImageGroupKey(candidates[0]) || candidates[0];
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push({ key, urls: candidates });
    }
  }

  for (const message of messageList) {
    if (!message || typeof message !== "object") continue;
    if (!Array.isArray(message.content_block)) continue;
    for (const block of message.content_block) {
      if (!block || typeof block !== "object") continue;
      for (const field of ["content_v2", "content"]) {
        const parsed = parseJsonText(block[field]);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        addCreations(parsed.creations);
        if (parsed.creation_block && typeof parsed.creation_block === "object") {
          addCreations(parsed.creation_block.creations);
        }
      }
    }
  }
  return items;
}

function extractDoubaoFallbackImageItems(payload, htmlText) {
  let blob = `${JSON.stringify(payload)}\n${htmlText}`;
  blob = htmlUnescape(blob).replace(/\\\\u0026/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  const candidates = [];
  for (const match of blob.matchAll(DOUBAO_URL_SCAN_PATTERN)) {
    const url = normalizeEmbeddedUrl(match[0]);
    if (url) candidates.push(url);
  }
  const preferred = pickPreferredDoubaoUrls(candidates);
  return preferred.map((url, idx) => ({
    key: doubaoImageGroupKey(url) || `doubao_image_${String(idx + 1).padStart(3, "0")}`,
    urls: [url],
  }));
}

async function parseDoubaoThread(urlText, cookie = null) {
  const extraHeaders = cookie ? { Cookie: cookie } : null;
  let payload = null;
  let htmlText = "";
  let finalUrl = urlText;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await fetchTextUrl(urlText, { timeout: 25000, referer: DOUBAO_HOME_URL, extraHeaders });
    htmlText = result.text;
    finalUrl = result.finalUrl;
    payload = extractDoubaoScriptPayload(htmlText);
    if (payload) break;
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }

  if (!payload) throw new Error("未从豆包页面提取到线程数据，请稍后重试。");
  if (!payload.data || typeof payload.data !== "object") throw new Error("豆包页面缺少 data 数据。");
  if (!payload.data.share_info || typeof payload.data.share_info !== "object") throw new Error("豆包页面缺少 share_info 数据。");

  const shareInfo = payload.data.share_info;
  const messageSnapshot = payload.data.message_snapshot;
  const messageList =
    messageSnapshot && typeof messageSnapshot === "object" && Array.isArray(messageSnapshot.message_list)
      ? messageSnapshot.message_list
      : [];

  let imageItems = extractDoubaoCreationItems(messageList);
  if (!imageItems.length) imageItems = extractDoubaoFallbackImageItems(payload, htmlText);
  if (!imageItems.length) throw new Error("未从豆包线程提取到可下载图片。");

  let author = "";
  if (shareInfo.user && typeof shareInfo.user === "object") {
    author = normalizeText(shareInfo.user.nick_name);
  }

  let promptText = "";
  let replyText = "";
  if (messageList.length && messageList[0] && typeof messageList[0] === "object") {
    promptText = extractDoubaoMessageText(messageList[0]);
  }
  for (let i = messageList.length - 1; i >= 0; i -= 1) {
    const item = messageList[i];
    if (!item || typeof item !== "object") continue;
    const text = extractDoubaoMessageText(item);
    if (text) {
      replyText = text;
      break;
    }
  }

  return {
    source_url: finalUrl,
    thread_id: normalizeText(shareInfo.share_id),
    title: normalizeText(shareInfo.share_name),
    author,
    prompt_text: promptText,
    reply_text: replyText,
    image_items: imageItems,
  };
}

function buildXianyuCanonicalUrl(itemId) {
  return `https://h5.m.goofish.com/item?itemId=${encodeURIComponent(String(itemId || "").trim())}`;
}

function getCookieByNameFromSetCookie(setCookieHeader, cookieName) {
  if (!setCookieHeader || !cookieName) return "";
  const regex = new RegExp(`${cookieName}=([^;\\s,]+)`, "i");
  const match = regex.exec(String(setCookieHeader));
  return match ? String(match[1] || "").trim() : "";
}

function isLikelyXianyuVideoUrl(urlText, keyPath = "") {
  const url = normalizeEmbeddedUrl(urlText);
  if (!url || !url.startsWith("http")) return false;
  const lower = url.toLowerCase();
  if (/\.(mp4|mov|m4v|webm|mkv|m3u8)(?:\?|$)/i.test(lower)) return true;
  if (/video|play|stream|dash|hls|m3u8|mp4/.test(lower)) return true;
  if (/video|play|stream|dash|hls/i.test(String(keyPath || ""))) return true;
  return false;
}

function extractXianyuVideoUrls(videoPlayInfo) {
  if (!videoPlayInfo || typeof videoPlayInfo !== "object") return [];
  const urls = [];
  const walk = (value, keyPath = "videoPlayInfo") => {
    if (typeof value === "string") {
      const url = normalizeEmbeddedUrl(value);
      if (!url || !url.startsWith("http")) return;
      if (XIANYU_VIDEO_SKIP_KEY_PATTERN.test(keyPath) && !/\.(mp4|mov|m4v|webm|mkv|m3u8)(?:\?|$)/i.test(url)) {
        return;
      }
      if (isLikelyXianyuVideoUrl(url, keyPath)) urls.push(url);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        walk(value[i], `${keyPath}[${i}]`);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, `${keyPath}.${k}`);
      }
    }
  };
  walk(videoPlayInfo);
  return uniqueItems(urls);
}

function extractXianyuImageUrls(itemDo, payloadData) {
  const imageUrls = [];
  if (itemDo && Array.isArray(itemDo.imageInfos)) {
    for (const imageInfo of itemDo.imageInfos) {
      if (!imageInfo || typeof imageInfo !== "object") continue;
      for (const field of ["url", "originUrl", "majorPicUrl", "picUrl"]) {
        const url = normalizeEmbeddedUrl(imageInfo[field]);
        if (!url || !url.startsWith("http")) continue;
        imageUrls.push(url);
      }
    }
  }
  if (!imageUrls.length) {
    const fallbackCandidates = [
      payloadData?.trackParams?.mainPic,
      payloadData?.flowData?.trackParams?.mainPic,
      itemDo?.majorPicUrl,
    ];
    for (const item of fallbackCandidates) {
      const url = normalizeEmbeddedUrl(item);
      if (!url || !url.startsWith("http")) continue;
      imageUrls.push(url);
    }
  }
  return uniqueItems(imageUrls);
}

function guessVideoExtension(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const ext = path.extname(parsed.pathname || "").toLowerCase();
    if (VIDEO_EXTS.has(ext)) return ext;
    if ((parsed.pathname || "").toLowerCase().includes(".m3u8")) return ".m3u8";
  } catch {
    // ignore
  }
  if (String(videoUrl || "").toLowerCase().includes(".m3u8")) return ".m3u8";
  return ".mp4";
}

async function fetchXianyuMtopPayload(itemId) {
  const safeItemId = normalizeText(itemId);
  if (!safeItemId) throw new Error("闲鱼链接缺少 itemId。");

  const mtopUrl = `${XIANYU_MTOP_BASE}/${XIANYU_MTOP_API}/${XIANYU_MTOP_VERSION}/`;
  const dataText = JSON.stringify({ itemId: safeItemId });
  const baseHeaders = {
    "User-Agent": DIANPING_UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: XIANYU_HOME_URL,
  };

  const firstParams = new URLSearchParams({
    jsv: "2.6.1",
    appKey: XIANYU_MTOP_APP_KEY,
    t: String(Date.now()),
    sign: "",
    api: XIANYU_MTOP_API,
    v: XIANYU_MTOP_VERSION,
    type: "originaljson",
    dataType: "json",
    timeout: "20000",
    data: dataText,
  });
  const firstUrl = `${mtopUrl}?${firstParams.toString()}`;
  const firstResp = await fetch(firstUrl, { method: "GET", headers: baseHeaders, redirect: "follow" });
  if (!firstResp.ok) throw new Error(`闲鱼接口预请求失败: HTTP ${firstResp.status}`);

  const setCookieHeader = firstResp.headers.get("set-cookie") || "";
  const mH5Tk = getCookieByNameFromSetCookie(setCookieHeader, "_m_h5_tk");
  const mH5TkEnc = getCookieByNameFromSetCookie(setCookieHeader, "_m_h5_tk_enc");
  if (!mH5Tk || !mH5TkEnc) {
    throw new Error("闲鱼接口预请求失败：未获取到 mtop token。");
  }
  const token = String(mH5Tk).split("_", 1)[0];
  if (!token) throw new Error("闲鱼接口预请求失败：token 无效。");

  const t = String(Date.now());
  const sign = crypto.createHash("md5").update(`${token}&${t}&${XIANYU_MTOP_APP_KEY}&${dataText}`, "utf8").digest("hex");
  const secondParams = new URLSearchParams({
    jsv: "2.6.1",
    appKey: XIANYU_MTOP_APP_KEY,
    t,
    sign,
    api: XIANYU_MTOP_API,
    v: XIANYU_MTOP_VERSION,
    type: "originaljson",
    dataType: "json",
    timeout: "20000",
    data: dataText,
  });

  const secondUrl = `${mtopUrl}?${secondParams.toString()}`;
  const cookieText = `_m_h5_tk=${mH5Tk}; _m_h5_tk_enc=${mH5TkEnc}`;
  const secondResp = await fetch(secondUrl, {
    method: "GET",
    headers: { ...baseHeaders, Cookie: cookieText },
    redirect: "follow",
  });
  const rawText = await secondResp.text();
  if (!secondResp.ok) throw new Error(`闲鱼接口请求失败: HTTP ${secondResp.status}`);

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error("闲鱼接口返回非 JSON 数据。");
  }

  const retList = Array.isArray(payload?.ret) ? payload.ret.map((x) => String(x || "").trim()) : [];
  const isSuccess = retList.length === 0 || retList.some((item) => item.toUpperCase().startsWith("SUCCESS"));
  if (!isSuccess) {
    const retText = retList.join(" | ") || "unknown";
    throw new Error(`闲鱼接口返回异常: ${retText}`);
  }
  if (!payload || typeof payload !== "object" || !payload.data || typeof payload.data !== "object") {
    throw new Error("闲鱼接口返回数据缺失。");
  }
  return payload;
}

async function parseXianyuItem(urlText) {
  const itemId = getXianyuItemIdFromUrl(urlText);
  if (!itemId) throw new Error(`闲鱼链接缺少 itemId: ${urlText}`);

  const payload = await fetchXianyuMtopPayload(itemId);
  const data = payload.data || {};
  const itemDo = data.itemDO && typeof data.itemDO === "object" ? data.itemDO : {};
  const sellerDo = data.sellerDO && typeof data.sellerDO === "object" ? data.sellerDO : {};

  const title = normalizeText(itemDo.title);
  const description = normalizeText(itemDo.desc);
  const seller =
    normalizeText(sellerDo.nick) ||
    normalizeText(sellerDo.desensitizationNick) ||
    normalizeText(itemDo.userNick) ||
    "闲鱼卖家";
  const city = normalizeText(sellerDo.city) || normalizeText(sellerDo.publishCity);
  const price = normalizeText(itemDo.soldPrice) || normalizeText(itemDo.price) || normalizeText(itemDo.originalPrice);

  const imageUrls = extractXianyuImageUrls(itemDo, data);
  if (!imageUrls.length) throw new Error("未从闲鱼商品详情提取到可下载图片。");

  const videoUrls = extractXianyuVideoUrls(itemDo.videoPlayInfo);
  const canonicalUrl = buildXianyuCanonicalUrl(itemId);

  return {
    item_id: itemId,
    source_url: canonicalUrl,
    raw_url: urlText,
    title: title || `闲鱼商品_${itemId}`,
    description,
    seller,
    city,
    price,
    image_urls: imageUrls,
    video_urls: videoUrls,
  };
}

async function runXianyuDownload(task) {
  const rawUrlValue = parseCommandOption(task.command, "--url");
  if (!rawUrlValue) throw new Error("缺少闲鱼商品链接参数。");

  const rawCandidates = uniqueItems(extractUrls(rawUrlValue));
  const candidates = uniqueItems(
    rawCandidates.filter((url) => isXianyuItemUrl(url) || isTbShortUrl(url)),
  );
  if (!candidates.length) throw new Error("未找到有效的闲鱼商品链接。");

  const targetRoot = resolveDownloadDirFromCommand(task.command);
  const settings = getSettings();
  const concurrency = Math.max(
    1,
    Math.min(8, parseIntOption(task.command, "--concurrency", settings.concurrency)),
  );
  await fsp.mkdir(targetRoot, { recursive: true });
  task.addLog(`[xianyu] total items: ${candidates.length}, parallel: ${concurrency}`);

  const failedItems = [];
  await runWithConcurrency(candidates, concurrency, async (inputUrl, idx) => {
    let itemUrl = inputUrl;
    try {
      if (isTbShortUrl(inputUrl)) {
        itemUrl = await resolveTbShortUrl(inputUrl);
        task.addLog(`[xianyu] (${idx + 1}/${candidates.length}) short url resolved: ${itemUrl}`);
      }
      if (!isXianyuItemUrl(itemUrl)) {
        throw new Error(`非闲鱼商品详情链接: ${itemUrl}`);
      }

      task.addLog(`[xianyu] (${idx + 1}/${candidates.length}) parsing item: ${itemUrl}`);
      const parsed = await parseXianyuItem(itemUrl);
      const imageUrls = parsed.image_urls;
      const videoUrls = parsed.video_urls;
      task.addLog(
        `[xianyu] (${idx + 1}/${candidates.length}) parsed images=${imageUrls.length}, videos=${videoUrls.length}`,
      );

      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}.${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
      const seller = trimFilenamePart(sanitizeFilename(parsed.seller || "闲鱼"), 24);
      const title = trimFilenamePart(sanitizeFilename(parsed.title || parsed.item_id || "xianyu_item"), 42);
      const itemToken = trimFilenamePart(sanitizeFilename(parsed.item_id || `item_${idx + 1}`), 20);
      const prefix = sanitizeFilename(`${timestamp}_${seller}_${title}_${itemToken}`);

      for (let i = 0; i < imageUrls.length; i += 1) {
        const imageUrl = imageUrls[i];
        const ext = guessImageExtension(imageUrl);
        const fileName = `${prefix}_${i + 1}${ext}`;
        const filePath = path.join(targetRoot, fileName);
        await downloadBinaryFile(imageUrl, filePath, parsed.source_url);
        task.addLog(`[xianyu] (${idx + 1}/${candidates.length}) image ${i + 1}/${imageUrls.length}: ${fileName}`);
      }

      let videoSuccess = 0;
      let videoFailed = 0;
      if (!videoUrls.length) {
        task.addLog(`[xianyu][warn] (${idx + 1}/${candidates.length}) no video for item ${parsed.item_id}`);
      } else {
        for (let i = 0; i < videoUrls.length; i += 1) {
          const videoUrl = videoUrls[i];
          const ext = guessVideoExtension(videoUrl);
          const fileName = `${prefix}_video_${i + 1}${ext}`;
          const filePath = path.join(targetRoot, fileName);
          try {
            await downloadBinaryFile(videoUrl, filePath, parsed.source_url);
            videoSuccess += 1;
            task.addLog(`[xianyu] (${idx + 1}/${candidates.length}) video ${i + 1}/${videoUrls.length}: ${fileName}`);
          } catch (err) {
            videoFailed += 1;
            try { await fsp.unlink(filePath); } catch {}
            task.addLog(
              `[xianyu][warn] (${idx + 1}/${candidates.length}) video ${i + 1}/${videoUrls.length} failed: ${err.message || err}`,
            );
          }
        }
      }

      const metaLines = [];
      if (parsed.title) metaLines.push(String(parsed.title));
      if (parsed.description) metaLines.push(String(parsed.description));
      metaLines.push(`商品ID: ${parsed.item_id}`);
      if (parsed.seller) metaLines.push(`卖家: ${parsed.seller}`);
      if (parsed.city) metaLines.push(`城市: ${parsed.city}`);
      if (parsed.price) metaLines.push(`价格: ${parsed.price}`);
      metaLines.push(`原始链接: ${inputUrl}`);
      metaLines.push(`解析链接: ${itemUrl}`);
      metaLines.push(`标准链接: ${parsed.source_url}`);
      metaLines.push(`图片数量: ${imageUrls.length}`);
      metaLines.push(`视频数量: ${videoUrls.length}`);
      metaLines.push(`视频下载成功: ${videoSuccess}`);
      metaLines.push(`视频下载失败: ${videoFailed}`);
      const metaPath = path.join(targetRoot, `${prefix}.txt`);
      await fsp.writeFile(metaPath, `${metaLines.join("\n\n").trim()}\n`, "utf8");
      task.addLog(`[xianyu] (${idx + 1}/${candidates.length}) metadata saved: ${path.basename(metaPath)}`);
    } catch (err) {
      const message = String(err.message || err);
      failedItems.push({ inputUrl, message });
      task.addLog(`[xianyu-error] (${idx + 1}/${candidates.length}) ${inputUrl} -> ${message}`);
    }
  });

  if (failedItems.length > 0) {
    throw new Error(`闲鱼商品下载失败 ${failedItems.length}/${candidates.length} 条，详见日志。`);
  }
}

function resolveDownloadDirFromCommand(command) {
  const settings = getSettings();
  let workPath = String(settings.work_path || DOWNLOADS_DIR);
  let folderName = String(settings.folder_name || DEFAULT_SETTINGS.folderName);
  if (command.includes("--work_path")) {
    const idx = command.indexOf("--work_path");
    if (idx + 1 < command.length) workPath = command[idx + 1];
  }
  if (command.includes("--folder_name")) {
    const idx = command.indexOf("--folder_name");
    if (idx + 1 < command.length) folderName = command[idx + 1];
  }
  return path.join(workPath, folderName);
}

async function runDianpingDownload(task) {
  const urlValue = parseCommandOption(task.command, "--url");
  if (!urlValue) throw new Error("缺少大众点评链接参数。");
  const targetRoot = resolveDownloadDirFromCommand(task.command);
  await fsp.mkdir(targetRoot, { recursive: true });

  task.addLog(`[dianping] 开始解析: ${urlValue}`);
  const parsed = await parseDianpingFeed(urlValue);
  const imageUrls = parsed.image_urls;
  task.addLog(`[dianping] 解析完成，获取到 ${imageUrls.length} 张图片。`);

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}.${String(now.getSeconds()).padStart(2, "0")}`;
  const author = trimFilenamePart(sanitizeFilename(parsed.author || "大众点评"), 24);
  const title = trimFilenamePart(sanitizeFilename(parsed.title || parsed.feed_id || "点评笔记"), 42);
  const prefix = sanitizeFilename(`${timestamp}_${author}_${title}`);

  for (let i = 0; i < imageUrls.length; i += 1) {
    const imageUrl = imageUrls[i];
    const ext = guessImageExtension(imageUrl);
    const fileName = `${prefix}_${i + 1}${ext}`;
    const filePath = path.join(targetRoot, fileName);
    await downloadBinaryFile(imageUrl, filePath, parsed.source_url);
    task.addLog(`[dianping] (${i + 1}/${imageUrls.length}) ${fileName}`);
  }

  const metaLines = [];
  if (parsed.title) metaLines.push(String(parsed.title));
  if (parsed.description) metaLines.push(String(parsed.description));
  metaLines.push(`原始链接: ${urlValue}`);
  metaLines.push(`实际链接: ${parsed.source_url}`);
  if (parsed.feed_id) metaLines.push(`作品ID: ${parsed.feed_id}`);
  if (parsed.author) metaLines.push(`作者: ${parsed.author}`);
  const metaPath = path.join(targetRoot, `${prefix}.txt`);
  await fsp.writeFile(metaPath, `${metaLines.join("\n\n").trim()}\n`, "utf8");
  task.addLog(`[dianping] 文案已保存: ${path.basename(metaPath)}`);
}

function compactTextForMeta(value, maxLength = 4000) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function decodeXhsEscapedText(value) {
  let text = normalizeText(value);
  if (!text) return "";
  text = htmlUnescape(text);
  text = text.replace(/\\\\u0026/g, "&").replace(/\\u0026/g, "&");
  text = text.replace(/\\\\u003d/g, "=").replace(/\\u003d/g, "=");
  text = text.replace(/\\\//g, "/");
  return text;
}

function buildXhsExploreUrl(noteId, xsecToken = "") {
  const id = normalizeText(noteId);
  if (!id) return "";
  const token = decodeXhsEscapedText(xsecToken);
  if (!token) return `https://www.xiaohongshu.com/explore/${id}`;
  return `https://www.xiaohongshu.com/explore/${id}?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user`;
}

function parseXhsProfileCursorInfo(htmlText) {
  const match =
    /\"noteQueries\"\s*:\s*\[\s*\{[\s\S]*?\"cursor\"\s*:\s*\"([0-9a-z]*)\"[\s\S]*?\"hasMore\"\s*:\s*(true|false)/i.exec(
      htmlText,
    );
  if (!match) return { cursor: "", hasMore: false };
  return {
    cursor: String(match[1] || "").trim(),
    hasMore: String(match[2] || "").trim().toLowerCase() === "true",
  };
}

function parseXhsProfileNotesFromHtml(htmlText) {
  const ids = new Set();
  const tokenById = new Map();

  for (const match of htmlText.matchAll(/href=\"\/(?:explore|discovery\/item)\/([0-9a-z]{16,32})(?:\?([^\"]*))?\"/gi)) {
    const noteId = String(match[1] || "").trim();
    if (!noteId) continue;
    ids.add(noteId);
    const queryText = decodeXhsEscapedText(match[2] || "");
    if (!queryText) continue;
    const params = new URLSearchParams(queryText);
    const token = decodeXhsEscapedText(params.get("xsec_token") || "");
    if (token && !tokenById.has(noteId)) tokenById.set(noteId, token);
  }

  const patterns = [
    /\"noteId\"\s*:\s*\"([0-9a-z]{16,32})\"[\s\S]{0,320}?\"xsecToken\"\s*:\s*\"([^\"]+)\"/gi,
    /\"xsecToken\"\s*:\s*\"([^\"]+)\"[\s\S]{0,320}?\"noteId\"\s*:\s*\"([0-9a-z]{16,32})\"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of htmlText.matchAll(pattern)) {
      const noteId = String(pattern === patterns[0] ? match[1] : match[2] || "").trim();
      const token = decodeXhsEscapedText(pattern === patterns[0] ? match[2] : match[1] || "");
      if (!noteId) continue;
      ids.add(noteId);
      if (token && !tokenById.has(noteId)) tokenById.set(noteId, token);
    }
  }

  const noteUrls = [];
  for (const noteId of ids) {
    const noteUrl = buildXhsExploreUrl(noteId, tokenById.get(noteId) || "");
    if (noteUrl) noteUrls.push(noteUrl);
  }
  return uniqueItems(noteUrls);
}

function isXhsCaptchaUrl(urlText) {
  const value = String(urlText || "").toLowerCase();
  return value.includes("/website-login/captcha");
}

function isXhsCaptchaHtml(htmlText) {
  const value = String(htmlText || "").toLowerCase();
  return value.includes("/website-login/captcha") || value.includes("verifyuuid=");
}

function isXhsLoginUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    if (!isXhsUrl(urlText)) return false;
    return (parsed.pathname || "").startsWith("/login");
  } catch {
    return false;
  }
}

function isXhsLoginHtml(htmlText) {
  const value = String(htmlText || "").toLowerCase();
  return value.includes("redirectpath=") && value.includes("xiaohongshu.com/login");
}

function parseXhsErrorCodeFromUrl(urlText) {
  const raw = String(urlText || "");
  if (!raw) return "";
  const plainMatch = /(?:[?&])error_code=(\d{3,})/i.exec(raw);
  if (plainMatch) return String(plainMatch[1] || "");
  try {
    const parsed = new URL(raw);
    const direct = normalizeText(parsed.searchParams.get("error_code"));
    if (direct) return direct;
    const source = normalizeText(parsed.searchParams.get("source"));
    if (!source) return "";
    const sourceMatch = /(?:[?&])error_code=(\d{3,})/i.exec(source);
    return sourceMatch ? String(sourceMatch[1] || "") : "";
  } catch {
    return "";
  }
}

function isXhsBlocked404Url(urlText) {
  try {
    const parsed = new URL(urlText);
    if (!isXhsUrl(urlText)) return false;
    if (!(parsed.pathname || "").startsWith("/404")) return false;
    return !!parseXhsErrorCodeFromUrl(urlText);
  } catch {
    return false;
  }
}

function detectXhsAccessIssue(finalUrl, htmlText) {
  if (isXhsLoginUrl(finalUrl) || isXhsLoginHtml(htmlText)) {
    return {
      type: "login",
      reason: "Cookie 失效/需要重新登录",
      errorCode: "",
    };
  }
  if (isXhsCaptchaUrl(finalUrl) || isXhsCaptchaHtml(htmlText)) {
    return {
      type: "captcha",
      reason: "触发验证码/风控",
      errorCode: "",
    };
  }
  if (isXhsBlocked404Url(finalUrl)) {
    const errorCode = parseXhsErrorCodeFromUrl(finalUrl);
    return {
      type: "blocked",
      reason: `主页当前不可浏览（error_code=${errorCode || "unknown"}）`,
      errorCode,
    };
  }
  return null;
}

function getXhsCookieFromCommand(command) {
  const cookieFromCommand = normalizeText(parseCommandOption(command, "--cookie"));
  if (cookieFromCommand) return cookieFromCommand;
  const settings = getSettings();
  return normalizeText(settings.xhsCookie || settings.cookie);
}

async function preflightXhsNoteAccess(sampleUrl, cookieValue, task) {
  const extraHeaders = {};
  if (cookieValue) extraHeaders.Cookie = cookieValue;
  const { text: htmlText, finalUrl } = await fetchTextUrl(sampleUrl, {
    timeout: 20000,
    referer: "https://www.xiaohongshu.com/",
    extraHeaders,
  });
  const issue = detectXhsAccessIssue(finalUrl, htmlText);
  if (issue) {
    if (issue.type === "blocked") {
      throw new Error(`${issue.reason}，请稍后重试或更换主页链接。`);
    }
    const reason = cookieValue ? "Cookie 可能已失效" : "未提供 Cookie";
    if (issue.type === "login") {
      throw new Error(`XHS 访问被重定向到登录页（${reason}），请刷新 Cookie 后重试。`);
    }
    throw new Error("XHS 触发验证码/风控，请刷新 Cookie 后重试。");
  }
  task.addLog(`[xhs-check] preflight ok: ${sampleUrl}`);
}

async function extractXhsProfileNoteUrls(profileUrl, cookieValue, task) {
  const userId = getXhsProfileUserId(profileUrl);
  if (!userId) throw new Error(`Invalid XHS profile URL: ${profileUrl}`);

  const extraHeaders = {};
  if (cookieValue) extraHeaders.Cookie = cookieValue;

  const allNotes = new Set();
  const seenCursor = new Set();
  let nextUrl = profileUrl;
  let stopReason = "";
  let stopErrorCode = "";
  let pages = 0;

  for (let page = 0; page < XHS_PROFILE_MAX_PAGES; page += 1) {
    pages = page + 1;
    const { text: htmlText, finalUrl } = await fetchTextUrl(nextUrl, {
      timeout: 30000,
      referer: "https://www.xiaohongshu.com/",
      extraHeaders,
    });

    const issue = detectXhsAccessIssue(finalUrl, htmlText);
    if (issue) {
      stopReason = issue.reason;
      stopErrorCode = issue.errorCode || "";
      if (page === 0 || allNotes.size === 0) {
        task.addLog(`[xhs-profile] ${userId} page ${page + 1}: ${issue.reason}`);
        return {
          status: "blocked",
          noteUrls: [],
          reason: issue.reason,
          errorCode: stopErrorCode,
          pages,
        };
      }
      task.addLog(
        `[xhs-profile] ${userId} page ${page + 1}: ${issue.reason}，中途风控，已保留已抓取内容继续下载。`,
      );
      return {
        status: "partial",
        noteUrls: [...allNotes],
        reason: issue.reason,
        errorCode: stopErrorCode,
        pages,
      };
    }

    const noteUrls = parseXhsProfileNotesFromHtml(htmlText);
    let added = 0;
    for (const item of noteUrls) {
      if (allNotes.has(item)) continue;
      allNotes.add(item);
      added += 1;
    }
    task.addLog(`[xhs-profile] ${userId} page ${page + 1}: +${added}, total ${allNotes.size}`);

    const { cursor, hasMore } = parseXhsProfileCursorInfo(htmlText);
    if (!hasMore) {
      task.addLog(`[xhs-profile] ${userId} page ${page + 1}: hasMore=false, stop paging.`);
      stopReason = "hasMore=false";
      break;
    }
    if (!cursor) {
      task.addLog(`[xhs-profile] ${userId} page ${page + 1}: cursor missing, stop paging.`);
      stopReason = "cursor missing";
      break;
    }
    if (seenCursor.has(cursor)) {
      task.addLog(`[xhs-profile] ${userId} page ${page + 1}: cursor repeated, stop paging.`);
      stopReason = "cursor repeated";
      break;
    }
    seenCursor.add(cursor);
    nextUrl = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}?cursor=${encodeURIComponent(cursor)}`;
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  const noteUrls = [...allNotes];
  if (!noteUrls.length) {
    return {
      status: "empty",
      noteUrls: [],
      reason: stopReason || "主页可访问，但当前无可下载作品",
      errorCode: stopErrorCode,
      pages,
    };
  }
  return {
    status: "ok",
    noteUrls,
    reason: stopReason,
    errorCode: stopErrorCode,
    pages,
  };
}

async function expandXhsProfileUrls(profileUrls, command, task) {
  const cookieValue = getXhsCookieFromCommand(command);
  const mergedNoteUrls = [];
  const blockedProfiles = [];
  const emptyProfiles = [];
  const partialProfiles = [];
  const uniqueProfiles = uniqueItems(profileUrls);
  for (let i = 0; i < uniqueProfiles.length; i += 1) {
    const profileUrl = uniqueProfiles[i];
    const userId = getXhsProfileUserId(profileUrl) || profileUrl;
    task.addLog(`[xhs-profile] (${i + 1}/${uniqueProfiles.length}) resolving: ${profileUrl}`);
    const result = await extractXhsProfileNoteUrls(profileUrl, cookieValue, task);
    const count = Array.isArray(result.noteUrls) ? result.noteUrls.length : 0;
    task.addLog(
      `[xhs-profile] (${i + 1}/${uniqueProfiles.length}) status=${result.status}, notes=${count}, pages=${result.pages || 0}`,
    );
    if (result.status === "blocked") {
      blockedProfiles.push({
        profileUrl,
        userId,
        reason: result.reason || "主页不可浏览",
        errorCode: result.errorCode || "",
      });
      continue;
    }
    if (result.status === "empty") {
      emptyProfiles.push({
        profileUrl,
        userId,
        reason: result.reason || "主页可访问但无可下载作品",
        errorCode: result.errorCode || "",
      });
      continue;
    }
    if (result.status === "partial") {
      partialProfiles.push({
        profileUrl,
        userId,
        reason: result.reason || "中途风控",
        errorCode: result.errorCode || "",
        noteCount: count,
      });
    }
    mergedNoteUrls.push(...(result.noteUrls || []));
  }
  return {
    mergedNoteUrls: uniqueItems(mergedNoteUrls),
    blockedProfiles,
    emptyProfiles,
    partialProfiles,
  };
}

function extractXhsInitialStateScript(htmlText) {
  const marker = "window.__INITIAL_STATE__=";
  const start = String(htmlText || "").indexOf(marker);
  if (start < 0) return "";
  const source = String(htmlText || "");
  let cursor = start + marker.length;
  let started = false;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      started = true;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(start + marker.length, cursor + 1);
      }
    }
  }
  return "";
}

function normalizeJsLiteralForJson(rawText) {
  return String(rawText || "")
    .replace(/:\s*undefined(?=\s*[,}])/g, ": null")
    .replace(/\[\s*undefined(?=\s*[,}\]])/g, "[null")
    .replace(/,\s*undefined(?=\s*[,}\]])/g, ", null")
    .replace(/=\s*undefined(?=\s*[,}])/g, "= null");
}

function parseXhsInitialState(htmlText) {
  const raw = extractXhsInitialStateScript(htmlText);
  if (!raw) return null;
  const normalized = normalizeJsLiteralForJson(raw);
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return vm.runInNewContext(`(${normalized})`, Object.create(null), { timeout: 1000 });
    } catch {
      return null;
    }
  }
}

function safeArrayValue(value, index) {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") return Object.values(value)[index];
  return undefined;
}

function deepGet(data, keys, fallback = undefined) {
  let current = data;
  for (const key of keys) {
    if (current === null || current === undefined) return fallback;
    if (typeof key === "number") {
      current = safeArrayValue(current, key);
      continue;
    }
    current = current[key];
  }
  return current === undefined ? fallback : current;
}

function findObjectDeep(root, predicate, depth = 0, visited = new Set()) {
  if (!root || typeof root !== "object") return null;
  if (visited.has(root)) return null;
  visited.add(root);
  if (predicate(root)) return root;
  if (depth > 12) return null;
  const values = Array.isArray(root) ? root : Object.values(root);
  for (const item of values) {
    const found = findObjectDeep(item, predicate, depth + 1, visited);
    if (found) return found;
  }
  return null;
}

function getLastObjectValue(value) {
  if (!value || typeof value !== "object") return null;
  const values = Object.values(value);
  return values.length ? values[values.length - 1] : null;
}

function extractXhsNoteDataFromState(state) {
  const phone = deepGet(state, ["noteData", "data", "noteData"]);
  if (phone && typeof phone === "object") return phone;

  const noteDetailMap = deepGet(state, ["note", "noteDetailMap"]);
  const lastEntry = getLastObjectValue(noteDetailMap);
  const pcNote = lastEntry && typeof lastEntry === "object" ? lastEntry.note : null;
  if (pcNote && typeof pcNote === "object") return pcNote;

  return findObjectDeep(state, (item) => {
    if (!item || typeof item !== "object") return false;
    const noteId = normalizeText(item.noteId);
    const hasUser = !!(item.user && typeof item.user === "object");
    const hasMedia = Array.isArray(item.imageList) || !!item.video;
    return !!noteId && hasUser && hasMedia;
  });
}

function normalizeXhsCdnUrl(urlText) {
  const decoded = decodeXhsEscapedText(urlText);
  if (!decoded) return "";
  if (decoded.startsWith("http://")) return `https://${decoded.slice(7)}`;
  return decoded;
}

function extractXhsImageToken(urlText) {
  const normalized = normalizeXhsCdnUrl(urlText);
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts.length < 6) return "";
  return parts.slice(5).join("/").split("!")[0];
}

function buildXhsImageLinks(noteData) {
  const images = Array.isArray(noteData?.imageList) ? noteData.imageList : [];
  const imageUrls = [];
  const liveUrls = [];
  for (const item of images) {
    const token = extractXhsImageToken(item?.urlDefault || item?.url || "");
    if (token) imageUrls.push(`https://sns-img-bd.xhscdn.com/${token}`);
    const liveUrl =
      normalizeXhsCdnUrl(deepGet(item, ["stream", "h264", 0, "masterUrl"], "")) || null;
    liveUrls.push(liveUrl);
  }
  return {
    imageUrls: uniqueItems(imageUrls),
    liveUrls,
  };
}

function buildXhsVideoLinks(noteData) {
  const originKey = normalizeText(deepGet(noteData, ["video", "consumer", "originVideoKey"], ""));
  if (originKey) {
    return [`https://sns-video-bd.xhscdn.com/${originKey}`];
  }

  const streamItems = [
    ...(Array.isArray(deepGet(noteData, ["video", "media", "stream", "h264"], []))
      ? deepGet(noteData, ["video", "media", "stream", "h264"], [])
      : []),
    ...(Array.isArray(deepGet(noteData, ["video", "media", "stream", "h265"], []))
      ? deepGet(noteData, ["video", "media", "stream", "h265"], [])
      : []),
  ];
  const sorted = streamItems
    .filter((item) => item && typeof item === "object")
    .sort((left, right) => (Number(right.height) || 0) - (Number(left.height) || 0));
  if (!sorted.length) return [];
  const best = sorted[0];
  const backups = Array.isArray(best.backupUrls) ? best.backupUrls : [];
  const primary = normalizeXhsCdnUrl(backups[0] || best.masterUrl || "");
  return primary ? [primary] : [];
}

function guessXhsNoteType(noteData) {
  const noteType = normalizeText(noteData?.type);
  const imageCount = Array.isArray(noteData?.imageList) ? noteData.imageList.length : 0;
  if (noteType === "video") return imageCount > 1 ? "gallery" : "video";
  if (noteType === "normal") return "image";
  return "unknown";
}

function fallbackXhsMediaUrlsFromHtml(htmlText) {
  const imageUrls = new Set();
  const videoUrls = new Set();
  for (const match of String(htmlText || "").matchAll(/https?:\\?\/\\?\/[^"'\\<>\s]+xhscdn\.com[^"'\\<>\s]+/gi)) {
    const decoded = normalizeXhsCdnUrl(match[0]);
    if (!decoded) continue;
    if (DOUBAO_IMAGE_EXT_PATTERN.test(decoded) || decoded.includes("sns-webpic") || decoded.includes("sns-img")) {
      imageUrls.add(decoded);
      continue;
    }
    if (/\.(?:mp4|m3u8)(?:\?|$)/i.test(decoded) || decoded.includes("sns-video")) {
      videoUrls.add(decoded);
    }
  }
  return {
    imageUrls: [...imageUrls],
    videoUrls: [...videoUrls],
  };
}

async function parseXhsNote(urlText, cookieValue = "", userAgent = "") {
  const extraHeaders = {};
  if (cookieValue) extraHeaders.Cookie = cookieValue;
  if (userAgent) extraHeaders["User-Agent"] = userAgent;

  const { text: htmlText, finalUrl } = await fetchTextUrl(urlText, {
    timeout: 25000,
    referer: "https://www.xiaohongshu.com/",
    extraHeaders,
  });
  const issue = detectXhsAccessIssue(finalUrl, htmlText);
  if (issue) {
    const error = new Error(issue.reason || "小红书页面不可访问");
    error.issue = issue;
    throw error;
  }

  const state = parseXhsInitialState(htmlText);
  const noteData = extractXhsNoteDataFromState(state || {});
  if (!noteData || typeof noteData !== "object") {
    throw new Error("未从小红书页面提取到笔记数据。");
  }

  const imageMeta = buildXhsImageLinks(noteData);
  const videoUrls = buildXhsVideoLinks(noteData);
  const fallbackMedia = fallbackXhsMediaUrlsFromHtml(htmlText);
  const noteType = guessXhsNoteType(noteData);

  const noteId = normalizeText(noteData.noteId);
  const title = normalizeText(noteData.title || noteData.displayTitle || extractMetaContent(htmlText, "property", "og:title"));
  const description = normalizeText(noteData.desc || extractMetaContent(htmlText, "property", "og:description"));
  const author = normalizeText(noteData?.user?.nickname || noteData?.user?.nickName || "小红书作者");
  const authorId = normalizeText(noteData?.user?.userId);
  const timeValue = Number(noteData.time || noteData.lastUpdateTime || 0);
  const publishedAt = timeValue ? new Date(timeValue).toISOString() : "";
  const imageUrls = uniqueItems(imageMeta.imageUrls.length ? imageMeta.imageUrls : fallbackMedia.imageUrls);
  const mergedVideoUrls = uniqueItems(videoUrls.length ? videoUrls : fallbackMedia.videoUrls);

  return {
    source_url: finalUrl,
    note_id: noteId,
    title,
    description,
    author,
    author_id: authorId,
    published_at: publishedAt,
    type: noteType,
    image_urls: imageUrls,
    live_urls: imageMeta.liveUrls,
    video_urls: mergedVideoUrls,
  };
}

function parseIntOption(command, option, fallbackValue) {
  const raw = parseCommandOption(command, option);
  if (raw === null || raw === undefined || raw === "") return fallbackValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallbackValue;
}

function parseBoolOption(command, option, fallbackValue) {
  const raw = parseCommandOption(command, option);
  const parsed = parseBool(raw);
  return parsed === null ? fallbackValue : parsed;
}

async function downloadBinaryFileWithRetry(urlText, targetPath, referer, extraHeaders, maxRetry = 1) {
  let lastError = null;
  const attempts = Math.max(1, maxRetry + 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await downloadBinaryFile(urlText, targetPath, referer, extraHeaders);
      return;
    } catch (err) {
      lastError = err;
      try { await fsp.unlink(targetPath); } catch {}
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("download failed");
}

async function runXhsDownload(task) {
  let urlValues = extractUrls(parseCommandOption(task.command, "--url") || "").filter((url) => isXhsUrl(url));
  if (!urlValues.length) throw new Error("未找到有效的小红书链接。");

  const profileUrls = urlValues.filter((url) => isXhsProfileUrl(url));
  const noteUrls = urlValues.filter((url) => isXhsUrl(url) && !isXhsProfileUrl(url));
  if (profileUrls.length) {
    const expanded = await expandXhsProfileUrls(profileUrls, task.command, task);
    urlValues = uniqueItems([...noteUrls, ...expanded.mergedNoteUrls]);
    if (!urlValues.length) {
      if (expanded.blockedProfiles.length) {
        const first = expanded.blockedProfiles[0];
        throw new Error(`XHS 主页当前不可浏览（${first.reason}）`);
      }
      throw new Error("未从小红书主页提取到可下载笔记。");
    }
  }

  const settings = getSettings();
  const cookieValue = getXhsCookieFromCommand(task.command);
  const userAgent = normalizeText(parseCommandOption(task.command, "--user_agent")) || settings.userAgent;
  const maxRetry = Math.max(0, parseIntOption(task.command, "--max_retry", settings.maxRetry));
  const concurrency = Math.max(1, Math.min(8, parseIntOption(task.command, "--concurrency", settings.concurrency)));
  const downloadImages = parseBoolOption(task.command, "--download_images", settings.downloadImages);
  const downloadVideos = parseBoolOption(task.command, "--download_videos", settings.downloadVideos);
  const targetRoot = resolveDownloadDirFromCommand(task.command);
  const extraHeaders = {};
  if (cookieValue) extraHeaders.Cookie = cookieValue;
  if (userAgent) extraHeaders["User-Agent"] = userAgent;

  await fsp.mkdir(targetRoot, { recursive: true });
  await preflightXhsNoteAccess(urlValues[0], cookieValue, task);
  task.addLog(`[xhs] total notes: ${urlValues.length}, parallel: ${concurrency}`);

  const failedNotes = [];
  await runWithConcurrency(urlValues, concurrency, async (noteUrl, index) => {
    task.addLog(`[xhs] (${index + 1}/${urlValues.length}) parsing note: ${noteUrl}`);
    try {
      const parsed = await parseXhsNote(noteUrl, cookieValue, userAgent);
      const timestampBase = parsed.published_at ? new Date(parsed.published_at) : new Date();
      const timestamp = `${timestampBase.getFullYear()}-${String(timestampBase.getMonth() + 1).padStart(2, "0")}-${String(timestampBase.getDate()).padStart(2, "0")}_${String(timestampBase.getHours()).padStart(2, "0")}.${String(timestampBase.getMinutes()).padStart(2, "0")}.${String(timestampBase.getSeconds()).padStart(2, "0")}`;
      const author = trimFilenamePart(sanitizeFilename(parsed.author || "小红书"), 24);
      const title = trimFilenamePart(sanitizeFilename(parsed.title || parsed.note_id || "小红书笔记"), 42);
      const prefix = sanitizeFilename(`${timestamp}_${author}_${title}`);

      if ((parsed.type === "image" || parsed.type === "gallery") && downloadImages) {
        if (!parsed.image_urls.length) throw new Error("图片笔记未解析到图片链接。");
        for (let imageIndex = 0; imageIndex < parsed.image_urls.length; imageIndex += 1) {
          const imageUrl = parsed.image_urls[imageIndex];
          const ext = guessImageExtension(imageUrl);
          const fileName = `${prefix}_${imageIndex + 1}${ext}`;
          const filePath = path.join(targetRoot, fileName);
          await downloadBinaryFileWithRetry(imageUrl, filePath, parsed.source_url, extraHeaders, maxRetry);
          task.addLog(`[xhs] (${index + 1}/${urlValues.length}) image ${imageIndex + 1}/${parsed.image_urls.length}: ${fileName}`);
        }
      }

      if (parsed.type === "video" && downloadVideos) {
        if (!parsed.video_urls.length) throw new Error("视频笔记未解析到视频链接。");
        const videoUrl = parsed.video_urls[0];
        const ext = path.extname(new URL(videoUrl).pathname || "").toLowerCase() || ".mp4";
        const fileName = `${prefix}${VIDEO_EXTS.has(ext) ? ext : ".mp4"}`;
        const filePath = path.join(targetRoot, fileName);
        await downloadBinaryFileWithRetry(videoUrl, filePath, parsed.source_url, extraHeaders, maxRetry);
        task.addLog(`[xhs] (${index + 1}/${urlValues.length}) video saved: ${fileName}`);
      }

      if (parsed.type === "video" && !downloadVideos) {
        task.addLog(`[xhs] (${index + 1}/${urlValues.length}) skipped video by config.`);
      }
      if ((parsed.type === "image" || parsed.type === "gallery") && !downloadImages) {
        task.addLog(`[xhs] (${index + 1}/${urlValues.length}) skipped images by config.`);
      }

      const metaLines = [];
      if (parsed.title) metaLines.push(parsed.title);
      if (parsed.description) metaLines.push(parsed.description);
      if (parsed.note_id) metaLines.push(`作品ID: ${parsed.note_id}`);
      if (parsed.author) metaLines.push(`作者: ${parsed.author}`);
      if (parsed.author_id) metaLines.push(`作者ID: ${parsed.author_id}`);
      if (parsed.published_at) metaLines.push(`发布时间: ${parsed.published_at}`);
      metaLines.push(`作品类型: ${parsed.type}`);
      metaLines.push(`原始链接: ${noteUrl}`);
      metaLines.push(`实际链接: ${parsed.source_url}`);
      const metaPath = path.join(targetRoot, `${prefix}.txt`);
      await fsp.writeFile(metaPath, `${metaLines.join("\n\n").trim()}\n`, "utf8");
      task.addLog(`[xhs] (${index + 1}/${urlValues.length}) metadata saved: ${path.basename(metaPath)}`);
    } catch (err) {
      const message = String(err.message || err);
      failedNotes.push({ noteUrl, message });
      task.addLog(`[xhs-error] (${index + 1}/${urlValues.length}) ${noteUrl} -> ${message}`);
    }
  });

  if (failedNotes.length > 0) {
    throw new Error(`小红书笔记下载失败 ${failedNotes.length}/${urlValues.length} 条，详见日志。`);
  }
}

async function runWithConcurrency(items, concurrency, handler) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex;
      if (current >= list.length) return;
      nextIndex += 1;
      await handler(list[current], current);
    }
  });
  await Promise.all(workers);
}

async function runDoubaoDownload(task) {
  const rawUrlValue = parseCommandOption(task.command, "--url");
  if (!rawUrlValue) throw new Error("Missing Doubao thread URL.");
  const urlValues = extractUrls(rawUrlValue).filter((url) => isDoubaoThreadUrl(url));
  if (!urlValues.length) throw new Error("No valid Doubao thread URL found.");
  const cookieValue = parseCommandOption(task.command, "--cookie");
  const targetRoot = resolveDownloadDirFromCommand(task.command);
  const settings = getSettings();
  await fsp.mkdir(targetRoot, { recursive: true });

  const extraHeaders = cookieValue ? { Cookie: cookieValue } : null;
  const parallel = Math.max(
    1,
    Math.min(urlValues.length, parseIntOption(task.command, "--concurrency", settings.concurrency)),
  );
  task.addLog(`[doubao] total threads: ${urlValues.length}, parallel: ${parallel}`);

  await runWithConcurrency(urlValues, parallel, async (threadUrl, threadIndex) => {
    task.addLog(`[doubao] (${threadIndex + 1}/${urlValues.length}) parsing thread: ${threadUrl}`);
    const parsed = await parseDoubaoThread(threadUrl, cookieValue);
    const imageItems = parsed.image_items;
    task.addLog(`[doubao] (${threadIndex + 1}/${urlValues.length}) parsed ${imageItems.length} image item(s).`);

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}.${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
    const author = trimFilenamePart(sanitizeFilename(parsed.author || "doubao"), 24);
    const title = trimFilenamePart(sanitizeFilename(parsed.title || parsed.thread_id || "doubao_thread"), 42);
    const threadToken = trimFilenamePart(
      sanitizeFilename(parsed.thread_id || `thread_${threadIndex + 1}`),
      20,
    );
    const prefix = sanitizeFilename(`${timestamp}_${author}_${title}_${threadToken}`);

    for (let i = 0; i < imageItems.length; i += 1) {
      const item = imageItems[i];
      const candidates = Array.isArray(item.urls) ? item.urls : [];
      if (!candidates.length) throw new Error(`Doubao image #${i + 1} has no downloadable URL.`);
      let downloaded = false;
      let lastError = null;
      for (const candidateUrl of candidates) {
        const ext = guessImageExtension(candidateUrl);
        const fileName = `${prefix}_${i + 1}${ext}`;
        const filePath = path.join(targetRoot, fileName);
        try {
          await downloadBinaryFile(candidateUrl, filePath, parsed.source_url, extraHeaders);
          task.addLog(
            `[doubao] (${threadIndex + 1}/${urlValues.length}) image ${i + 1}/${imageItems.length}: ${fileName}`,
          );
          downloaded = true;
          break;
        } catch (err) {
          lastError = err;
          try { await fsp.unlink(filePath); } catch {}
        }
      }
      if (!downloaded) throw new Error(`Doubao image #${i + 1} download failed: ${lastError}`);
    }

    const metaLines = [];
    if (parsed.title) metaLines.push(String(parsed.title));
    if (parsed.thread_id) metaLines.push(`Thread ID: ${parsed.thread_id}`);
    if (parsed.author) metaLines.push(`Author: ${parsed.author}`);
    if (parsed.prompt_text) metaLines.push(`Prompt:\n${compactTextForMeta(parsed.prompt_text)}`);
    if (parsed.reply_text) metaLines.push(`Reply:\n${compactTextForMeta(parsed.reply_text)}`);
    metaLines.push(`Original URL: ${threadUrl}`);
    metaLines.push(`Final URL: ${parsed.source_url}`);
    const metaPath = path.join(targetRoot, `${prefix}.txt`);
    await fsp.writeFile(metaPath, `${metaLines.join("\n\n").trim()}\n`, "utf8");
    task.addLog(`[doubao] (${threadIndex + 1}/${urlValues.length}) metadata saved: ${path.basename(metaPath)}`);
  });
}

async function generateXhsPreview(payload, normalizedUrl) {
  let urlValues = extractUrls(normalizedUrl).filter((url) => isXhsUrl(url));
  if (!urlValues.length) throw new Error("未找到有效的小红书链接。");

  const settings = getSettings();
  const cookieValue = normalizeText(payload.xhsCookie || payload.cookie || settings.xhsCookie || settings.cookie);
  const userAgent = normalizeText(payload.userAgent || payload.user_agent || settings.userAgent);
  const profileUrls = urlValues.filter((url) => isXhsProfileUrl(url));
  const noteUrls = urlValues.filter((url) => isXhsUrl(url) && !isXhsProfileUrl(url));

  if (profileUrls.length) {
    const command = [XHS_RUNNER];
    if (cookieValue) command.push("--cookie", cookieValue);
    const expanded = await expandXhsProfileUrls(profileUrls, command, { addLog() {} });
    urlValues = uniqueItems([...noteUrls, ...(expanded.mergedNoteUrls || [])]);
    if (!urlValues.length) {
      if (expanded.blockedProfiles && expanded.blockedProfiles.length) {
        throw new Error(`XHS 主页当前不可浏览（${expanded.blockedProfiles[0].reason || "未知原因"}）`);
      }
      throw new Error("未从小红书主页提取到可生成的图片。");
    }
  }

  await preflightXhsNoteAccess(urlValues[0], cookieValue, { addLog() {} });
  const headers = {};
  if (cookieValue) headers.Cookie = cookieValue;
  if (userAgent) headers["User-Agent"] = userAgent;

  const items = [];
  const textBlocks = [];
  for (let noteIndex = 0; noteIndex < urlValues.length; noteIndex += 1) {
    const noteUrl = urlValues[noteIndex];
    const parsed = await parseXhsNote(noteUrl, cookieValue, userAgent);
    const textBlock = buildPreviewText(parsed.title, parsed.description);
    if (textBlock) textBlocks.push(textBlock);
    const baseName = sanitizeFilename(
      `${trimFilenamePart(parsed.author || "小红书", 24)}_${trimFilenamePart(parsed.title || parsed.note_id || `note_${noteIndex + 1}`, 42)}`,
    );
    for (let i = 0; i < parsed.image_urls.length; i += 1) {
      const imageUrl = parsed.image_urls[i];
      items.push(
        buildGeneratedPreviewItem(imageUrl, {
          platform: "xhs",
          fileName: `${baseName}_${i + 1}${guessImageExtension(imageUrl)}`,
          referer: parsed.source_url,
          headers,
          index: i + 1,
        }),
      );
    }
  }

  return {
    platform: "xhs",
    text: uniqueItems(textBlocks).join("\n\n\n"),
    items,
  };
}

async function generateDianpingPreview(normalizedUrl) {
  const parsed = await parseDianpingFeed(normalizedUrl);
  const textBlock = buildPreviewText(parsed.title, parsed.description);
  const baseName = sanitizeFilename(
    `${trimFilenamePart(parsed.author || "大众点评", 24)}_${trimFilenamePart(parsed.title || parsed.feed_id || "点评笔记", 42)}`,
  );
  const items = parsed.image_urls.map((imageUrl, index) =>
    buildGeneratedPreviewItem(imageUrl, {
      platform: "dianping",
      fileName: `${baseName}_${index + 1}${guessImageExtension(imageUrl)}`,
      referer: parsed.source_url,
      index: index + 1,
    }),
  );
  return {
    platform: "dianping",
    text: textBlock,
    items,
  };
}

async function generateDoubaoPreview(payload, normalizedUrl) {
  const settings = getSettings();
  const cookieValue = normalizeText(payload.doubaoCookie || settings.doubaoCookie);
  const threadUrls = extractUrls(normalizedUrl).filter((url) => isDoubaoThreadUrl(url));
  if (!threadUrls.length) throw new Error("未找到有效的豆包线程链接。");

  const headers = {};
  if (cookieValue) headers.Cookie = cookieValue;

  const items = [];
  const textBlocks = [];
  for (let threadIndex = 0; threadIndex < threadUrls.length; threadIndex += 1) {
    const threadUrl = threadUrls[threadIndex];
    const parsed = await parseDoubaoThread(threadUrl, cookieValue);
    const textBlock = buildPreviewText(parsed.title, parsed.prompt_text, parsed.reply_text);
    if (textBlock) textBlocks.push(textBlock);
    const baseName = sanitizeFilename(
      `${trimFilenamePart(parsed.author || "豆包", 24)}_${trimFilenamePart(parsed.title || parsed.thread_id || `thread_${threadIndex + 1}`, 42)}`,
    );
    let imageIndex = 0;
    for (const imageItem of parsed.image_items) {
      const imageUrl = Array.isArray(imageItem.urls) ? imageItem.urls.find((url) => !!normalizeEmbeddedUrl(url)) : "";
      const normalizedImageUrl = normalizeEmbeddedUrl(imageUrl);
      if (!normalizedImageUrl) continue;
      imageIndex += 1;
      items.push(
        buildGeneratedPreviewItem(normalizedImageUrl, {
          platform: "doubao",
          fileName: `${baseName}_${imageIndex}${guessImageExtension(normalizedImageUrl)}`,
          referer: parsed.source_url,
          headers,
          index: imageIndex,
        }),
      );
    }
  }

  return {
    platform: "doubao",
    text: uniqueItems(textBlocks).join("\n\n\n"),
    items,
  };
}

async function generateXianyuPreview(normalizedUrl) {
  const inputUrls = extractUrls(normalizedUrl).filter((url) => isXianyuItemUrl(url) || isTbShortUrl(url));
  if (!inputUrls.length) throw new Error("未找到有效的闲鱼商品链接。");

  const items = [];
  const textBlocks = [];
  for (let itemIndex = 0; itemIndex < inputUrls.length; itemIndex += 1) {
    const inputUrl = inputUrls[itemIndex];
    const itemUrl = isTbShortUrl(inputUrl) ? await resolveTbShortUrl(inputUrl) : inputUrl;
    const parsed = await parseXianyuItem(itemUrl);
    const textBlock = buildPreviewText(parsed.title, parsed.description);
    if (textBlock) textBlocks.push(textBlock);
    const baseName = sanitizeFilename(
      `${trimFilenamePart(parsed.seller || "闲鱼", 24)}_${trimFilenamePart(parsed.title || parsed.item_id || `item_${itemIndex + 1}`, 42)}`,
    );
    for (let i = 0; i < parsed.image_urls.length; i += 1) {
      const imageUrl = parsed.image_urls[i];
      items.push(
        buildGeneratedPreviewItem(imageUrl, {
          platform: "xianyu",
          fileName: `${baseName}_${i + 1}${guessImageExtension(imageUrl)}`,
          referer: parsed.source_url,
          index: i + 1,
        }),
      );
    }
  }

  return {
    platform: "xianyu",
    text: uniqueItems(textBlocks).join("\n\n\n"),
    items,
  };
}

async function generatePreviewPayload(payload) {
  const resolved = await resolvePayloadUrl(String(payload.url || ""));
  if (!normalizeText(resolved.normalizedUrl)) {
    throw new Error("请先提供有效链接。");
  }

  if (resolved.mode === "dianping") return generateDianpingPreview(resolved.normalizedUrl);
  if (resolved.mode === "doubao") return generateDoubaoPreview(payload, resolved.normalizedUrl);
  if (resolved.mode === "xianyu") return generateXianyuPreview(resolved.normalizedUrl);
  return generateXhsPreview(payload, resolved.normalizedUrl);
}

function decodeProcessChunk(buffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const utf8Bad = (utf8.match(/\uFFFD/g) || []).length;
  if (utf8Bad === 0) return utf8;
  try {
    const gb = new TextDecoder("gb18030").decode(buffer);
    const gbBad = (gb.match(/\uFFFD/g) || []).length;
    return gbBad < utf8Bad ? gb : utf8;
  } catch {
    return utf8;
  }
}

function detectPlatformFromCommand(command) {
  switch (command[0]) {
    case XHS_RUNNER:
      return "xhs";
    case DIANPING_RUNNER:
      return "dianping";
    case DOUBAO_RUNNER:
      return "doubao";
    case XIANYU_RUNNER:
      return "xianyu";
    default:
      return "unknown";
  }
}

function inferResultType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "meta";
}

class FileRegistry {
  constructor() {
    this.byId = new Map();
    this.byPath = new Map();
  }

  register(filePath) {
    const absolutePath = path.resolve(String(filePath));
    if (this.byPath.has(absolutePath)) return this.byPath.get(absolutePath);
    const fileId = crypto.createHash("sha1").update(absolutePath).digest("hex").slice(0, 20);
    const record = { id: fileId, absolutePath };
    this.byPath.set(absolutePath, record);
    this.byId.set(fileId, record);
    return record;
  }

  get(fileId) {
    return this.byId.get(String(fileId || "")) || null;
  }
}

const FILES = new FileRegistry();

class RemoteAssetRegistry {
  constructor() {
    this.byId = new Map();
    this.byKey = new Map();
  }

  prune(maxAgeSeconds = 60 * 60 * 6, maxEntries = 1200) {
    const cutoff = nowTs() - maxAgeSeconds;
    for (const [id, entry] of this.byId.entries()) {
      if ((entry.createdAt || 0) < cutoff) {
        this.byId.delete(id);
        this.byKey.delete(entry.key);
      }
    }
    if (this.byId.size <= maxEntries) return;
    const entries = [...this.byId.values()].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    const overflow = entries.slice(0, Math.max(0, entries.length - maxEntries));
    for (const entry of overflow) {
      this.byId.delete(entry.id);
      this.byKey.delete(entry.key);
    }
  }

  register(asset) {
    this.prune();
    const normalizedHeaders = asset.headers && typeof asset.headers === "object" ? asset.headers : {};
    const key = JSON.stringify([
      asset.sourceUrl,
      asset.fileName,
      asset.referer || "",
      Object.entries(normalizedHeaders).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ]);
    if (this.byKey.has(key)) return this.byKey.get(key);
    const id = crypto.randomBytes(10).toString("hex");
    const record = {
      id,
      key,
      sourceUrl: String(asset.sourceUrl || ""),
      fileName: String(asset.fileName || "image.jpg"),
      referer: String(asset.referer || ""),
      headers: normalizedHeaders,
      createdAt: nowTs(),
    };
    this.byId.set(id, record);
    this.byKey.set(key, record);
    return record;
  }

  get(assetId) {
    this.prune();
    return this.byId.get(String(assetId || "")) || null;
  }
}

const GENERATED_ASSETS = new RemoteAssetRegistry();

async function walkFiles(rootPath, limit = 400) {
  const root = path.resolve(String(rootPath || ""));
  const stack = [root];
  const results = [];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      results.push(absolutePath);
    }
  }

  const enriched = [];
  for (const filePath of results) {
    try {
      const stat = await fsp.stat(filePath);
      enriched.push({ filePath, mtime: stat.mtimeMs / 1000 });
    } catch {
      // ignore volatile files
    }
  }
  enriched.sort((left, right) => right.mtime - left.mtime);
  return enriched.slice(0, limit).map((item) => item.filePath);
}

async function buildRegisteredResult(filePath, platform = "unknown") {
  const absolutePath = path.resolve(String(filePath));
  const stat = await fsp.stat(absolutePath);
  const type = inferResultType(absolutePath);
  const record = FILES.register(absolutePath);
  return {
    fileId: record.id,
    name: path.basename(absolutePath),
    type,
    platform,
    size: stat.size,
    mtime: stat.mtimeMs / 1000,
    isPreviewable: type === "image" || type === "video",
    mediaUrl: `/api/media/${record.id}`,
    downloadUrl: `/api/download/${record.id}`,
    previewUrl: type === "image" ? `/preview/${record.id}` : "",
  };
}

function buildGeneratedPreviewItem(sourceUrl, options = {}) {
  const headers = options.headers && typeof options.headers === "object" ? options.headers : {};
  const ext = guessImageExtension(sourceUrl);
  const fileName = options.fileName || `image_${String(options.index || 1).padStart(2, "0")}${ext}`;
  const record = GENERATED_ASSETS.register({
    sourceUrl,
    fileName,
    referer: options.referer || "",
    headers,
  });
  return {
    fileId: record.id,
    name: record.fileName,
    type: "image",
    platform: options.platform || "unknown",
    size: 0,
    mtime: nowTs(),
    isPreviewable: true,
    mediaUrl: `/api/generated/media/${record.id}`,
    downloadUrl: `/api/generated/download/${record.id}`,
    previewUrl: "",
  };
}

function buildPreviewText(...parts) {
  return uniqueItems(parts.map((item) => normalizeText(item)).filter(Boolean)).join("\n\n").trim();
}

async function sendRemoteAssetResponse(res, asset, disposition = "inline") {
  const headers = {
    "User-Agent": DIANPING_UA,
  };
  if (asset.referer) headers.Referer = asset.referer;
  if (asset.headers && typeof asset.headers === "object") {
    for (const [key, value] of Object.entries(asset.headers)) {
      if (value) headers[String(key)] = String(value);
    }
  }

  const response = await fetch(asset.sourceUrl, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`Remote asset HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.statusCode = 200;
  res.setHeader("Content-Type", response.headers.get("content-type") || contentTypeForFile(asset.fileName));
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
  );
  if (disposition === "inline") {
    res.setHeader("Cache-Control", "private, max-age=1800");
  }
  res.end(buffer);
}

function buildTaskSummary(task) {
  const results = Array.isArray(task.results) ? task.results : [];
  const logs = Array.isArray(task.logs) ? task.logs : [];
  const summary = {
    totalFiles: results.length,
    imageCount: results.filter((item) => item.type === "image").length,
    videoCount: results.filter((item) => item.type === "video").length,
    metaCount: results.filter((item) => item.type === "meta").length,
    latestLog: logs.length ? logs[logs.length - 1] : "",
  };
  return summary;
}

async function finalizeTaskResults(task) {
  if (!task.downloadDir) {
    task.results = [];
    task.summary = buildTaskSummary(task);
    return;
  }
  const files = await walkFiles(task.downloadDir, 500);
  const results = [];
  for (const filePath of files) {
    try {
      results.push(await buildRegisteredResult(filePath, task.platform));
    } catch {
      // ignore files disappearing during refresh
    }
  }
  task.results = results;
  task.summary = buildTaskSummary(task);
}

class Task {
  constructor(taskId, command) {
    this.id = taskId;
    this.task_id = taskId;
    this.command = command;
    this.platform = detectPlatformFromCommand(command);
    this.status = "queued";
    this.createdAt = nowTs();
    this.created_at = this.createdAt;
    this.startedAt = null;
    this.started_at = null;
    this.finishedAt = null;
    this.finished_at = null;
    this.returnCode = null;
    this.return_code = null;
    this.logs = [];
    this.downloadDir = null;
    this.download_dir = null;
    this.summary = buildTaskSummary(this);
    this.results = [];
  }

  addLog(line) {
    const text = String(line || "").replace(/[\r\n]+$/g, "");
    this.logs.push(text);
    if (this.logs.length > DEFAULT_MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - DEFAULT_MAX_LOG_LINES);
    }
  }

  toDict() {
    return {
      id: this.id,
      task_id: this.task_id,
      command: this.command,
      safe_command: safeCommand(this.command),
      platform: this.platform,
      status: this.status,
      createdAt: this.createdAt,
      created_at: this.created_at,
      startedAt: this.startedAt,
      started_at: this.started_at,
      finishedAt: this.finishedAt,
      finished_at: this.finished_at,
      returnCode: this.returnCode,
      return_code: this.return_code,
      logs: this.logs,
      downloadDir: this.downloadDir,
      download_dir: this.download_dir,
      summary: this.summary,
      results: this.results,
    };
  }
}

function safeCommand(command) {
  const cleaned = [...command];
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    if (cleaned[i] === "--cookie") cleaned[i + 1] = maskCookie(cleaned[i + 1]) || "";
  }
  return cleaned;
}

function isCliCompatCommand(command) {
  return false;
}

function buildCliTempNamespace(taskId, index) {
  const safeTask = String(taskId || "task").replace(/[^0-9a-z_-]+/gi, "").slice(0, 24) || "task";
  const safeIndex = Number.isInteger(index) && index >= 0 ? String(index + 1) : "0";
  const token = crypto.randomBytes(3).toString("hex");
  return `${safeTask}_${safeIndex}_${token}`;
}

async function runExternalCommand(command, task, logPrefix = "", envOverride = null) {
  const env = envOverride ? { ...process.env, ...envOverride } : process.env;
  const isCliCompat = isCliCompatCommand(command);
  let cliSummary = null;
  let cliDataFail = 0;
  const inspectCliLine = (line) => {
    if (!isCliCompat) return;
    const text = String(line || "");
    const summaryMatch = CLI_SUMMARY_PATTERN.exec(text);
    if (summaryMatch) {
      cliSummary = {
        total: Number(summaryMatch[1]) || 0,
        success: Number(summaryMatch[2]) || 0,
        fail: Number(summaryMatch[3]) || 0,
        skip: Number(summaryMatch[4]) || 0,
      };
    }
    if (text.includes("获取数据失败")) cliDataFail += 1;
  };
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], command.slice(1), {
        cwd: ROOT_DIR,
        windowsHide: true,
        env,
      });
    } catch (err) {
      task.addLog(`${logPrefix}[launcher-error] ${err.message || err}`);
      resolve(-1);
      return;
    }

    let pending = "";
    const handleData = (chunk) => {
      const text = decodeProcessChunk(chunk);
      pending += text;
      while (true) {
        const idx = pending.indexOf("\n");
        if (idx < 0) break;
        const line = pending.slice(0, idx).replace(/\r$/, "");
        pending = pending.slice(idx + 1);
        inspectCliLine(line);
        task.addLog(`${logPrefix}${line}`);
      }
    };

    if (child.stdout) child.stdout.on("data", handleData);
    if (child.stderr) child.stderr.on("data", handleData);
    child.on("error", (err) => {
      task.addLog(`${logPrefix}[launcher-error] ${err.message || err}`);
    });
    child.on("close", (code) => {
      if (pending) {
        const tailLine = pending.replace(/\r$/, "");
        inspectCliLine(tailLine);
        task.addLog(`${logPrefix}${tailLine}`);
      }
      let finalCode = code === null ? -1 : code;
      if (isCliCompat && finalCode === 0) {
        if (cliSummary && cliSummary.fail > 0) {
          finalCode = 2;
          task.addLog(
            `${logPrefix}[cli-wrapper] detected note failures: success=${cliSummary.success}, fail=${cliSummary.fail}, skip=${cliSummary.skip}.`,
          );
        } else if (!cliSummary && cliDataFail > 0) {
          finalCode = 2;
          task.addLog(`${logPrefix}[cli-wrapper] detected note extraction failures.`);
        }
      }
      resolve(finalCode);
    });
  });
}

class TaskStore {
  constructor() {
    this.tasks = new Map();
  }

  create(command) {
    const task = new Task(crypto.randomBytes(6).toString("hex"), command);
    this.tasks.set(task.task_id, task);
    return task;
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  listRecent(limit = 20) {
    return [...this.tasks.values()].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  }
}

const TASKS = new TaskStore();
async function runTask(task) {
  task.status = "running";
  task.startedAt = nowTs();
  task.started_at = task.startedAt;
  task.downloadDir = resolveDownloadDirFromCommand(task.command);
  task.download_dir = task.downloadDir;

  try {
    if (task.command[0] === XHS_RUNNER) {
      await runXhsDownload(task);
    } else if (task.command[0] === DIANPING_RUNNER) {
      await runDianpingDownload(task);
    } else if (task.command[0] === DOUBAO_RUNNER) {
      await runDoubaoDownload(task);
    } else if (task.command[0] === XIANYU_RUNNER) {
      await runXianyuDownload(task);
    } else {
      throw new Error(`Unsupported runner: ${task.command[0]}`);
    }
    task.returnCode = 0;
    task.return_code = 0;
    task.status = "done";
  } catch (err) {
    task.returnCode = 1;
    task.return_code = 1;
    task.status = "failed";
    task.addLog(`[task-error] ${String(err.message || err)}`);
  } finally {
    task.finishedAt = nowTs();
    task.finished_at = task.finishedAt;
    await finalizeTaskResults(task);
  }
}

function isSubpath(filePath, rootPath) {
  const rel = path.relative(rootPath, filePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function getAllowedDownloadRoots() {
  const settings = getSettings();
  const workPath = String(settings.work_path || DOWNLOADS_DIR);
  const baseFolderName = String(settings.folder_name || DEFAULT_SETTINGS.folderName);
  const modeDirs = getSourceDownloadDirs(workPath, baseFolderName);
  const baseDir = path.join(workPath, stripSourceFolderSuffix(baseFolderName));
  const legacyDirs = getLegacySourceDownloadDirs(workPath, baseFolderName);
  const roots = [baseDir, path.join(ROOT_DIR, "Download")];
  for (const mode of SOURCE_FOLDER_MODES) {
    if (modeDirs[mode]) roots.push(modeDirs[mode]);
  }
  for (const mode of SOURCE_FOLDER_MODES) {
    roots.push(...(legacyDirs[mode] || []));
  }
  const resolved = [];
  const seen = new Set();
  for (const root of roots) {
    const token = path.resolve(root);
    if (seen.has(token)) continue;
    seen.add(token);
    resolved.push(token);
  }
  return resolved;
}

async function listRegisteredFiles(sourceMode = null, limit = 200) {
  const roots = sourceMode ? [getSourceDownloadDirByMode(sourceMode)] : getAllowedDownloadRoots();
  const candidates = [];
  for (const rootPath of roots) {
    const files = await walkFiles(rootPath, limit);
    for (const filePath of files) {
      try {
        const stat = await fsp.stat(filePath);
        candidates.push({ filePath, mtime: stat.mtimeMs / 1000 });
      } catch {
        // ignore volatile files
      }
    }
  }

  candidates.sort((left, right) => right.mtime - left.mtime);
  const results = [];
  const seen = new Set();
  for (const item of candidates) {
    const absolutePath = path.resolve(item.filePath);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    try {
      results.push(await buildRegisteredResult(absolutePath, sourceMode || "unknown"));
    } catch {
      // ignore files disappearing during refresh
    }
    if (results.length >= limit) break;
  }
  return results;
}

async function findRegisteredFile(fileId) {
  const existing = FILES.get(fileId);
  if (existing) return existing;

  const targetId = String(fileId || "");
  for (const rootPath of getAllowedDownloadRoots()) {
    const files = await walkFiles(rootPath, 600);
    for (const filePath of files) {
      const record = FILES.register(filePath);
      if (record.id === targetId) return record;
    }
  }
  return null;
}

async function validateDownloadFile(fileId) {
  if (!fileId) throw new Error("fileId is required.");
  const record = await findRegisteredFile(fileId);
  if (!record) throw new Error("File does not exist.");
  const filePath = path.resolve(record.absolutePath);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw new Error("File does not exist.");
  }
  if (!stat.isFile()) throw new Error("File does not exist.");
  const allowedRoots = getAllowedDownloadRoots();
  if (!allowedRoots.some((root) => isSubpath(filePath, root))) {
    throw new Error("File path is outside allowed download directories.");
  }
  return filePath;
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function sendJson(res, payload, statusCode = 200) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(body.length));
  res.end(body);
}

function getMaskedSettings(settings) {
  return {
    ...settings,
    xhsCookie: maskCookie(settings.xhsCookie),
    doubaoCookie: maskCookie(settings.doubaoCookie),
    cookie: maskCookie(settings.cookie),
  };
}

function pickConfigUpdates(raw) {
  if (!raw || typeof raw !== "object") return null;
  const next = {};
  const allowedKeys = [
    "workPath",
    "folderName",
    "timeout",
    "maxRetry",
    "concurrency",
    "downloadImages",
    "downloadVideos",
    "folderMode",
    "proxy",
    "userAgent",
    "xhsCookie",
    "doubaoCookie",
  ];
  for (const key of allowedKeys) {
    if (raw[key] !== undefined) next[key] = raw[key];
  }
  if (raw.work_path !== undefined) next.workPath = raw.work_path;
  if (raw.folder_name !== undefined) next.folderName = raw.folder_name;
  if (raw.max_retry !== undefined) next.maxRetry = raw.max_retry;
  if (raw.user_agent !== undefined) next.userAgent = raw.user_agent;
  if (raw.cookie !== undefined) next.xhsCookie = raw.cookie;
  if (raw.image_download !== undefined) next.downloadImages = raw.image_download;
  if (raw.video_download !== undefined) next.downloadVideos = raw.video_download;
  if (raw.folder_mode !== undefined) next.folderMode = raw.folder_mode;
  return Object.keys(next).length ? next : null;
}

async function sendFileResponse(res, filePath, disposition = "inline") {
  const stat = await fsp.stat(filePath);
  const fileName = path.basename(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeForFile(filePath));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  if (disposition === "inline") {
    res.setHeader("Cache-Control", "private, max-age=3600");
  }
  fs.createReadStream(filePath).pipe(res);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderPreviewPage(fileId, fileName) {
  const safeTitle = escapeHtml(fileName || "图片预览");
  const mediaUrl = `/api/media/${encodeURIComponent(fileId)}`;
  const downloadUrl = `/api/download/${encodeURIComponent(fileId)}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      color: #f6f3ea;
      background:
        radial-gradient(circle at top, rgba(208,155,84,0.18), transparent 24%),
        linear-gradient(180deg, #1c3424 0%, #132419 100%);
    }
    .frame {
      width: min(960px, 100%);
      display: grid;
      gap: 14px;
    }
    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
    }
    .meta strong { display: block; font-size: 15px; }
    .meta span { display: block; font-size: 12px; color: rgba(246,243,234,0.72); margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 16px;
      border-radius: 999px;
      color: #f6f3ea;
      text-decoration: none;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
    }
    .button.primary {
      border-color: rgba(208,155,84,0.52);
      background: rgba(208,155,84,0.14);
      color: #ffe6c0;
    }
    .image-box {
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.18);
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      -webkit-touch-callout: default;
      -webkit-user-select: auto;
      user-select: auto;
      pointer-events: auto;
    }
    @media (max-width: 640px) {
      body { padding: 12px; }
      .meta { flex-direction: column; align-items: flex-start; }
      .actions { width: 100%; }
      .button { flex: 1 1 0; }
    }
  </style>
</head>
<body>
  <main class="frame">
    <div class="meta">
      <div>
        <strong>${safeTitle}</strong>
        <span>微信内可直接长按图片保存到本地。</span>
      </div>
      <div class="actions">
        <a class="button" href="/">返回工具</a>
        <a class="button primary" href="${downloadUrl}">下载原图</a>
      </div>
    </div>
    <div class="image-box">
      <img src="${mediaUrl}" alt="${safeTitle}" />
    </div>
  </main>
</body>
</html>`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Type,Content-Disposition");
}

function parseArgs(argv) {
  const out = { host: "0.0.0.0", port: 1027, noOpen: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--host" && i + 1 < argv.length) {
      out.host = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--port" && i + 1 < argv.length) {
      out.port = parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (token === "--no-open") out.noOpen = true;
  }
  return out;
}

function openBrowser(urlText) {
  if (process.platform !== "win32") return;
  try {
    const child = spawn("cmd", ["/c", "start", "", urlText], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // ignore
  }
}

function trySpawnDetached(command, args) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function openFolderWindow(folderPath) {
  if (process.platform !== "win32") {
    throw new Error("Open folder is only supported on Windows host.");
  }
  const quotedForPs = String(folderPath).replace(/'/g, "''");
  const attempts = [
    () => trySpawnDetached("cmd.exe", ["/c", "start", "", folderPath]),
    () => trySpawnDetached("explorer.exe", [folderPath]),
    () =>
      trySpawnDetached("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Start-Process explorer.exe -ArgumentList '${quotedForPs}'`,
      ]),
  ];
  for (const run of attempts) {
    if (run()) return;
  }
  throw new Error("Failed to open folder window on host.");
}

function scheduleHostSleep(delaySeconds = 3) {
  if (process.platform !== "win32") {
    throw new Error("Sleep is only supported on Windows host.");
  }
  const delayMs = Math.max(0, Math.min(30, Number(delaySeconds) || 0)) * 1000;
  setTimeout(() => {
    const attempts = [
      () =>
        trySpawnDetached("powershell.exe", [
          "-NoProfile",
          "-WindowStyle",
          "Hidden",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)",
        ]),
      () => trySpawnDetached("cmd.exe", ["/c", "rundll32.exe powrprof.dll,SetSuspendState 0,1,0"]),
    ];
    for (const run of attempts) {
      if (run()) return;
    }
  }, delayMs);
  return delayMs / 1000;
}

async function serveStaticFile(req, res, pathname) {
  let targetPath = pathname === "/" ? "/index.html" : pathname;
  try {
    targetPath = decodeURIComponent(targetPath);
  } catch {
    sendJson(res, { ok: false, error: "Bad path." }, 400);
    return;
  }
  let absPath = path.resolve(path.join(DIST_DIR, targetPath.replace(/^\/+/, "")));
  if (!isSubpath(absPath, DIST_DIR)) {
    sendJson(res, { ok: false, error: "Forbidden." }, 403);
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    if (path.extname(targetPath)) {
      sendJson(res, { ok: false, error: "File not found." }, 404);
      return;
    }
    absPath = path.join(DIST_DIR, "index.html");
    try {
      stat = await fsp.stat(absPath);
    } catch {
      sendJson(res, { ok: false, error: "Build output not found. Run npm run build first." }, 404);
      return;
    }
  }
  if (!stat.isFile()) {
    sendJson(res, { ok: false, error: "File not found." }, 404);
    return;
  }

  res.statusCode = 200;
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  res.setHeader("Content-Type", contentTypeForFile(absPath));
  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(absPath).pipe(res);
}

async function handleGet(req, res, urlObj) {
  const pathname = urlObj.pathname;

  if (pathname === "/api/runtime") {
    sendJson(res, {
      ok: true,
      runtime: {
        backend: "node",
        supports: { xhs: true, dianping: true, doubao: true, xianyu: true },
        startedAt: PROCESS_STARTED_AT,
        started_at: PROCESS_STARTED_AT,
        pid: process.pid,
      },
    });
    return;
  }

  if (pathname === "/api/config") {
    const settings = getSettings();
    sendJson(res, {
      ok: true,
      config: settings,
      configSafe: getMaskedSettings(settings),
      config_safe: getMaskedSettings(settings),
    });
    return;
  }

  if (pathname === "/api/tasks") {
    sendJson(res, { ok: true, tasks: TASKS.listRecent(30).map((x) => x.toDict()) });
    return;
  }

  if (pathname.startsWith("/api/tasks/")) {
    const taskId = pathname.split("/").pop();
    const task = TASKS.get(taskId);
    if (!task) {
      sendJson(res, { ok: false, error: "Task not found." }, 404);
      return;
    }
    sendJson(res, { ok: true, task: task.toDict() });
    return;
  }

  if (pathname === "/api/files") {
    const sourceMode = normalizeSourceMode(urlObj.searchParams.get("sourceMode"));
    const limit = Math.max(1, Math.min(400, Number(urlObj.searchParams.get("limit")) || 120));
    const entries = await listRegisteredFiles(sourceMode, limit);
    sendJson(res, { ok: true, sourceMode, entries });
    return;
  }

  if (pathname.startsWith("/api/generated/media/")) {
    const assetId = pathname.split("/").pop();
    const asset = GENERATED_ASSETS.get(assetId);
    if (!asset) {
      sendJson(res, { ok: false, error: "Generated asset does not exist." }, 404);
      return;
    }
    try {
      await sendRemoteAssetResponse(res, asset, "inline");
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 502);
    }
    return;
  }

  if (pathname.startsWith("/api/generated/download/")) {
    const assetId = pathname.split("/").pop();
    const asset = GENERATED_ASSETS.get(assetId);
    if (!asset) {
      sendJson(res, { ok: false, error: "Generated asset does not exist." }, 404);
      return;
    }
    try {
      await sendRemoteAssetResponse(res, asset, "attachment");
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 502);
    }
    return;
  }

  if (pathname.startsWith("/api/media/")) {
    const fileId = pathname.split("/").pop();
    let filePath;
    try {
      filePath = await validateDownloadFile(fileId);
    } catch (err) {
      const msg = String(err.message || err);
      const code = msg.includes("outside") ? 403 : msg.includes("does not exist") ? 404 : 400;
      sendJson(res, { ok: false, error: msg }, code);
      return;
    }
    await sendFileResponse(res, filePath, "inline");
    return;
  }

  if (pathname.startsWith("/api/download/")) {
    const fileId = pathname.split("/").pop();
    let filePath;
    try {
      filePath = await validateDownloadFile(fileId);
    } catch (err) {
      const msg = String(err.message || err);
      const code = msg.includes("outside") ? 403 : msg.includes("does not exist") ? 404 : 400;
      sendJson(res, { ok: false, error: msg }, code);
      return;
    }
    await sendFileResponse(res, filePath, "attachment");
    return;
  }

  if (pathname.startsWith("/preview/")) {
    const fileId = pathname.split("/").pop();
    let filePath;
    try {
      filePath = await validateDownloadFile(fileId);
    } catch (err) {
      const msg = String(err.message || err);
      const code = msg.includes("outside") ? 403 : msg.includes("does not exist") ? 404 : 400;
      sendJson(res, { ok: false, error: msg }, code);
      return;
    }
    if (inferResultType(filePath) !== "image") {
      sendJson(res, { ok: false, error: "Preview only supports image files." }, 400);
      return;
    }
    const body = Buffer.from(renderPreviewPage(fileId, path.basename(filePath)), "utf8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
    return;
  }

  await serveStaticFile(req, res, pathname);
}

async function handlePost(req, res, urlObj) {
  const pathname = urlObj.pathname;
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, { ok: false, error: "Invalid JSON body." }, 400);
    return;
  }

  if (pathname === "/api/run") {
    try {
      const resolved = await resolvePayloadUrl(String(payload.url || ""));
      const sourceModeHint = normalizeSourceMode(payload.source_mode_hint);
      const mode = resolved.mode;
      const normalizedUrl = resolved.normalizedUrl;

      if (sourceModeHint === "xianyu" && mode !== "xianyu") {
        throw new Error("检测到闲鱼链接，但后端未按闲鱼分支处理。请重启 run-webui.bat 或检查链接格式。");
      }

      let command;
      if (mode === "dianping") command = buildDianpingCommand(payload, normalizedUrl);
      else if (mode === "doubao") command = buildDoubaoCommand(payload, normalizedUrl);
      else if (mode === "xianyu") command = buildXianyuCommand(payload, normalizedUrl);
      else command = buildCliCommand(payload, normalizedUrl, mode);

      const task = TASKS.create(command);
      runTask(task).catch((err) => {
        task.addLog(`[internal-error] ${err.message || err}`);
        task.status = "failed";
        task.returnCode = -1;
        task.return_code = -1;
        task.finishedAt = nowTs();
        task.finished_at = task.finishedAt;
      });
      sendJson(res, {
        ok: true,
        taskId: task.task_id,
        task_id: task.task_id,
        platform: task.platform,
        safeCommand: safeCommand(command),
        safe_command: safeCommand(command),
      });
      return;
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 400);
      return;
    }
  }

  if (pathname === "/api/generate") {
    try {
      const generated = await generatePreviewPayload(payload);
      sendJson(res, {
        ok: true,
        platform: generated.platform,
        text: generated.text || "",
        items: Array.isArray(generated.items) ? generated.items : [],
      });
      return;
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 400);
      return;
    }
  }

  if (pathname === "/api/config") {
    const updates = pickConfigUpdates(
      payload && typeof payload.config === "object" ? payload.config : payload,
    );
    if (!updates) {
      sendJson(res, { ok: false, error: "config must be an object." }, 400);
      return;
    }
    const settings = updateSettings(updates);
    try { syncRuntimeSettingsFile(); } catch {}
    sendJson(res, { ok: true, config: settings, configSafe: getMaskedSettings(settings) });
    return;
  }

  if (pathname === "/api/open-dir") {
    const mode = normalizeSourceMode(payload.source_mode);
    let target = payload.path;
    if (mode) {
      target = getSourceDownloadDirByMode(mode);
    }
    if (!target) {
      target = getDefaultDownloadDir();
    }

    const targetPath = path.resolve(String(target));
    try {
      await fsp.mkdir(targetPath, { recursive: true });
      const st = await fsp.stat(targetPath);
      if (!st.isDirectory()) throw new Error("Path does not exist.");
    } catch {
      sendJson(res, { ok: false, error: "Path does not exist." }, 404);
      return;
    }
    try {
      openFolderWindow(targetPath);
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 500);
      return;
    }
    sendJson(res, { ok: true, opened_path: targetPath, source_mode: mode || "cli" });
    return;
  }

  if (pathname === "/api/system/sleep") {
    try {
      const delaySeconds = Math.max(0, Math.min(30, Number(payload.delay_seconds) || 3));
      const scheduledIn = scheduleHostSleep(delaySeconds);
      sendJson(res, { ok: true, scheduled_in_seconds: scheduledIn });
      return;
    } catch (err) {
      sendJson(res, { ok: false, error: String(err.message || err) }, 500);
      return;
    }
  }

  sendJson(res, { ok: false, error: "Unknown endpoint." }, 404);
}

async function requestHandler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const host = req.headers.host || "127.0.0.1";
  const urlObj = new URL(req.url || "/", `http://${host}`);
  try {
    if (req.method === "GET") {
      await handleGet(req, res, urlObj);
      return;
    }
    if (req.method === "POST") {
      await handlePost(req, res, urlObj);
      return;
    }
    sendJson(res, { ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    sendJson(res, { ok: false, error: String(err.message || err) }, 500);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = http.createServer(requestHandler);
  const startServer = () =>
    server.listen(args.port, args.host, () => {
      const serveUrl = `http://${args.host}:${args.port}`;
      const openHost = args.host === "0.0.0.0" ? "127.0.0.1" : args.host;
      const openUrl = `http://${openHost}:${args.port}`;
      console.log(`[webui-node] root: ${ROOT_DIR}`);
      console.log(`[webui-node] serving: ${serveUrl}`);
      if (!args.noOpen) openBrowser(openUrl);
    });
  migrateLegacyDownloadDirsOnStartup()
    .catch((err) => {
      console.warn(`[migration] startup migration failed: ${err.message || err}`);
    })
    .finally(() => {
      startServer();
    });
}

if (require.main === module) {
  main();
}
