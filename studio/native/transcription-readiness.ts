/**
 * Turns the checks from `detectTools` into sentences a person can act on.
 * It does not look for programs, install them, or download a model.
 */
export interface ToolCheckLike { name: string; ok: boolean }

/** Items that stop a transcription before the worker starts. Names match `detectTools`. */
export const TRANSCRIPTION_GATES = ['Python', 'FFmpeg', 'ffprobe', '链接下载器', '转写依赖', '本地模型'] as const;

/** Bilibili and YouTube downloads use these before yt-dlp runs. Douyin and Xiaohongshu are not in this list. */
export const YT_DLP_DOWNLOAD_GATES = ['Python', 'FFmpeg', 'ffprobe', '链接下载器'] as const;

/** importMedia probes and draws frames with these. Checked before that call so a missing binary is not a process error. */
export const IMPORT_MEDIA_GATES = ['FFmpeg', 'ffprobe'] as const;

const REMEDY: Record<string, { item: string; how: string }> = {
  Python: {
    item: 'Python',
    how: '打开侧栏「本机工具」，填上这台电脑的 Python 3.12 并保存。用安装程序时，先双击安装目录里的「安装并检查」。',
  },
  FFmpeg: {
    item: 'FFmpeg',
    how: '在侧栏「本机工具」填上 FFmpeg 的位置并保存。它和 ffprobe 通常在同一文件夹。',
  },
  ffprobe: {
    item: 'ffprobe',
    how: '在侧栏「本机工具」填上 ffprobe 的位置并保存，和 FFmpeg 放在一起。',
  },
  链接下载器: {
    item: 'yt-dlp',
    how: '在「本机工具」所填的 Python 里安装 yt-dlp，或双击安装目录里的「安装并检查」。来处不会替你安装。',
  },
  转写依赖: {
    item: 'faster-whisper',
    how: '在「本机工具」所填的 Python 里安装 faster-whisper，或双击安装目录里的「安装并检查」。来处不会替你安装。',
  },
  本地模型: {
    item: 'faster-whisper 模型',
    how: '在侧栏「本机工具」填上模型目录并保存。目录里要有 model.bin、config.json 和 tokenizer.json。来处不会下载模型。',
  },
};

const GAP_ITEM = /缺 (?:Python|FFmpeg|ffprobe|yt-dlp|faster-whisper)(?: 模型)?。/;

/** The sentence under a failed check in 本机工具. Unknown names have no sentence. */
export function toolRemedy(name: string): string | undefined {
  return REMEDY[name]?.how;
}

/** Person-facing name for a detectTools check. Unknown names stay as reported. */
export function toolCheckLabel(name: string): string {
  return REMEDY[name]?.item ?? name;
}

/** One sentence per failed check, in `names` order. Passed checks and unknown names are left out. */
export function missingToolSentences(checks: readonly ToolCheckLike[], names: readonly string[]): string[] {
  const failed = new Set(checks.filter(check => !check.ok).map(check => check.name));
  return names.flatMap(name => {
    if (!failed.has(name)) return [];
    const remedy = REMEDY[name];
    return remedy ? [`缺 ${remedy.item}。${remedy.how}`] : [];
  });
}

/** Null when every named check passed or was not reported. Technical check details are not copied in. */
export function missingToolsMessage(checks: readonly ToolCheckLike[], names: readonly string[]): string | null {
  const sentences = missingToolSentences(checks, names);
  return sentences.length ? sentences.join('') : null;
}

export function isToolGapMessage(message: string): boolean {
  return GAP_ITEM.test(message);
}
