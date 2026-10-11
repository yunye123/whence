/**
 * 快捷键清单：帮助对话框与键盘处理共用这一份描述（FD-m1，DESIGN_SYSTEM §6.26）。
 *
 * 每一项写明“按什么”（chords，可有多种等价按法）和“在哪一组讲”（收集 / 整理 / 阅读与观看 / 写作 / 交付 / 随时）。
 * 只登记真正生效的按键：全局键在 App 的键盘处理里，a / g / c / Ctrl O 在底部工具条（CanvasToolbar）里；
 * “阅读与观看”组是面板与原图查看器里的上下文按键（TextSourceSection、TranscriptPanel、VideoMediaPanel、
 * ImagePreviewDialog）。§6.28 的 d（文稿）在键盘处理接上以后再登记。
 * `matchesShortcut` 让键盘处理按同一份清单判断，二者不会再写成两份不一致的描述。
 *
 * 写法（CHROME-19）：按键角标（kbd）逐键分开，一行文字用 `shortcutLabel`（“Ctrl K”）；按钮的 title 用
 * `withShortcut`，半角括号、键之间用 +（“撤销 (Ctrl+Z)”，与 K5 的 title 同一种写法）。空格键写“空格”。
 */

export type ShortcutGroup = 'collect' | 'organize' | 'read' | 'write' | 'deliver' | 'anytime';

/** 一个按法：修饰键 + 主键。`mod` 在 Windows/Linux 是 Ctrl，在 macOS 是 ⌘。 */
export interface ShortcutChord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** 按住不放才生效（空格平移、Alt 跳过吸附）。 */
  hold?: boolean;
}

export interface ShortcutDef {
  id: string;
  label: string;
  group: ShortcutGroup;
  chords: readonly ShortcutChord[];
  /** 帮助里写在按键后的补充，例如“Shift 加速”。 */
  note?: string;
  /** 只在桌面版生效（浏览器把 Ctrl N 留给“新窗口”，页面拿不到）；浏览器版的帮助不列出。 */
  desktopOnly?: boolean;
}

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroup; title: string; summary: string }[] = [
  { id: 'collect', title: '收集', summary: '把文件拖进画布，或粘贴链接与文字。视频、文字资料和图片都会变成卡片，原样保留来源。' },
  { id: 'organize', title: '整理', summary: '拖动卡片，用分组圈起相关的素材；从卡片边上的圆点拖出连线，标出它们的关系。' },
  { id: 'read', title: '阅读与观看', summary: '展开一篇文字资料、一段视频或一张原图以后，这些按键在里面生效。' },
  { id: 'write', title: '写作', summary: '在逐字稿或原文里选中句子摘到画布，再写进文稿。每一处引用都系着出处，点一下回到原片或原文。' },
  { id: 'deliver', title: '交付', summary: '文稿导出为带脚注的 Markdown，分组里的图片可以导出成灵感板。整块画布可以另存为便携文件。' },
  { id: 'anytime', title: '随时', summary: '' },
];

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'search', label: '搜索与命令', group: 'collect', chords: [{ key: 'k', mod: true }] },
  { id: 'paste', label: '粘贴链接、文字或文件', group: 'collect', chords: [{ key: 'v', mod: true }] },
  { id: 'add-note', label: '新建笔记', group: 'collect', chords: [{ key: 'n' }] },
  { id: 'add-menu', label: '打开“添加”菜单', group: 'collect', chords: [{ key: 'a' }] },
  { id: 'pick-files', label: '导入本机文件', group: 'collect', chords: [{ key: 'o', mod: true }] },
  { id: 'new-board', label: '新建画布', group: 'collect', chords: [{ key: 'n', mod: true }], desktopOnly: true },

  { id: 'tool-select', label: '选择', group: 'organize', chords: [{ key: 'v' }] },
  { id: 'tool-hand', label: '平移', group: 'organize', chords: [{ key: 'h' }, { key: ' ', hold: true }] },
  { id: 'fit', label: '查看全部', group: 'organize', chords: [{ key: 'f' }] },
  { id: 'tool-connect', label: '连线', group: 'organize', chords: [{ key: 'c' }], note: '依次点两张卡片' },
  // CORE-16: Enter on the selected card (App) or on its sidebar entry (MaterialsLibrary) opens it, like a double click.
  { id: 'open-card', label: '打开选中的卡片', group: 'organize', chords: [{ key: 'Enter' }], note: '侧栏条目同样' },
  { id: 'select-all', label: '全选卡片', group: 'organize', chords: [{ key: 'a', mod: true }] },
  { id: 'add-frame', label: '添加分组', group: 'organize', chords: [{ key: 'g' }] },
  { id: 'group', label: '把选中卡片放进一个分组', group: 'organize', chords: [{ key: 'g', mod: true }] },
  { id: 'duplicate', label: '复制卡片', group: 'organize', chords: [{ key: 'd', mod: true }] },
  { id: 'nudge', label: '移动选中卡片', group: 'organize', chords: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }, { key: 'ArrowUp' }, { key: 'ArrowDown' }], note: 'Shift 每次 10 px' },
  { id: 'skip-snap', label: '拖动时不吸附', group: 'organize', chords: [{ key: 'Alt', hold: true }] },
  { id: 'delete', label: '移除选中卡片', group: 'organize', chords: [{ key: 'Delete' }, { key: 'Backspace' }] },

  { id: 'excerpt', label: '摘下选中的句子', group: 'read', chords: [{ key: 'e' }] },
  { id: 'select-sentence', label: '按句选择（阅读）', group: 'read', chords: [{ key: 'ArrowUp', alt: true }, { key: 'ArrowDown', alt: true }], note: '加 Shift 扩选' },
  { id: 'back-to-excerpt', label: '回到刚才的摘录（阅读）', group: 'read', chords: [{ key: 'ArrowLeft', alt: true }] },
  { id: 'play-pause', label: '播放或暂停（观看）', group: 'read', chords: [{ key: ' ' }] },
  { id: 'step-sentence', label: '上一句、下一句（观看）', group: 'read', chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }] },
  { id: 'viewer-step', label: '上一张、下一张（原图）', group: 'read', chords: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
  { id: 'viewer-zoom', label: '放大、缩小（原图）', group: 'read', chords: [{ key: '+' }, { key: '-' }], note: '0 适应窗口，1 原始大小' },

  { id: 'add-draft', label: '新建文稿', group: 'write', chords: [{ key: 't' }] },
  { id: 'undo', label: '撤销', group: 'write', chords: [{ key: 'z', mod: true }] },
  { id: 'redo', label: '重做', group: 'write', chords: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] },

  { id: 'save', label: '保存到本机', group: 'deliver', chords: [{ key: 's', mod: true }] },

  { id: 'help', label: '使用指南', group: 'anytime', chords: [{ key: '?' }] },
  { id: 'escape', label: '逐层退出：对话框、菜单、输入框、面板', group: 'anytime', chords: [{ key: 'Escape' }] },
];

export const shortcutById = (id: string): ShortcutDef | undefined => SHORTCUTS.find(item => item.id === id);

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad/i.test(platform);
}

const KEY_NAMES: Record<string, string> = {
  ' ': '空格', Escape: 'Esc', Delete: 'Delete', Backspace: 'Backspace', Alt: 'Alt', '-': '−',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter',
};

/** 按键的显示文字，逐个键返回，界面把每个键画成一枚 kbd。 */
export function chordKeys(chord: ShortcutChord, mac = isMacPlatform()): string[] {
  const keys: string[] = [];
  if (chord.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (chord.shift) keys.push(mac ? '⇧' : 'Shift');
  if (chord.alt && chord.key !== 'Alt') keys.push(mac ? '⌥' : 'Alt');
  const name = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  keys.push(chord.key === 'Alt' && mac ? '⌥' : name);
  return keys;
}

/** 一行文字形式，例如 “Ctrl Shift Z”。用于命令面板右侧、按钮里的 kbd 与说明文字。 */
export function chordLabel(chord: ShortcutChord, mac = isMacPlatform()): string {
  return chordKeys(chord, mac).join(mac ? '' : ' ');
}

export function shortcutLabel(id: string, mac = isMacPlatform()): string | undefined {
  const chord = shortcutById(id)?.chords[0];
  return chord ? chordLabel(chord, mac) : undefined;
}

/** 按钮 title 的写法：“撤销 (Ctrl+Z)”“上一句 (↑)”（半角括号，键之间用 +；macOS 写 ⌘Z）。 */
export function chordTitle(label: string, chord: ShortcutChord, mac = isMacPlatform()): string {
  return `${label} (${chordKeys(chord, mac).join(mac ? '' : '+')})`;
}

/** 同上，按清单里的 id 取第一种按法；id 不在清单里时只返回文字。 */
export function withShortcut(label: string, id: string, mac = isMacPlatform()): string {
  const chord = shortcutById(id)?.chords[0];
  return chord ? chordTitle(label, chord, mac) : label;
}

/** 帮助里列出的按键：桌面专属的键只在桌面版列出。 */
export function visibleShortcuts(desktop: boolean): readonly ShortcutDef[] {
  return desktop ? SHORTCUTS : SHORTCUTS.filter(item => !item.desktopOnly);
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** 键盘处理用：事件是否命中某一项的任一按法（按住类只比较主键）。`?` 本身需要 Shift，不额外要求。 */
export function matchesShortcut(event: KeyLike, id: string): boolean {
  const def = shortcutById(id);
  if (!def) return false;
  const mod = event.ctrlKey || event.metaKey;
  return def.chords.some(chord => {
    const key = chord.key.length === 1 ? event.key.toLowerCase() === chord.key.toLowerCase() : event.key === chord.key;
    if (!key) return false;
    if (chord.hold) return true;
    if (!!chord.mod !== mod) return false;
    if (chord.key !== '?' && !chord.key.startsWith('Arrow') && !!chord.shift !== event.shiftKey) return false;
    if (chord.key !== 'Alt' && !!chord.alt !== event.altKey) return false;
    return true;
  });
}
