/**
 * Tray icon + menu.
 *
 * The tray is the canonical entry point into the app. Closing the window
 * does NOT quit the app — it just hides. Quit happens explicitly from the
 * tray menu.
 */

import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron';
import * as path from 'node:path';
import { monitorScheduler } from './modules/monitor/scheduler';

let tray: Tray | null = null;

interface BindOptions {
  getWindow: () => BrowserWindow | null;
  showWindow: () => void;
}

export function createTray(opts: BindOptions): Tray {
  if (tray) return tray;

  // Tray uses a small (24px) PNG. On Windows this maps to the system tray
  // glyph; on macOS we'd switch to a template image (TODO).
  const iconPath = path.join(app.getAppPath(), 'resources/icons/tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (process.platform === 'win32') {
    // Windows likes the .ico for HiDPI tray rendering. Fall back to PNG if
    // the .ico can't be loaded for any reason.
    const ico = nativeImage.createFromPath(
      path.join(app.getAppPath(), 'resources/icons/app.ico'),
    );
    if (!ico.isEmpty()) image = ico;
  }
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('CalmMail');

  const refreshMenu = () => {
    if (!tray) return;
    const menu = Menu.buildFromTemplate([
      { label: 'Open CalmMail', click: () => opts.showWindow() },
      { type: 'separator' },
      {
        label: 'Check inbox now',
        click: () => { void monitorScheduler.runNow(); },
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]);
    tray.setContextMenu(menu);
  };

  refreshMenu();
  tray.on('click', () => opts.showWindow());
  tray.on('double-click', () => opts.showWindow());

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
