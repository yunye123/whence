/**
 * Local transcription progress in words a creator reads (CORE-12, §6.8 “转写中 0:12 / 2:41”). The worker reports
 * device, batch size and raw GPU errors; those belong in the log, not on the card or the watch page.
 */
const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

export const TRANSCRIBE_STARTING = '正在准备本机转写…';

export function transcribeProgressMessage(message: string, durationSeconds?: number): string {
  const text = (message ?? '').trim();
  const reached = /已转写到\s*([\d.]+)\s*秒/.exec(text);
  if (reached) {
    const seconds = Number(reached[1]);
    const total = Number.isFinite(durationSeconds) && durationSeconds! > 0 ? ` / ${clock(durationSeconds!)}` : '';
    return `转写中 ${clock(seconds)}${total}`;
  }
  if (/加载本地模型|加载本机模型|正在本机生成逐字稿|等待生成逐字稿|已提交本[地机]转写任务/.test(text)) return TRANSCRIBE_STARTING;
  if (/GPU 尝试失败|降低负载重试/.test(text)) return '换一种方式继续转写…';
  // Anything else: drop device and batch details and raw error tails, keep the sentence.
  return text.replace(/[（(]\s*(?:cuda|cpu|gpu)[^）)]*[）)]/gi, '').replace(/[:：]\s*(?:cuda|cpu)\s*\/\s*batch\s*\d+/gi, '').trim() || TRANSCRIBE_STARTING;
}
