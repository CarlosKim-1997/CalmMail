import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc';

type WindowProvider = () => BrowserWindow | null;

let getWindow: WindowProvider | null = null;

export function bindAuthWindowProvider(provider: WindowProvider): void {
  getWindow = provider;
}

export function notifyAuthChanged(): void {
  const win = getWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.evtAuthChanged);
  }
}
