export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'field-appearance-v1';
export function getThemePreference(): ThemePreference {
  try { const saved = localStorage.getItem(key); return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'; } catch { return 'system'; }
}
export function applyTheme(preference: ThemePreference): 'light' | 'dark' {
  const theme = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; return theme;
}
export function saveThemePreference(preference: ThemePreference) {
  applyTheme(preference); try { localStorage.setItem(key, preference); } catch { /* Theme remains usable when local storage is denied. */ }
}
