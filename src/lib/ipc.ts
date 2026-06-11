/**
 * Typed wrapper around the preload bridge. The renderer should ONLY talk to
 * the main process through this module.
 */

import type { IpcContract } from '@shared/ipc';
import { IpcChannels } from '@shared/ipc';

type CalmApi = {
  invoke<K extends keyof IpcContract>(
    channel: K,
    payload?: IpcContract[K]['req'],
  ): Promise<IpcContract[K]['res']>;
  on<P = unknown>(channel: string, listener: (payload: P) => void): () => void;
  channels: typeof IpcChannels;
};

declare global {
  interface Window {
    calm: CalmApi;
  }
}

export const ipc = {
  invoke<K extends keyof IpcContract>(
    channel: K,
    payload?: IpcContract[K]['req'],
  ): Promise<IpcContract[K]['res']> {
    return window.calm.invoke(channel, payload);
  },

  on<P = unknown>(channel: string, listener: (payload: P) => void): () => void {
    return window.calm.on<P>(channel, listener);
  },

  channels: IpcChannels,
};
