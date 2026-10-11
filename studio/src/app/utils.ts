export const clone = <T,>(value:T):T => structuredClone(value);
export const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], .tiptap');

/**
 * Browser and system errors in plain Chinese with a next step (CORE-25). Messages the app wrote itself (Chinese) pass
 * through; the common DOMException names and a failed fetch get a reason; any other English text is only logged.
 */
const KNOWN_ERRORS: Record<string, string> = {
  NotAllowedError: '系统没有允许这个操作。请在弹出的提示里允许，或检查权限后再试',
  SecurityError: '浏览器不允许这个操作。请换用来处桌面版再试',
  QuotaExceededError: '本机存储空间不够了。请清理磁盘，或导出并移除不用的画布后再试',
  AbortError: '操作已取消',
  NotFoundError: '找不到这个文件，它可能已被移动或删除。请重新选择',
  NotReadableError: '这个文件读不出来，可能正被其他程序占用。关掉占用它的程序后再试',
  DataCloneError: '这份内容无法保存。请重试，或导出画布备份',
};

export const errorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (KNOWN_ERRORS[name]) { logOriginal(error); return KNOWN_ERRORS[name]; }
  if (/[㐀-鿿]/.test(raw)) return raw;
  logOriginal(error);
  if (error instanceof TypeError && /fetch|network|load failed/i.test(raw)) return '网络没有连上。请检查网络后再试';
  if (/quota/i.test(raw)) return KNOWN_ERRORS.QuotaExceededError;
  return '操作没有完成。请重试；如果反复出现，先导出画布备份';
};

function logOriginal(error: unknown) {
  try { console.warn('[来处]', error); } catch { /* console unavailable */ }
}
