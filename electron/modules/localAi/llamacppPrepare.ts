/**
 * First-run preparation for a llama.cpp–style local server layout.
 *
 * Creates a stable folder under userData. Optionally downloads `llama-server`
 * when `CALMMAIL_LLAMA_SERVER_EXE_URL` (HTTPS) is set by the distributor.
 * Otherwise finishes with `skippedBinaryDownload` so the UI can explain next steps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { app } from 'electron';
import type { LocalAiPrepareResult, LocalAiSetupProgress } from '@shared/types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function prepareLlamacppRuntime(
  send: (p: LocalAiSetupProgress) => void,
): Promise<LocalAiPrepareResult> {
  const root = path.join(app.getPath('userData'), 'local-ai');
  const binDir = path.join(root, 'bin');
  const modelsDir = path.join(root, 'models');

  try {
    send({ phase: 'init', percent: 5 });
    await sleep(350);
    send({ phase: 'dirs', percent: 20 });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });
    await sleep(450);
    send({ phase: 'platform', percent: 40 });
    await sleep(300);

    const url = process.env.CALMMAIL_LLAMA_SERVER_EXE_URL?.trim();
    if (url?.startsWith('https://')) {
      send({ phase: 'download', percent: 55 });
      const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
      const dest = path.join(binDir, exeName);
      await downloadHttpsToFile(url, dest);
      send({ phase: 'verify', percent: 88 });
      await sleep(250);
      send({ phase: 'done', percent: 100 });
      return { ok: true };
    }

    send({ phase: 'verify', percent: 75 });
    fs.writeFileSync(
      path.join(modelsDir, 'README.txt'),
      [
        'CalmMail local-ai folder.',
        'Place .gguf model files here.',
        'Optional: set CALMMAIL_LLAMA_SERVER_EXE_URL in the app environment to auto-download llama-server on setup.',
      ].join('\n'),
      'utf-8',
    );
    await sleep(400);
    send({ phase: 'done', percent: 100 });
    return { ok: true, skippedBinaryDownload: true };
  } catch (err) {
    send({ phase: 'error', percent: 0 });
    return { ok: false, error: (err as Error).message };
  }
}

function downloadHttpsToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const file = fs.createWriteStream(tmp);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close((closeErr) => {
            if (closeErr) {
              reject(closeErr);
              return;
            }
            try {
              fs.renameSync(tmp, dest);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          });
        });
      })
      .on('error', (e) => {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        reject(e);
      });
    file.on('error', (e) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      reject(e);
    });
  });
}
