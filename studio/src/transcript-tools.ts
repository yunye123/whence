import { uid, type CardData, type TranscriptLine } from './model';

/** Missing versions in schema 1 refer to the text before its first manual edit. */
export const INITIAL_TRANSCRIPT_REVISION = 'initial';
export const MAX_TRANSCRIPT_TEXT_LENGTH = 20_000;

export function transcriptRevision(data: Pick<CardData, 'transcriptRevision'> | undefined): string {
  return data?.transcriptRevision ?? INITIAL_TRANSCRIPT_REVISION;
}

function validateEditedText(text: string): void {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TRANSCRIPT_TEXT_LENGTH || text.includes('\u0000')) {
    throw new Error('逐字稿文字不能为空，不能包含空字符，且每句不能超过 20,000 个字符。');
  }
}

/** Change one sentence without changing timing, line identity or any citation snapshot. */
export function editTranscriptLine(data: CardData, lineId: string, text: string): Partial<CardData> {
  validateEditedText(text);
  const line = data.transcript?.find(item => item.id === lineId);
  if (!line || line.text === text) return {};
  const originalText = line.originalText ?? line.text;
  const changed: TranscriptLine = { ...line, text };
  if (text === originalText) delete changed.originalText;
  else changed.originalText = originalText;
  // The stored Chinese translation belongs to the previous sentence.
  delete changed.translation;
  return {
    transcript: data.transcript!.map(item => item.id === lineId ? changed : item),
    transcriptRevision: uid(),
  };
}

/** Restore the first saved text; existing excerpts remain their original snapshots. */
export function restoreTranscriptLine(data: CardData, lineId: string): Partial<CardData> {
  const line = data.transcript?.find(item => item.id === lineId);
  if (!line || line.originalText === undefined) return {};
  const restored: TranscriptLine = { ...line, text: line.originalText };
  delete restored.originalText;
  if (restored.text !== line.text) delete restored.translation;
  return {
    transcript: data.transcript!.map(item => item.id === lineId ? restored : item),
    ...(line.text !== restored.text ? { transcriptRevision: uid() } : {}),
  };
}

function replacementLines(lines: readonly TranscriptLine[]): TranscriptLine[] {
  if (!Array.isArray(lines) || lines.length > 10_000) throw new Error('逐字稿条目不能超过 10,000 条，且必须是有效的字幕列表。');
  const identifiers = new Set<string>();
  return lines.map(line => {
    if (!line || typeof line !== 'object' || Array.isArray(line)
      || Object.keys(line).some(key => !['id', 'start', 'end', 'text', 'originalText'].includes(key))) {
      throw new Error('逐字稿条目包含不支持的字段。');
    }
    if (typeof line.id !== 'string' || !line.id.trim() || line.id.length > 160 || line.id.includes('\u0000') || identifiers.has(line.id)) {
      throw new Error('逐字稿条目 ID 为空、重复或格式不正确。');
    }
    identifiers.add(line.id);
    validateEditedText(line.text);
    milliseconds(line.start); milliseconds(line.end);
    if (line.end <= line.start) throw new Error('逐字稿结束时间须晚于开始时间。');
    // Replacing the subtitle source establishes a new baseline; no old edit marker follows it.
    return { id: line.id, start: line.start, end: line.end, text: line.text };
  });
}

/** An explicit subtitle import/retranscription establishes its own text and version. */
export function replaceTranscript(_data: CardData, lines: readonly TranscriptLine[]): Partial<CardData> {
  return { transcript: replacementLines(lines), transcriptRevision: uid() };
}

/** Keep a line's Chinese when a later automatic write has the same id and the same English. */
function withKeptTranslations(current: CardData, lines: readonly TranscriptLine[]): TranscriptLine[] {
  const next = replacementLines(lines);
  const previous = new Map((current.transcript ?? []).filter(line => line.translation).map(line => [line.id, line]));
  if (!previous.size) return next;
  return next.map(line => {
    const old = previous.get(line.id);
    return old?.translation && old.text === line.text ? { ...line, translation: old.translation } : line;
  });
}

/** Merge background task results without letting an old recognizer overwrite manual text. */
export function mergeAutomaticTranscript(current: CardData, incoming: Partial<CardData>, assetChanged: boolean): Partial<CardData> {
  const patch = { ...incoming };
  if (assetChanged) {
    patch.transcript = withKeptTranslations(current, incoming.transcript ?? []);
    patch.transcriptRevision = undefined;
  } else if (transcriptRevision(current) !== INITIAL_TRANSCRIPT_REVISION) {
    delete patch.transcript;
    delete patch.transcriptRevision;
  } else {
    delete patch.transcriptRevision;
    if (incoming.transcript !== undefined) patch.transcript = withKeptTranslations(current, incoming.transcript);
  }
  return patch;
}

function milliseconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 604_800) throw new Error('逐字稿时间超出有效范围。');
  return Math.round(seconds * 1000);
}

function clock(milliseconds: number, separator: ',' | '.'): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(milliseconds % 1000).padStart(3, '0')}`;
}

/** Uses exactly the provided sentences, so UI search cannot silently narrow an export. */
export function transcriptToText(lines: readonly TranscriptLine[], options: { timestamps?: boolean } = {}): string {
  return lines.map(line => options.timestamps
    ? `[${clock(milliseconds(line.start), '.')} – ${clock(milliseconds(line.end), '.')}] ${line.text}`
    : line.text).join('\n');
}

/**
 * SRT uses current text, chronological cue order and whole-millisecond timestamps.
 * Paragraph separators become single newlines. Players may interpret subtitle markup
 * and entities; use transcriptToText when every literal character must be retained.
 */
export function transcriptToSrt(lines: readonly TranscriptLine[]): string {
  const cues = lines.map((line, index) => {
    if (line.end <= line.start) throw new Error('逐字稿结束时间须晚于开始时间。');
    // Preserve a positive cue duration even for a source interval shorter than 1 ms.
    const end = Math.max(1, milliseconds(line.end));
    const start = Math.min(milliseconds(line.start), end - 1);
    const text = line.text.replace(/\r\n?/g, '\n').replace(/\n[\t ]*\n(?:[\t ]*\n)*/g, '\n');
    return { start, index, end, text };
  }).sort((a, b) => a.start - b.start || a.index - b.index);
  return cues.map((cue, index) => `${index + 1}\n${clock(cue.start, ',')} --> ${clock(cue.end, ',')}\n${cue.text}\n`).join('\n');
}
