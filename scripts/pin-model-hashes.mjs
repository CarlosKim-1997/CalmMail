/**
 * Computes (and optionally writes) SHA-256 hashes for every artifact in
 * `electron/modules/localAi/catalog.data.json`.
 *
 * Why this exists: the catalog ships with `sha256: null` placeholders. The
 * downloader hard-fails on null (unless CALMMAIL_ALLOW_UNPINNED=1), so before
 * a release we must pin real hashes. This tool downloads each artifact from
 * its catalog URL, hashes it, and prints the values — or, with `--write`,
 * edits the JSON in place.
 *
 * Usage:
 *   npm run pin:hashes                  # PLAN only — lists what would download, no network
 *   npm run pin:hashes -- --run         # download + hash + print (does NOT edit JSON)
 *   npm run pin:hashes -- --write       # download + hash + write hashes into the JSON
 *   npm run pin:hashes -- --write --only qwen3-4b-instruct
 *
 * The default is a no-network plan on purpose: hashing requires downloading
 * multi-GB files, so we never start that accidentally. Pass --run or --write
 * when you actually intend to pull artifacts.
 *
 * Notes:
 *  - Only allowlisted hosts are fetched (defense in depth, mirrors runtime).
 *  - URLs that still contain "PINNED" (placeholder releases) are skipped.
 *  - Downloads stream to a temp file; nothing large is held in memory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'electron/modules/localAi/catalog.data.json');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
// --write implies downloading; --run downloads without persisting.
const DOWNLOAD = WRITE || args.includes('--run');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
}

function hostAllowed(catalog, url) {
  try {
    const host = new URL(url).hostname;
    return catalog.allowedDownloadHosts.includes(host);
  } catch {
    return false;
  }
}

function isPlaceholder(url) {
  return url.includes('PINNED') || url.includes('/PINNED/');
}

/** Stream a URL (following redirects) into `destFile`, returning its sha256. */
function downloadAndHash(url, destFile, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'CalmMail-pin-hashes' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadAndHash(next, destFile, redirectsLeft - 1));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status}`));
      }
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(destFile);
      let bytes = 0;
      const total = Number(res.headers['content-length'] ?? 0);
      let lastPct = -1;
      res.on('data', (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
        if (total > 0) {
          const pct = Math.floor((bytes / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r    ${pct}% (${(bytes / 1e6).toFixed(0)} MB)   `);
            lastPct = pct;
          }
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close();
        process.stdout.write('\r');
        resolve({ sha256: hash.digest('hex'), bytes });
      });
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  const catalog = readCatalog();
  const artifacts = [
    ...catalog.runtimeBinaries.map((b, i) => ({
      kind: 'runtimeBinaries',
      index: i,
      label: `${b.filename} (${b.platform}/${b.arch})`,
      ref: b,
    })),
    ...catalog.models.map((m, i) => ({
      kind: 'models',
      index: i,
      label: m.id,
      ref: m,
    })),
  ].filter((a) => (ONLY ? a.label.includes(ONLY) || a.ref.id === ONLY : true));

  const mode = WRITE ? 'write' : DOWNLOAD ? 'run (no write)' : 'plan (no network)';
  console.log(`pin-model-hashes: ${artifacts.length} artifact(s), mode=${mode}\n`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calmmail-pin-'));
  let pinned = 0;
  let skipped = 0;
  let planned = 0;

  for (const a of artifacts) {
    const { url } = a.ref;
    console.log(`• ${a.label}`);
    if (isPlaceholder(url)) {
      console.log(`    SKIP — placeholder URL (still "PINNED"): ${url}`);
      skipped++;
      continue;
    }
    if (!hostAllowed(catalog, url)) {
      console.log(`    SKIP — host not in allowlist: ${url}`);
      skipped++;
      continue;
    }
    if (!DOWNLOAD) {
      console.log(`    PLAN — would download ${url}`);
      console.log(`    (run with --run to hash, or --write to pin)`);
      planned++;
      continue;
    }
    const tmpFile = path.join(tmpDir, `${a.kind}-${a.index}.bin`);
    try {
      const { sha256, bytes } = await downloadAndHash(url, tmpFile);
      console.log(`    sha256: ${sha256}`);
      console.log(`    bytes:  ${bytes}`);
      if (WRITE) {
        catalog[a.kind][a.index].sha256 = sha256;
        catalog[a.kind][a.index].approxBytes = bytes;
      }
      pinned++;
    } catch (e) {
      console.log(`    ERROR — ${e instanceof Error ? e.message : e}`);
      skipped++;
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (WRITE && pinned > 0) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
    console.log(`\nWrote ${pinned} hash(es) into ${path.relative(ROOT, CATALOG_PATH)}.`);
    console.log('Next: run `npm run notices` to refresh THIRD_PARTY_NOTICES.md.');
  } else if (!DOWNLOAD) {
    console.log(`\nPlan only. would-download=${planned} skipped=${skipped}. ` +
      `Re-run with --run (hash) or --write (hash + pin).`);
  } else {
    console.log(`\nDone (no write). hashed=${pinned} skipped=${skipped}. ` +
      `Re-run with --write to persist.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
