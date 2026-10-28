import { isToolGapMessage, missingToolsMessage, TRANSCRIPTION_GATES } from '../../native/transcription-readiness';
import type { ToastOptions } from '../shell/Toasts';
import { requestMediaTools } from './media-tools-open';

/** The same check the desktop already runs. Absent in a browser, so the caller continues and the service explains later. */
export async function desktopTranscriptionGap(): Promise<string | null> {
  const diagnostics = typeof window === 'undefined' ? undefined : window.studio?.diagnostics;
  if (typeof diagnostics !== 'function') return null;
  try {
    const tools = await diagnostics();
    return missingToolsMessage(tools.checks, TRANSCRIPTION_GATES);
  } catch {
    return '没有检查成本机的转写工具。请打开侧栏「本机工具」再检查一次。';
  }
}

export function toolGapToast(message: string, key: string): ToastOptions | null {
  if (!isToolGapMessage(message) && !message.startsWith('没有检查成本机的转写工具')) return null;
  return {
    tone: 'error',
    key,
    action: { label: '本机工具', ariaLabel: '打开本机工具', onAction: () => requestMediaTools() },
  };
}
