/** Opens the translation-key dialog. App binds this while it is on screen. */
let openTranslationSettings = () => {};

export function bindTranslationSettingsOpener(open: () => void): void {
  openTranslationSettings = open;
}

export function requestTranslationSettings(): void {
  openTranslationSettings();
}
