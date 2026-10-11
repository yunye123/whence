import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, getThemePreference, saveThemePreference, type ThemePreference } from './theme';

const LABELS: Record<ThemePreference, string> = { light: '浅色', dark: '暗光', system: '跟随系统' };

/**
 * 外观（DESIGN_SYSTEM §3.1）：侧栏底部的图标按钮，图标显示当前模式。原生 `<select aria-label="外观模式">`
 * 铺满按钮、透明，键盘、读屏与脚本照常使用（K8：option 值 light / dark / system）。
 */
export default function ThemeControl() {
  const [preference, setPreference] = useState(getThemePreference);
  const [resolved, setResolved] = useState(() => preference === 'system'
    ? typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : preference);
  useEffect(() => {
    setResolved(applyTheme(preference));
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (preference === 'system') setResolved(applyTheme(preference)); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [preference]);
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <label className="appearance-control" title={`外观：${LABELS[preference]}`}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <select aria-label="外观模式" value={preference} onChange={event => { const value = event.target.value as ThemePreference; setPreference(value); saveThemePreference(value); }}>
        <option value="light">{LABELS.light}</option>
        <option value="dark">{LABELS.dark}</option>
        <option value="system">{LABELS.system}</option>
      </select>
    </label>
  );
}
