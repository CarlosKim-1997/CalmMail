/**
 * Local AI Manager.
 *
 * Owns the state shared by both local lanes:
 *   - "Is Ollama up?" — probed at startup and on manual refresh; passed
 *     to `ollamaProvider` so it doesn't probe per request.
 *   - "Is the managed runtime ready / healthy?" — derived from prefs +
 *     `llamacppRuntime` artifact + process state.
 *
 * The manager itself is stateless beyond a single cached probe; the real
 * lifecycle (download, spawn, kill on quit) lives in
 * `llamacppRuntime.ts`.
 */

import {
  isOllamaDetected,
  probeOllama,
  setOllamaDetected,
} from '@main/modules/ai/providers/ollamaProvider';
import {
  isManagedReady,
  isServerRunning,
  stopServer,
} from './llamacppRuntime';
import { preferencesMemory } from '@main/modules/memory/preferences';

async function refreshOllama(): Promise<boolean> {
  const up = await probeOllama();
  setOllamaDetected(up);
  return up;
}

export const localAiManager = {
  async init(): Promise<void> {
    // Best-effort: refresh Ollama state once at boot so the advanced
    // path is reactive without per-call probing. Managed runtime does
    // not require boot-time work; it spawns lazily on first briefing.
    await refreshOllama();
  },

  isOllamaDetected(): boolean {
    return isOllamaDetected();
  },

  /**
   * @deprecated Use {@link isOllamaDetected}. Kept until Phase 3 retires
   * the existing IPC handler `localAi:refreshOllama` callers.
   */
  isRuntimeDetected(): boolean {
    return isOllamaDetected();
  },

  async refresh(): Promise<boolean> {
    return refreshOllama();
  },

  /** True when the managed binary + chosen model are both on disk. */
  isManagedReady(): boolean {
    const prefs = preferencesMemory.get();
    return isManagedReady(prefs.localAiModelId);
  },

  /** True when an active llama-server child process exists. */
  isManagedServerRunning(): boolean {
    return isServerRunning();
  },

  /** Called from `electron/main.ts` on `before-quit`. */
  async shutdown(): Promise<void> {
    if (isServerRunning()) {
      await stopServer();
    }
  },
};
