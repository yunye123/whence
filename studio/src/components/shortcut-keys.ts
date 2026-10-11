import { shortcutLabel } from '../dialogs/shortcuts';

/**
 * The keys of a shortcut as the HUD shows them — “V”, “Ctrl O”, “⌘O” on a Mac — read from the one list in
 * dialogs/shortcuts.ts that the help also reads (CHROME-19). `fallback` covers an id that list does not have yet.
 * K5 titles (“选择 (V)”, “撤销 (Ctrl+Z)”) stay literal: scripts find buttons by them.
 */
export const keyOf = (id: string, fallback: string): string => shortcutLabel(id) ?? fallback;
