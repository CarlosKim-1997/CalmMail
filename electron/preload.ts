/**
 * Preload bridge.
 *
 * Exposes a typed, narrow API to the renderer. The renderer never touches
 * Node, the filesystem, or any module directly; everything goes through this
 * surface.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type IpcContract } from './shared/ipc';

type ChannelKey = keyof IpcContract;

const api = {
  invoke<K extends ChannelKey>(
    channel: K,
    payload?: IpcContract[K]['req'],
  ): Promise<IpcContract[K]['res']> {
    return ipcRenderer.invoke(channel as string, payload) as Promise<
      IpcContract[K]['res']
    >;
  },
  on<P = unknown>(
    channel: string,
    listener: (payload: P) => void,
  ): () => void {
    const wrapped = (_evt: unknown, payload: P) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  channels: IpcChannels,
};

contextBridge.exposeInMainWorld('calm', api);

export type CalmApi = typeof api;
