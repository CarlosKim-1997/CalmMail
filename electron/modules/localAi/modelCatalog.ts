/**
 * Standard-lane model + binary catalog.
 *
 * Every entry in this file represents an artifact CalmMail is willing to
 * download to a user's machine. The runtime refuses to write a file whose
 * URL does not appear in {@link ALLOWED_DOWNLOAD_HOSTS} or whose computed
 * SHA-256 disagrees with the one pinned below.
 *
 * Editing rules:
 *   1. Every `sha256` must be the real hash of the upstream file. The
 *      `null` placeholders below are *intentional safety holds* — the
 *      downloader hard-fails on `null` unless `CALMMAIL_ALLOW_UNPINNED=1`
 *      is set in the environment (dev override only).
 *   2. Adding a model? Confirm the license is in the standard lane
 *      (`docs/local-ai-policy.md` §2) and add a corresponding row in
 *      `THIRD_PARTY_NOTICES.md`.
 *   3. Removing a model? Bump `LOCAL_AI_POLICY_VERSION` so existing users
 *     get re-prompted before any new download starts.
 */

import type { LocalAiModelId } from '@shared/types';
import { LOCAL_AI_MODEL_IDS } from '@shared/localAiPolicy';
import catalogData from './catalog.data.json';

/** Family of artifacts shipped on disk. */
export type ArtifactKind = 'runtime-binary' | 'model';

/** SPDX-style license identifier shown in UI and in THIRD_PARTY_NOTICES.md. */
export type LicenseId = 'Apache-2.0' | 'MIT';

export interface CatalogArtifact {
  kind: ArtifactKind;
  /** Local filename (no directory). The downloader places this under `local-ai/{bin|models}/`. */
  filename: string;
  url: string;
  /** Lowercase hex SHA-256. `null` means "do not download yet" (see file header). */
  sha256: string | null;
  /** Pretty size for UI; the real downloader trusts Content-Length. */
  approxBytes: number;
  license: LicenseId;
  /** Human-readable upstream attribution shown in About → Open source notices. */
  attribution: string;
  /** Upstream project/model home page (used by build-notices.mjs). */
  source: string;
}

export interface CatalogModel extends CatalogArtifact {
  kind: 'model';
  id: LocalAiModelId;
  /** UI label, language-neutral; localized strings live in i18n. */
  displayName: string;
  /** Suggested minimum total RAM in GB; capabilityCheck uses this when picking defaults. */
  minRamGb: number;
  /** Optional: a friendly one-liner shown under the model name in the picker. */
  shortDescription: string;
}

export interface RuntimeBinary extends CatalogArtifact {
  kind: 'runtime-binary';
  platform: NodeJS.Platform;
  arch: 'x64' | 'arm64';
  /** When set, {@link url} is a zip; we extract {@link extractMember} to {@link filename}. */
  packageFormat?: 'zip';
  extractMember?: string;
}

/**
 * Raw shape of `catalog.data.json`. The JSON is the single source of truth
 * (also consumed by `scripts/build-notices.mjs` and
 * `scripts/pin-model-hashes.mjs`); this module casts it into the typed
 * structures the runtime uses.
 */
interface CatalogDataFile {
  allowedDownloadHosts: string[];
  runtimeBinaries: Array<{
    platform: string;
    arch: string;
    filename: string;
    url: string;
    packageFormat?: string;
    extractMember?: string;
    sha256: string | null;
    approxBytes: number;
    license: string;
    attribution: string;
    source: string;
  }>;
  models: Array<{
    id: string;
    displayName: string;
    shortDescription: string;
    filename: string;
    url: string;
    sha256: string | null;
    approxBytes: number;
    license: string;
    attribution: string;
    source: string;
    minRamGb: number;
  }>;
}

const DATA = catalogData as CatalogDataFile;

/**
 * Hosts CalmMail will download from. The downloader rejects anything else
 * even if the URL is HTTPS, so an attacker swapping a catalog URL cannot
 * smuggle a different host through.
 */
export const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = DATA.allowedDownloadHosts;

/**
 * llama.cpp server binaries. Each platform ships a distinct file built from
 * the same upstream release; the downloader (or bundled-resource resolver)
 * chooses the entry matching `process.platform` + arch.
 */
export const RUNTIME_BINARIES: readonly RuntimeBinary[] = DATA.runtimeBinaries.map((b) => ({
  kind: 'runtime-binary',
  platform: b.platform as NodeJS.Platform,
  arch: b.arch as 'x64' | 'arm64',
  filename: b.filename,
  url: b.url,
  packageFormat: b.packageFormat === 'zip' ? ('zip' as const) : undefined,
  extractMember: b.extractMember,
  sha256: b.sha256,
  approxBytes: b.approxBytes,
  license: b.license as LicenseId,
  attribution: b.attribution,
  source: b.source,
}));

/**
 * Approved standard-lane models. The list order matches the policy
 * allowlist; the **recommended** entry for a given PC is computed by
 * `recommendLocalAiModels()` (Phase 4), not by order.
 */
export const MODELS: readonly CatalogModel[] = DATA.models.map((m) => ({
  kind: 'model',
  id: m.id as LocalAiModelId,
  displayName: m.displayName,
  shortDescription: m.shortDescription,
  filename: m.filename,
  url: m.url,
  sha256: m.sha256,
  approxBytes: m.approxBytes,
  license: m.license as LicenseId,
  attribution: m.attribution,
  source: m.source,
  minRamGb: m.minRamGb,
}));

/** Map for O(1) lookup by id. Built once at module load. */
const MODEL_INDEX: Map<LocalAiModelId, CatalogModel> = new Map(
  MODELS.map((m) => [m.id, m] as const),
);

export function getModelById(id: LocalAiModelId): CatalogModel | null {
  return MODEL_INDEX.get(id) ?? null;
}

export function getRuntimeBinaryForCurrentPlatform(): RuntimeBinary | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return (
    RUNTIME_BINARIES.find((b) => b.platform === platform && b.arch === arch) ?? null
  );
}

/** True when the URL's host is on the allowlist (and uses HTTPS). */
export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_DOWNLOAD_HOSTS.includes(u.host);
  } catch {
    return false;
  }
}

/**
 * Dev-only escape hatch: ignore `sha256 === null` if
 * `CALMMAIL_ALLOW_UNPINNED=1`. Never set this in production builds.
 */
export function isUnpinnedDownloadAllowed(): boolean {
  const v = process.env.CALMMAIL_ALLOW_UNPINNED;
  return v === '1' || v === 'true';
}

// Sanity check: every id in policy allowlist must have a catalog entry,
// and every catalog model must be in the policy allowlist. This runs at
// module import; if it ever fails, the app fails to start (correct).
for (const id of LOCAL_AI_MODEL_IDS) {
  if (!MODEL_INDEX.has(id)) {
    throw new Error(`modelCatalog: missing entry for policy-approved model "${id}"`);
  }
}
for (const m of MODELS) {
  if (!(LOCAL_AI_MODEL_IDS as readonly string[]).includes(m.id)) {
    throw new Error(`modelCatalog: model "${m.id}" is not in LOCAL_AI_MODEL_IDS`);
  }
}
