import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc';
import type { BillingApplyResult } from '@shared/types';

type WindowProvider = () => BrowserWindow | null;

let getWindow: WindowProvider | null = null;

export function bindBillingWindowProvider(provider: WindowProvider): void {
  getWindow = provider;
}

export function notifyBillingChanged(result: BillingApplyResult): void {
  const win = getWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.evtBillingChanged, result);
  }
}
