/**
 * Reading lines for a local transcript (CORE-06). Whisper cuts its segments where its decoding window ends, often in
 * the middle of a word (“无 / 论”), so one segment per line reads as broken half-sentences. The worker already returns
 * every word with its own time; this regroups the words of the whole transcript into lines:
 * - a line ends at sentence punctuation, at a pause longer than 0.35 s, or (long monologue) at the next short pause
 *   after 8 s, never later than 12 s;
 * - a word never crosses lines (lines are made of whole words);
 * - a line shorter than 1.5 s or with fewer than 4 characters joins the neighbour it is closer to in time.
 * FIELD's own worker gives Chinese speech punctuation (native/workers/transcribe.py). When the words carry marks:
 * - a pause just after the first word or two of a new clause (“……对打，还是 ⏸ 贴地……”) does not leave them at the end
 *   of the line: they start the next one;
 * - a 12 s cut falls on a comma before anything else;
 * - a sentence longer than 8 s or 42 characters is split at the comma nearest its middle.
 * Unpunctuated transcripts (older ones, the legacy worker) are grouped exactly as before.
 * Proofread segments (a correction is stored for their id) keep their own line and text. Segments without word times
 * stay as they are. Pure: no Node or DOM imports, used by the desktop service and the browser-side mapping.
 */
export interface TimedWord { text: string; startMs: number; endMs: number }
export interface WordSegment { id: string; text: string; startMs: number; endMs: number; words?: readonly TimedWord[] }
export interface ReadingLine { id: string; start: number; end: number; text: string }

const PAUSE_MS = 350;
const SOFT_LIMIT_MS = 8_000;
const SOFT_PAUSE_MS = 150;
const HARD_LIMIT_MS = 12_000;
const SHORT_MS = 1_500;
const SHORT_CHARS = 4;
const LONG_CHARS = 42;
const PART_CHARS = 8;
const TAIL_WORDS = 2;
const TAIL_CHARS = 4;
const SENTENCE_END = /[。！？!?；;…]["”’』」)）]*\s*$/;
/** A clause mark inside a sentence: comma or colon. Lines may break there. */
const CLAUSE_END = /[，,：:﹐]["”’』」)）]*\s*$/;
/** The enumeration comma separates the items of a list (“动作、景深、运镜”): it is punctuation, but lists do not split. */
const LIST_END = /[、﹑]["”’』」)）]*\s*$/;
const marked = (word: TimedWord) => SENTENCE_END.test(word.text) || CLAUSE_END.test(word.text) || LIST_END.test(word.text);
const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';

/** Join word texts: Whisper puts a leading space on Western words; spaces between CJK characters are dropped. */
function joinWords(words: readonly TimedWord[]): string {
  return words.map(word => word.text).join('')
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g'), '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const characters = (text: string) => [...text.replace(/[\s\p{P}]/gu, '')].length;

interface Word extends TimedWord { segment: number; index: number }
interface Group { words: Word[] }

const CONNECTIVES = ['然后', '所以', '但是', '而且', '并且', '如果', '因为', '同时', '不管', '只要', '那么', '另外', '最后', '首先', '接着', '于是', '其实', '比如', '甚至', '这就', '这样', '你只需要', '你可以', '我们'];
const PARTICLE_END = /[了吧呢啊吗呀哦]$/;

/** How likely a clause boundary is right after `current[at]` (0: no sign of one). */
function clauseScore(current: readonly Word[], at: number, following: Word | undefined): number {
  if (!following) return 0;
  const before = current.slice(Math.max(0, at - 3), at + 1).map(word => word.text).join('').trim();
  let after = following.text;
  for (let index = current.indexOf(following) + 1; index > 0 && index < current.length && after.length < 6; index++) after += current[index].text;
  after = after.trim();
  let score = Math.max(0, following.startMs - current[at].endMs) / 100;
  if (CLAUSE_END.test(current[at].text)) score += 4;
  if (CONNECTIVES.some(word => after.startsWith(word))) score += 3;
  if (PARTICLE_END.test(before)) score += 2;
  return score;
}

/** Length of a run of words as read: its time span and its characters (punctuation and spaces not counted). */
const span = (words: readonly Word[]) => words[words.length - 1].endMs - words[0].startMs;

/**
 * A sentence longer than 8 s or 42 characters splits at the clause mark nearest its middle (by characters), as long as
 * both parts keep at least 1.5 s and 8 characters; each part is checked again.
 */
function splitLong(words: Word[]): Word[][] {
  const total = characters(joinWords(words));
  if (span(words) <= SOFT_LIMIT_MS && total <= LONG_CHARS) return [words];
  let best = -1, distance = Infinity, read = 0;
  for (let at = 0; at < words.length - 1; at++) {
    read += characters(words[at].text);
    if (!CLAUSE_END.test(words[at].text)) continue;
    const left = words.slice(0, at + 1), right = words.slice(at + 1);
    if (span(left) < SHORT_MS || span(right) < SHORT_MS || read < PART_CHARS || total - read < PART_CHARS) continue;
    if (Math.abs(read - total / 2) < distance) { distance = Math.abs(read - total / 2); best = at; }
  }
  return best < 0 ? [words] : [...splitLong(words.slice(0, best + 1)), ...splitLong(words.slice(best + 1))];
}

function groupWords(words: Word[]): Group[] {
  const groups: Group[] = [];
  const punctuated = words.some(marked);
  let current: Word[] = [];
  words.forEach((word, position) => {
    current.push(word);
    const next = words[position + 1];
    const elapsed = word.endMs - current[0].startMs;
    const gap = next ? next.startMs - word.endMs : Infinity;
    if (!next || SENTENCE_END.test(word.text) || gap > PAUSE_MS || (elapsed >= SOFT_LIMIT_MS && gap >= SOFT_PAUSE_MS)) {
      // With punctuation, a speaker who stops right after the first word or two of a clause (“……对打，还是 ⏸ 贴地……”)
      // does not leave them at the end of a line: the cut moves to the mark before them, or (the mark closed the
      // previous line) there is no cut and they begin the line that follows.
      let cut = current.length;
      if (punctuated && next && !marked(word)) {
        let mark = current.length - 1;
        while (mark >= 0 && !marked(current[mark])) mark--;
        const tail = current.slice(mark + 1);
        if (tail.length <= TAIL_WORDS && characters(joinWords(tail)) <= TAIL_CHARS) {
          if (mark < 0) return;
          cut = mark + 1;
        }
      }
      groups.push({ words: current.slice(0, cut) });
      current = current.slice(cut);
    } else if (elapsed >= HARD_LIMIT_MS) {
      // A long stretch without a real pause (Whisper's word times are often back to back): cut in its second half
      // where a new clause most likely starts — before a connective (“然后”“所以”“如果”…), after a closing particle
      // (了 吧 呢 啊 吗), or at the widest gap; the latest of equally good places wins.
      let cut = current.length - 1, best = clauseScore(current, current.length - 1, next);
      for (let at = Math.floor(current.length / 2); at < current.length - 1; at++) {
        const score = clauseScore(current, at, current[at + 1]);
        if (score >= best && score > 0) { best = score; cut = at; }
      }
      groups.push({ words: current.slice(0, cut + 1) });
      current = current.slice(cut + 1);
    }
  });
  // Short fragments join the closer neighbour (in time); repeat until none is left or nothing can merge.
  for (let changed = true; changed && groups.length > 1;) {
    changed = false;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const first = group.words[0], last = group.words[group.words.length - 1];
      if (last.endMs - first.startMs >= SHORT_MS && characters(joinWords(group.words)) >= SHORT_CHARS) continue;
      const previous = groups[index - 1], next = groups[index + 1];
      const before = previous ? first.startMs - previous.words[previous.words.length - 1].endMs : Infinity;
      const after = next ? next.words[0].startMs - last.endMs : Infinity;
      // Never glue across sentence punctuation that closes the previous line (with punctuation, any mark does: the
      // fragment is the start of the next clause).
      const previousLast = previous?.words[previous.words.length - 1];
      const previousClosed = previousLast && (punctuated ? marked(previousLast) : SENTENCE_END.test(previousLast.text));
      if (previous && !previousClosed && before <= after) { previous.words.push(...group.words); groups.splice(index, 1); changed = true; break; }
      if (next) { next.words.unshift(...group.words); groups.splice(index, 1); changed = true; break; }
      if (previous) { previous.words.push(...group.words); groups.splice(index, 1); changed = true; break; }
    }
  }
  const lines = punctuated ? groups.flatMap(group => splitLong(group.words).map(part => ({ words: part }))) : groups;
  keepWordsWhole(lines);
  return lines;
}

type WordSegmenter = { segment(input: string): Iterable<{ segment: string; index: number }> };
type SegmenterConstructor = new (locale: string, options: { granularity: 'word' }) => WordSegmenter;
const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
let segmenter: WordSegmenter | null | undefined;
/** Single characters that open a Chinese sentence far more often than they close one (“这就是…”, “另一个…”). */
const OPENERS = new Set([...'这那另此每该但而所因如若并或则从当把被让对']);
const WINDOW = 6;

/**
 * Whisper's own segment ends (and the time gaps it leaves there) often fall inside a word: “……名场面里无 / 论是……”,
 * “最 / 后”, “由 / 于”. Where a Chinese word crosses a line break — found with the word segmenter on the few
 * characters around it — or a line ends on a lone sentence opener, the line's last tokens move to the next line, which
 * is where the word is read. Tokens keep their own times.
 */
function keepWordsWhole(groups: Group[]): void {
  segmenter ??= Segmenter ? new Segmenter('zh', { granularity: 'word' }) : null;
  if (!segmenter) return;
  for (let index = 0; index + 1 < groups.length; index++) {
    const previous = groups[index], next = groups[index + 1];
    const last = previous.words[previous.words.length - 1];
    if (marked(last) || previous.words.length < 2) continue;
    const tail = [...joinWords(previous.words)].slice(-WINDOW).join(''), head = [...joinWords(next.words)].slice(0, WINDOW).join('');
    if (!new RegExp(`[${CJK}]$`).test(tail) || !new RegExp(`^[${CJK}]`).test(head)) continue;
    let move = 0;
    for (const { segment, index: at } of segmenter.segment(tail + head)) {
      const end = at + segment.length;
      if (at < tail.length && end > tail.length) { move = tail.length - at; break; }
      if (end === tail.length) { if (segment.length === 1 && OPENERS.has(segment)) move = 1; break; }
    }
    if (!move) continue;
    // Whole tokens from the end of the line that hold the moving characters (never the whole line).
    let count = 0, chars = 0;
    while (count < previous.words.length - 1 && chars < move) { count++; chars += [...previous.words[previous.words.length - count].text.trim()].length; }
    if (chars !== move) continue;
    next.words.unshift(...previous.words.splice(previous.words.length - count, count));
  }
}

export function readingLines(segments: readonly WordSegment[], corrections: Readonly<Record<string, string>> = {}): ReadingLine[] {
  const lines: ReadingLine[] = [];
  let run: Word[] = [];
  const flush = () => {
    if (!run.length) return;
    for (const group of groupWords(run)) {
      const first = group.words[0], last = group.words[group.words.length - 1];
      const segment = segments[first.segment];
      const text = joinWords(group.words);
      if (!text) continue;
      lines.push({ id: first.index === 0 ? segment.id : `${segment.id}~w${first.index}`, start: first.startMs / 1000, end: last.endMs / 1000, text });
    }
    run = [];
  };
  segments.forEach((segment, segmentIndex) => {
    const corrected = corrections[segment.id];
    const words = segment.words ?? [];
    const timed = words.length > 0 && words.every(word => typeof word.text === 'string' && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs >= word.startMs);
    if (corrected !== undefined || !timed) {
      flush();
      lines.push({ id: segment.id, start: segment.startMs / 1000, end: segment.endMs / 1000, text: corrected ?? segment.text });
      return;
    }
    words.forEach((word, index) => run.push({ ...word, segment: segmentIndex, index }));
  });
  flush();
  return lines;
}
