/**
 * Generates THIRD_PARTY_NOTICES.md from the single source of truth
 * (`electron/modules/localAi/catalog.data.json`) plus the production npm
 * dependencies in package.json.
 *
 * Run manually with `npm run notices`, and automatically before packaging
 * (`npm run make` / `npm run package`) so the shipped notices never drift
 * from what the app actually downloads or bundles.
 *
 * Design: pure, no network. License *texts* are embedded below (Apache-2.0,
 * MIT). For npm deps we best-effort read `node_modules/<dep>/LICENSE*` and
 * the `license` field of each dep's package.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'electron/modules/localAi/catalog.data.json');
const POLICY_PATH = path.join(ROOT, 'electron/shared/localAiPolicy.ts');
const PKG_PATH = path.join(ROOT, 'package.json');
const OUT_PATH = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');

const APACHE_2_0_TEXT = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Licensed under the Apache License, Version 2.0 (the "License"); you may
   not use this file except in compliance with the License. You may obtain
   a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

   (Full text: https://www.apache.org/licenses/LICENSE-2.0.txt)`;

const MIT_TEXT = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function licenseText(id) {
  if (id === 'Apache-2.0') return APACHE_2_0_TEXT;
  if (id === 'MIT') return MIT_TEXT;
  return `(License text for ${id} not embedded; see upstream.)`;
}

function fmtBytes(n) {
  if (!n) return 'unknown size';
  if (n >= 1_000_000_000) return `~${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `~${Math.round(n / 1_000_000)} MB`;
  return `${n} bytes`;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** Parse LOCAL_AI_MODEL_IDS from the policy TS file (regex; no TS runtime). */
function readPolicyModelIds() {
  const src = fs.readFileSync(POLICY_PATH, 'utf-8');
  const m = src.match(/LOCAL_AI_MODEL_IDS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Guard: catalog models and policy allowlist must agree. */
function assertCatalogPolicyConsistency(catalog) {
  const catalogIds = catalog.models.map((m) => m.id).sort();
  const policyIds = readPolicyModelIds().sort();
  const a = JSON.stringify(catalogIds);
  const b = JSON.stringify(policyIds);
  if (a !== b) {
    throw new Error(
      `build-notices: catalog models ${a} differ from policy allowlist ${b}. ` +
        `Update electron/shared/localAiPolicy.ts and the catalog together.`,
    );
  }
}

/** Best-effort npm license read for a production dependency. */
function npmDepInfo(dep) {
  const dir = path.join(ROOT, 'node_modules', dep);
  let license = 'UNKNOWN';
  try {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (typeof pkg.license === 'string') license = pkg.license;
    else if (pkg.license?.type) license = pkg.license.type;
    else if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) license = pkg.licenses[0].type;
  } catch {
    /* dep not installed; skip */
    return null;
  }
  // Locate a license file for the "see file" pointer (text not inlined to
  // keep the notices readable; the file path is enough for attribution).
  let licenseFile = null;
  try {
    const entries = fs.readdirSync(dir);
    const hit = entries.find((e) => /^licen[sc]e/i.test(e));
    if (hit) licenseFile = `node_modules/${dep}/${hit}`;
  } catch {
    /* ignore */
  }
  return { license, licenseFile };
}

function buildArtifactSection(title, artifacts) {
  const lines = [`## ${title}`, ''];
  for (const a of artifacts) {
    lines.push(`### ${a.title}`);
    lines.push('');
    lines.push(`- **License:** ${a.license}`);
    lines.push(`- **Attribution:** ${a.attribution}`);
    lines.push(`- **Source:** ${a.source}`);
    lines.push(`- **Shipped file:** \`${a.filename}\` (${fmtBytes(a.approxBytes)})`);
    lines.push(`- **SHA-256:** ${a.sha256 ? `\`${a.sha256}\`` : '_not pinned yet — see `scripts/pin-model-hashes.mjs`_'}`);
    lines.push('');
    lines.push('<details><summary>License text</summary>');
    lines.push('');
    lines.push('```');
    lines.push(licenseText(a.license));
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const catalog = readJson(CATALOG_PATH);
  assertCatalogPolicyConsistency(catalog);

  const generatedAt = new Date().toISOString();

  const header = [
    '# Third-Party Notices',
    '',
    '> **This file is generated.** Edit `electron/modules/localAi/catalog.data.json`',
    '> (artifacts) or `scripts/build-notices.mjs` (layout / npm section), then run',
    '> `npm run notices`. Do not edit by hand — changes will be overwritten.',
    '',
    `_Last generated: ${generatedAt}_`,
    '',
    'CalmMail is a commercial application that depends on and, in some cases,',
    'redistributes the works listed below. This file is the user-facing',
    'fulfillment of those licenses and is linked from the app under',
    'Settings → Open source notices.',
    '',
    'See `docs/local-ai-policy.md` for the policy that governs which models and',
    'runtimes may appear here.',
    '',
    '---',
    '',
  ].join('\n');

  // Runtime binaries: collapse duplicate (same filename across mac arches
  // share identical attribution) by license+attribution for a clean list.
  const runtime = catalog.runtimeBinaries.map((b) => ({
    title: `llama.cpp (\`${b.filename}\`, ${b.platform}/${b.arch})`,
    license: b.license,
    attribution: b.attribution,
    source: b.source,
    filename: b.filename,
    approxBytes: b.approxBytes,
    sha256: b.sha256,
  }));

  const models = catalog.models.map((m) => ({
    title: m.displayName,
    license: m.license,
    attribution: m.attribution,
    source: m.source,
    filename: m.filename,
    approxBytes: m.approxBytes,
    sha256: m.sha256,
  }));

  // Excluded-families note (policy §2 / §6).
  const excluded = [
    '## Excluded from CalmMail’s standard lane',
    '',
    'The following families are **not** distributed, recommended, or pre-fetched',
    'by CalmMail because their licenses are not compatible with our commercial',
    'use without case-by-case review:',
    '',
    '- Meta Llama family (Community License with MAU clause)',
    '- Google Gemma family (Gemma Terms of Use)',
    '- Qwen models released under the Tongyi Qianwen License',
    '',
    'If a user reaches these through the optional advanced Ollama path, CalmMail',
    'does not host, mirror, modify, or distribute them.',
    '',
    '---',
    '',
  ].join('\n');

  // npm production dependencies.
  const pkg = readJson(PKG_PATH);
  const deps = Object.keys(pkg.dependencies ?? {}).sort();
  const npmLines = ['## Runtime dependencies (npm, production)', ''];
  for (const dep of deps) {
    const info = npmDepInfo(dep);
    if (!info) {
      npmLines.push(`- **${dep}** — _not installed at generation time_`);
      continue;
    }
    const fileNote = info.licenseFile ? ` ([license](${info.licenseFile}))` : '';
    npmLines.push(`- **${dep}** — ${info.license}${fileNote}`);
  }
  npmLines.push('');
  npmLines.push('---');
  npmLines.push('');

  const verify = [
    '## How to verify the bundled binaries',
    '',
    'Every binary or model CalmMail downloads:',
    '',
    '1. Originates from a host in the allowlist in',
    '   `electron/modules/localAi/catalog.data.json` (`allowedDownloadHosts`).',
    '2. Matches a SHA-256 hash pinned in the same file.',
    '3. Is rejected (partial file deleted, plain-language error) on mismatch.',
    '',
    'Installer-bundled binaries under `resources/local-ai/bin/` are verified at',
    'build time and take precedence over downloads.',
    '',
  ].join('\n');

  const body = [
    header,
    buildArtifactSection('Local AI runtime', runtime),
    buildArtifactSection('Standard models', models),
    excluded,
    npmLines.join('\n'),
    verify,
  ].join('\n');

  fs.writeFileSync(OUT_PATH, body.trimStart() + '\n', 'utf-8');
  console.log(`THIRD_PARTY_NOTICES.md generated (${deps.length} npm deps, ` +
    `${models.length} models, ${runtime.length} runtime binaries).`);
}

main();
