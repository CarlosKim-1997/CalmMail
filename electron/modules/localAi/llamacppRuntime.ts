/**
 * CalmMail-managed `llama.cpp` runtime.
 *
 * Owns everything between "the user accepted the Local AI policy" and
 * "a managed OpenAI-compatible endpoint is reachable on `127.0.0.1`":
 *
 *   1. Downloading the platform-appropriate `llama-server` binary, with
 *      SHA-256 verification against {@link modelCatalog}.
 *   2. Downloading the chosen GGUF model, same verification rule.
 *   3. Spawning `llama-server` bound to `127.0.0.1` on an ephemeral port,
 *      watching its stdout, polling `/health` until ready.
 *   4. Cleaning up the child process on app quit.
 *
 * Anything that isn't part of this lifecycle (UI, IPC plumbing, picker
 * UX) lives elsewhere. The renderer never talks directly to llama-server.
 *
 * Phase 2 status: implementation complete, but the catalog still ships
 * `sha256: null` placeholders. The downloader hard-fails on `null` so we
 * can't accidentally ship without real pinned hashes (override:
 * `CALMMAIL_ALLOW_UNPINNED=1`, dev only).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { finished } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { app } from 'electron';
import type { LocalAiModelId, LocalAiSetupProgress } from '@shared/types';
import {
  getModelById,
  getRuntimeBinaryForCurrentPlatform,
  isAllowedDownloadUrl,
  isUnpinnedDownloadAllowed,
  type CatalogArtifact,
  type RuntimeBinary,
} from './modelCatalog';

// ───────────────────────────── paths ─────────────────────────────

function rootDir(): string {
  return path.join(app.getPath('userData'), 'local-ai');
}
function binDir(): string {
  return path.join(rootDir(), 'bin');
}
function modelsDir(): string {
  return path.join(rootDir(), 'models');
}
function binaryPath(filename: string): string {
  return path.join(binDir(), filename);
}
function modelPath(filename: string): string {
  return path.join(modelsDir(), filename);
}

/**
 * Path of a binary bundled with the installer under
 * `resources/local-ai/bin/<filename>` (electron-builder `extraResources`),
 * or `null` when not shipped this way. Bundled binaries take precedence
 * over downloaded ones so packaged builds work fully offline.
 */
function bundledBinaryPath(filename: string): string | null {
  try {
    const resourcesPath = process.resourcesPath;
    if (!resourcesPath) return null;
    const p = path.join(resourcesPath, 'local-ai', 'bin', filename);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Resolves the binary to run: bundled (preferred) → downloaded fallback. */
function effectiveBinaryPath(filename: string): string {
  return bundledBinaryPath(filename) ?? binaryPath(filename);
}

function ensureDirs(): void {
  fs.mkdirSync(binDir(), { recursive: true });
  fs.mkdirSync(modelsDir(), { recursive: true });
}

// ─────────────────────────── download ────────────────────────────

export interface DownloadProgress {
  artifact: 'binary' | 'model';
  /** 0..1; null when the server doesn't advertise Content-Length. */
  fraction: number | null;
  bytesReceived: number;
  totalBytes: number | null;
}

export interface EnsureResult {
  ok: boolean;
  /** Local absolute path of the verified artifact (when `ok`). */
  filePath?: string;
  /** True when the file was already present with a matching SHA. */
  alreadyHad?: boolean;
  /** Machine-readable error code for the renderer to localize. */
  errorCode?:
    | 'policy_blocked_unpinned_sha'
    | 'policy_blocked_host'
    | 'platform_unsupported'
    | 'unknown_model'
    | 'network_error'
    | 'http_error'
    | 'hf_auth_required'
    | 'sha_mismatch'
    | 'fs_error';
  /** Human-readable detail; not user-facing copy. */
  errorDetail?: string;
}

type DownloadVerify =
  | { mode: 'sha256'; expectedLower: string }
  | { mode: 'dev-skip' };

function huggingFaceToken(): string | null {
  const t =
    process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_HUB_TOKEN?.trim() || null;
  return t || null;
}

function isHuggingFaceHost(hostname: string): boolean {
  return (
    hostname === 'huggingface.co' ||
    hostname.endsWith('.huggingface.co') ||
    hostname.endsWith('.hf.co')
  );
}

/** Headers HF expects for resolve/main downloads (and optional gated-repo auth). */
function httpsGetOptions(url: string): https.RequestOptions {
  const { hostname } = new URL(url);
  const headers: Record<string, string> = {
    'User-Agent': 'CalmMail/1.0 (local-ai-setup; +https://github.com/ggml-org/llama.cpp)',
  };
  if (isHuggingFaceHost(hostname)) {
    const token = huggingFaceToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return { headers };
}

/** Move a completed download into place (Windows may need copy+delete). */
function commitDownloadedFile(tmp: string, dest: string): void {
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* overwrite below */
    }
  }
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EXDEV') {
        fs.copyFileSync(tmp, dest);
        fs.unlinkSync(tmp);
        return;
      }
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        if (attempt < maxAttempts - 1) {
          const until = Date.now() + 200;
          while (Date.now() < until) {
            /* brief pause — AV/indexers often release the file */
          }
          continue;
        }
        fs.copyFileSync(tmp, dest);
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* dest is in place */
        }
        return;
      }
      throw e;
    }
  }
}

/**
 * Streaming HTTPS download with progressive SHA-256 hashing. Writes to a
 * `.part` sibling and atomically renames on success. Any failure path
 * deletes the partial file.
 */
function streamDownload(
  url: string,
  dest: string,
  verify: DownloadVerify,
  onProgress: (received: number, total: number | null) => void,
): Promise<EnsureResult> {
  return new Promise((resolve) => {
    const tmp = `${dest}.part`;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } catch (e) {
      resolve({ ok: false, errorCode: 'fs_error', errorDetail: (e as Error).message });
      return;
    }

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);

    const cleanup = () => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* swallow */
      }
    };

    const followAndDownload = (currentUrl: string, redirectsLeft: number) => {
      if (!isAllowedDownloadUrl(currentUrl)) {
        cleanup();
        resolve({ ok: false, errorCode: 'policy_blocked_host', errorDetail: currentUrl });
        return;
      }
      const req = https.get(currentUrl, httpsGetOptions(currentUrl), (res) => {
        // Follow HTTPS redirects within the allowlist (HF often 302s to a CDN).
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            cleanup();
            resolve({ ok: false, errorCode: 'http_error', errorDetail: 'too_many_redirects' });
            return;
          }
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          followAndDownload(nextUrl, redirectsLeft - 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          cleanup();
          const host = new URL(currentUrl).hostname;
          const code =
            status === 401 && isHuggingFaceHost(host) ? 'hf_auth_required' : 'http_error';
          resolve({
            ok: false,
            errorCode: code,
            errorDetail: `HTTP ${status}`,
          });
          return;
        }

        const totalRaw = res.headers['content-length'];
        const total = totalRaw ? Number(totalRaw) : null;
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          hash.update(chunk);
          onProgress(received, total);
        });
        res.pipe(out);
        out.on('error', (e) => {
          cleanup();
          resolve({ ok: false, errorCode: 'fs_error', errorDetail: e.message });
        });
        void (async () => {
          try {
            await finished(out);
            const computed = hash.digest('hex').toLowerCase();
            if (verify.mode === 'sha256') {
              if (computed !== verify.expectedLower) {
                cleanup();
                resolve({
                  ok: false,
                  errorCode: 'sha_mismatch',
                  errorDetail: `expected=${verify.expectedLower} got=${computed}`,
                });
                return;
              }
            } else {
              console.log(
                `[CalmMail] dev artifact ${path.basename(dest)} sha256=${computed} — pin with npm run pin:hashes`,
              );
            }
            commitDownloadedFile(tmp, dest);
            resolve({ ok: true, filePath: dest });
          } catch (e) {
            cleanup();
            const msg = e instanceof Error ? e.message : String(e);
            const code = e && typeof e === 'object' && 'code' in e ? String((e as NodeJS.ErrnoException).code) : '';
            resolve({
              ok: false,
              errorCode: 'fs_error',
              errorDetail: code ? `${code}: ${msg}` : msg,
            });
          }
        })();
        res.on('error', (e) => {
          cleanup();
          resolve({ ok: false, errorCode: 'network_error', errorDetail: e.message });
        });
      });
      req.on('error', (e) => {
        cleanup();
        resolve({ ok: false, errorCode: 'network_error', errorDetail: e.message });
      });
    };

    followAndDownload(url, 5);
  });
}

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

/**
 * Generic "ensure this artifact is present and verified" entry point used
 * by both `ensureBinary` and `ensureModel`.
 */
async function ensureArtifact(
  artifact: 'binary' | 'model',
  meta: CatalogArtifact,
  dest: string,
  send: (p: LocalAiSetupProgress) => void,
): Promise<EnsureResult> {
  if (!isAllowedDownloadUrl(meta.url)) {
    return { ok: false, errorCode: 'policy_blocked_host', errorDetail: meta.url };
  }
  if (meta.sha256 === null && !isUnpinnedDownloadAllowed()) {
    return { ok: false, errorCode: 'policy_blocked_unpinned_sha', errorDetail: meta.filename };
  }

  if (fs.existsSync(dest)) {
    if (meta.sha256 === null) {
      // Dev override: trust an existing file when hash is unpinned.
      return { ok: true, filePath: dest, alreadyHad: true };
    }
    const have = await sha256OfFile(dest).catch(() => null);
    if (have === meta.sha256.toLowerCase()) {
      return { ok: true, filePath: dest, alreadyHad: true };
    }
    // Mismatched leftover from a previous build — remove and re-download.
    try {
      fs.unlinkSync(dest);
    } catch {
      /* swallow; download will overwrite via rename */
    }
  }

  const verify: DownloadVerify =
    meta.sha256 === null
      ? { mode: 'dev-skip' }
      : { mode: 'sha256', expectedLower: meta.sha256.toLowerCase() };

  send({ phase: artifact === 'binary' ? 'download' : 'modelDownload', percent: 5 });
  const r = await streamDownload(meta.url, dest, verify, (received, total) => {
    const frac = total ? received / total : null;
    send({
      phase: artifact === 'binary' ? 'download' : 'modelDownload',
      percent: frac ? Math.min(95, Math.round(frac * 90) + 5) : 5,
    });
  });
  if (r.ok) {
    send({ phase: artifact === 'binary' ? 'verify' : 'modelVerify', percent: 98 });
  }
  return r;
}

/** True when `binDir()` contains at least one native dependency DLL (Windows zip runtimes). */
function binDirHasNativeDeps(): boolean {
  try {
    return fs.readdirSync(binDir()).some((f) => /\.dll$/i.test(f));
  } catch {
    return false;
  }
}

/** Windows zip packages ship `llama-server.exe` plus DLLs; exe-only installs cannot start. */
function runtimeZipPackageReady(meta: RuntimeBinary): boolean {
  const dest = binaryPath(meta.filename);
  if (!fs.existsSync(dest)) return false;
  if (process.platform === 'win32' && meta.packageFormat === 'zip') {
    return binDirHasNativeDeps();
  }
  return true;
}

/**
 * Extract every file from a Windows CPU runtime zip into `binDir()`.
 * llama.cpp releases bundle DLLs next to `llama-server.exe`; copying
 * only the exe yields exit code 0xC0000135 (STATUS_DLL_NOT_FOUND).
 */
async function extractRuntimeZipPackage(
  zipPath: string,
  destDir: string,
  mainExeName: string,
): Promise<EnsureResult> {
  try {
    const zip = new AdmZip(zipPath);
    const mainLower = mainExeName.toLowerCase();
    let wroteMain = false;
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const normalized = entry.entryName.replace(/\\/g, '/');
      const base = path.basename(normalized);
      if (!base || base.includes('..')) continue;
      const outPath = path.join(destDir, base);
      fs.writeFileSync(outPath, entry.getData());
      if (base.toLowerCase() === mainLower) wroteMain = true;
    }
    if (!wroteMain) {
      const sample = zip
        .getEntries()
        .filter((e) => !e.isDirectory)
        .slice(0, 6)
        .map((e) => e.entryName)
        .join(', ');
      return {
        ok: false,
        errorCode: 'fs_error',
        errorDetail: `${mainExeName} not in zip${sample ? ` (e.g. ${sample})` : ''}`,
      };
    }
    return { ok: true, filePath: path.join(destDir, mainExeName) };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      ok: false,
      errorCode: 'fs_error',
      errorDetail: err.code ? `${err.code}: ${err.message}` : err.message,
    };
  }
}

async function ensureBinaryFromZip(
  meta: RuntimeBinary,
  dest: string,
  send: (p: LocalAiSetupProgress) => void,
): Promise<EnsureResult> {
  const member = meta.extractMember ?? meta.filename;
  if (!isAllowedDownloadUrl(meta.url)) {
    return { ok: false, errorCode: 'policy_blocked_host', errorDetail: meta.url };
  }
  if (meta.sha256 === null && !isUnpinnedDownloadAllowed()) {
    return { ok: false, errorCode: 'policy_blocked_unpinned_sha', errorDetail: meta.filename };
  }

  if (runtimeZipPackageReady(meta)) {
    if (meta.sha256 === null) {
      return { ok: true, filePath: dest, alreadyHad: true };
    }
    const have = await sha256OfFile(dest).catch(() => null);
    if (have === meta.sha256.toLowerCase()) {
      return { ok: true, filePath: dest, alreadyHad: true };
    }
    try {
      for (const f of fs.readdirSync(binDir())) {
        if (/\.(exe|dll)$/i.test(f)) fs.unlinkSync(path.join(binDir(), f));
      }
    } catch {
      /* re-download */
    }
  }

  const zipDest = path.join(binDir(), `_runtime-${path.basename(meta.url)}`);
  const verify: DownloadVerify =
    meta.sha256 === null
      ? { mode: 'dev-skip' }
      : { mode: 'sha256', expectedLower: meta.sha256.toLowerCase() };

  send({ phase: 'download', percent: 5 });
  const dl = await streamDownload(meta.url, zipDest, verify, (received, total) => {
    const frac = total ? received / total : null;
    send({
      phase: 'download',
      percent: frac ? Math.min(88, Math.round(frac * 85) + 5) : 5,
    });
  });
  if (!dl.ok) return dl;

  send({ phase: 'verify', percent: 92 });
  const ex = await extractRuntimeZipPackage(zipDest, binDir(), member);
  try {
    fs.unlinkSync(zipDest);
  } catch {
    /* swallow */
  }
  if (ex.ok) send({ phase: 'verify', percent: 98 });
  return ex;
}

export async function ensureBinary(
  send: (p: LocalAiSetupProgress) => void,
): Promise<EnsureResult> {
  ensureDirs();
  const meta = getRuntimeBinaryForCurrentPlatform();
  if (!meta) {
    return { ok: false, errorCode: 'platform_unsupported', errorDetail: `${process.platform}/${process.arch}` };
  }
  // Installer-bundled binary wins: no download, no SHA gate (it shipped
  // inside our signed artifact and was verified at build time).
  const bundled = bundledBinaryPath(meta.filename);
  if (bundled) {
    return { ok: true, filePath: bundled, alreadyHad: true };
  }
  const dest = binaryPath(meta.filename);
  const r =
    meta.packageFormat === 'zip'
      ? await ensureBinaryFromZip(meta, dest, send)
      : await ensureArtifact('binary', meta, dest, send);
  if (r.ok && r.filePath) {
    // POSIX needs +x. Windows ignores chmod.
    try {
      fs.chmodSync(r.filePath, 0o755);
    } catch {
      /* swallow */
    }
  }
  return r;
}

export async function ensureModel(
  modelId: LocalAiModelId,
  send: (p: LocalAiSetupProgress) => void,
): Promise<EnsureResult> {
  ensureDirs();
  const meta = getModelById(modelId);
  if (!meta) {
    return { ok: false, errorCode: 'unknown_model', errorDetail: modelId };
  }
  const dest = modelPath(meta.filename);
  return ensureArtifact('model', meta, dest, send);
}

// ──────────────────── managed server lifecycle ──────────────────

interface ServerInfo {
  port: number;
  modelId: LocalAiModelId;
  pid: number;
}

let activeServer: ServerInfo | null = null;
let activeChild: ChildProcess | null = null;
let stopping = false;

/** Picks an ephemeral free port by briefly opening a server on `127.0.0.1:0`. */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('failed to pick free port')));
      }
    });
  });
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode != null || child.signalCode != null || child.killed;
}

async function pollHealth(
  port: number,
  timeoutMs: number,
  child: ChildProcess | null,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // llama-server exposes `GET /health` returning `{ status: 'ok' | 'loading' | 'error' }`.
  while (Date.now() < deadline) {
    if (child && childHasExited(child)) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { status?: string } | null;
        if (!body || body.status === 'ok') return true;
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export interface StartServerResult {
  ok: boolean;
  port?: number;
  errorCode?: 'binary_missing' | 'model_missing' | 'already_running' | 'spawn_failed' | 'health_timeout';
  errorDetail?: string;
}

/**
 * Spawns `llama-server` for the chosen model. Returns once `/health`
 * reports ready. The caller (provider) must call {@link stopServer} on
 * model change or app shutdown.
 */
export async function startServer(
  modelId: LocalAiModelId,
): Promise<StartServerResult> {
  if (activeServer && activeChild && !activeChild.killed) {
    if (activeServer.modelId === modelId) {
      return { ok: true, port: activeServer.port };
    }
    await stopServer();
  }

  const binMeta = getRuntimeBinaryForCurrentPlatform();
  const modelMeta = getModelById(modelId);
  if (!binMeta || !modelMeta) {
    return { ok: false, errorCode: 'binary_missing', errorDetail: 'catalog' };
  }
  const binPath = effectiveBinaryPath(binMeta.filename);
  const mdlPath = resolveModelFilePath(modelId);
  if (!fs.existsSync(binPath)) {
    return { ok: false, errorCode: 'binary_missing', errorDetail: binPath };
  }
  if (!mdlPath) {
    return {
      ok: false,
      errorCode: 'model_missing',
      errorDetail: modelPath(modelMeta.filename),
    };
  }

  const port = await pickFreePort().catch(() => null);
  if (!port) {
    return { ok: false, errorCode: 'spawn_failed', errorDetail: 'port_pick_failed' };
  }

  // Modest defaults: bound to loopback, 4k context, no telemetry, JSON-only
  // log lines if supported. We deliberately don't expose tuning here; users
  // change PCs more often than they want to tweak `--ctx-size`.
  const args = [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '-m',
    mdlPath,
    '--ctx-size',
    '8192',
    '--n-predict',
    '-1',
  ];

  let child: ChildProcess;
  let stderrTail = '';
  try {
    child = spawn(binPath, args, {
      cwd: path.dirname(binPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    return { ok: false, errorCode: 'spawn_failed', errorDetail: (e as Error).message };
  }

  activeChild = child;
  activeServer = { port, modelId, pid: child.pid ?? -1 };
  stopping = false;

  child.on('exit', (code) => {
    if (activeChild === child) {
      activeChild = null;
      activeServer = null;
    }
    if (!stopping) {
      // Unexpected death; the provider will re-spawn on next briefing.
      console.warn(`[local-ai] llama-server exited unexpectedly: code=${code}`);
    }
  });
  child.stdout?.on('data', (b) => {
    if (process.env.CALMMAIL_LOCAL_AI_VERBOSE === '1') {
      process.stdout.write(`[llama] ${b}`);
    }
  });
  child.stderr?.on('data', (b) => {
    const chunk = b.toString();
    stderrTail = (stderrTail + chunk).slice(-2000);
    if (process.env.CALMMAIL_LOCAL_AI_VERBOSE === '1') {
      process.stderr.write(`[llama] ${chunk}`);
    }
  });

  const healthy = await pollHealth(port, 60_000, child);
  if (!healthy) {
    const exitCode = child.exitCode;
    const exitDetail =
      exitCode != null
        ? `exit_${exitCode}`
        : stderrTail.trim()
          ? stderrTail.trim().slice(-500)
          : undefined;
    await stopServer();
    if (childHasExited(child)) {
      return { ok: false, errorCode: 'spawn_failed', errorDetail: exitDetail };
    }
    return { ok: false, errorCode: 'health_timeout', errorDetail: exitDetail };
  }
  return { ok: true, port };
}

export async function stopServer(): Promise<void> {
  if (!activeChild) {
    activeServer = null;
    return;
  }
  stopping = true;
  const child = activeChild;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* swallow */
      }
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      activeChild = null;
      activeServer = null;
      stopping = false;
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      activeChild = null;
      activeServer = null;
      stopping = false;
      resolve();
    }
  });
}

export function getServerInfo(): Readonly<ServerInfo> | null {
  return activeServer;
}

export function isServerRunning(): boolean {
  return !!activeServer && !!activeChild && !activeChild.killed;
}

/** True when the platform-appropriate `llama-server` is present (bundled or downloaded). */
export function isBinaryReady(): boolean {
  const binMeta = getRuntimeBinaryForCurrentPlatform();
  if (!binMeta) return false;
  if (!fs.existsSync(effectiveBinaryPath(binMeta.filename))) return false;
  if (process.platform === 'win32' && binMeta.packageFormat === 'zip') {
    const downloaded = binaryPath(binMeta.filename);
    if (fs.existsSync(downloaded)) return binDirHasNativeDeps();
    // Bundled installer layout must ship DLLs beside the exe.
    const bundled = bundledBinaryPath(binMeta.filename);
    if (bundled) {
      try {
        return fs
          .readdirSync(path.dirname(bundled))
          .some((f) => /\.dll$/i.test(f));
      } catch {
        return false;
      }
    }
  }
  return true;
}

/** Earlier catalog filenames still on disk after URL/filename updates. */
const LEGACY_MODEL_FILENAMES: Partial<Record<LocalAiModelId, readonly string[]>> = {
  'qwen3-4b-instruct': ['qwen3-4b-instruct-q4_k_m.gguf'],
};

/** Absolute path to the on-disk GGUF for `modelId`, or null if missing. */
export function resolveModelFilePath(modelId: LocalAiModelId): string | null {
  const mdlMeta = getModelById(modelId);
  if (!mdlMeta) return null;
  const primary = modelPath(mdlMeta.filename);
  if (fs.existsSync(primary)) return primary;
  for (const legacy of LEGACY_MODEL_FILENAMES[modelId] ?? []) {
    const legacyPath = modelPath(legacy);
    if (fs.existsSync(legacyPath)) return legacyPath;
  }
  return null;
}

/** True when the GGUF file for `modelId` exists on disk. */
export function isModelReady(modelId: LocalAiModelId | null): boolean {
  if (!modelId) return false;
  return resolveModelFilePath(modelId) != null;
}

/** True when the binary *and* the model for `modelId` are both ready. */
export function isManagedReady(modelId: LocalAiModelId | null): boolean {
  return isBinaryReady() && isModelReady(modelId);
}
