import type { BrowserWindow, IpcMain, IpcMainEvent, NativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CORE-29: the desktop window's own colour, shown before the page paints (cold start, while loading, resizing). It
 * follows the appearance the person chose in FIELD — light, dark, or the system's — instead of the legacy fixed
 * #181c20, so a light-mode start no longer flashes a dark window. The page keeps its choice in localStorage
 * (`field-appearance-v1`, see src/theme.ts), which the main process cannot read before the window exists; the preload
 * reports every applied theme (`reportAppearance` in preload-bridge.ts) and the choice is kept in the profile folder
 * as `field-appearance.json` for the next start. Electron objects are passed in, so this file has no runtime import.
 */
export const WINDOW_GROUND = { light: '#D2D1CE', dark: '#1A1917' } as const;
export type AppearancePreference = 'light' | 'dark' | 'system';
export const APPEARANCE_CHANNEL = 'field-appearance';
export const APPEARANCE_FILE = 'field-appearance.json';

const valid = (value: unknown): value is AppearancePreference => value === 'light' || value === 'dark' || value === 'system';

/** The saved choice; 'system' when nothing usable is saved (first start, unreadable file), as in the page. */
export function savedAppearance(directory: string): AppearancePreference {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, APPEARANCE_FILE), 'utf8'))?.preference;
    return valid(value) ? value : 'system';
  } catch { return 'system'; }
}

export function windowGround(preference: AppearancePreference, systemDark: boolean): string {
  return WINDOW_GROUND[preference === 'system' ? (systemDark ? 'dark' : 'light') : preference];
}

export function saveAppearance(directory: string, preference: AppearancePreference): void {
  const target = path.join(directory, APPEARANCE_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ preference }));
  fs.renameSync(temporary, target);
}

interface Electron { ipcMain: IpcMain; nativeTheme: NativeTheme; directory: string }

/** Keep the window colour and the saved choice in step with the page; only the window's own main frame is heard. */
export function followAppearance(window: BrowserWindow, { ipcMain, nativeTheme, directory }: Electron): void {
  let preference = savedAppearance(directory);
  const listener = (event: IpcMainEvent, value: unknown, theme: unknown) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    const next = valid(value) ? value : 'system';
    window.setBackgroundColor(theme === 'light' || theme === 'dark' ? WINDOW_GROUND[theme] : windowGround(next, nativeTheme.shouldUseDarkColors));
    if (next === preference) return;
    preference = next;
    try { saveAppearance(directory, next); } catch { /* The window opens in the system colour next time. */ }
  };
  const followSystem = () => { if (!window.isDestroyed() && preference === 'system') window.setBackgroundColor(windowGround('system', nativeTheme.shouldUseDarkColors)); };
  ipcMain.on(APPEARANCE_CHANNEL, listener);
  nativeTheme.on('updated', followSystem);
  window.once('closed', () => { ipcMain.removeListener(APPEARANCE_CHANNEL, listener); nativeTheme.removeListener('updated', followSystem); });
}
