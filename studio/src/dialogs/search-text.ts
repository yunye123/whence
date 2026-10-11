/**
 * 命令面板的文字工具（DESIGN_SYSTEM §6.23、FD-M1）：
 * - 拼音首字母：输入 “xjbj” 命中 “新建笔记”；
 * - 命令匹配：标题、别名、拼音首字母一起比较，返回可高亮的位置；
 * - 摘要清理：去掉 Markdown 记号、内部链接与 UUID，换行合并为一段（中文行间用全角空格隔开），同时把高亮位置换算到清理后的文字上。
 */

type Range = { start: number; end: number };

// 普通话音节没有 i、u、v 开头。每个字母给出几个“该字母第一个音节”的字，运行时取排序最靠前的一个作分界：
// 不同 ICU 版本对生僻字的排位不同，取最小值比写死一个分界字稳。
const PINYIN_LETTERS = 'abcdefghjklmnopqrstwxyz';
const PINYIN_CANDIDATES = ['吖阿啊锕腌', '八巴扒叭芭疤捌', '嚓擦拆', '哒搭耷嗒答', '妸婀屙讹俄娥鹅额', '发', '旮嘎伽尕钆', '哈铪', '讥击叽饥乩圾机鸡', '咔咖喀卡', '垃拉啦邋', '痳妈嬷麻', '拏拿哪那', '噢哦喔', '妑趴啪葩', '七沏妻柒凄期欺', '呥然燃髯冉', '仨撒挲萨', '他她它铊塌溻遢', '穵挖哇娃洼蛙', '夕兮汐西吸希昔', '丫压呀押鸦鸭', '帀匝咂杂砸'];
let pinyin: { collator: Intl.Collator; bounds: string[] } | null | undefined;
const initialCache = new Map<string, string>();

function pinyinTable(): { collator: Intl.Collator; bounds: string[] } | null {
  if (pinyin !== undefined) return pinyin;
  try {
    const collator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base' });
    const bounds = PINYIN_CANDIDATES.map(chars => [...chars].sort(collator.compare)[0]);
    // 没有中文排序数据的环境会退回码点排序，分界不再递增，直接放弃首字母匹配。
    const ordered = bounds.every((bound, index) => index === 0 || collator.compare(bounds[index - 1], bound) < 0);
    pinyin = ordered && collator.compare('阿', '八') < 0 ? { collator, bounds } : null;
  } catch { pinyin = null; }
  return pinyin;
}

/** 单个汉字的拼音首字母；非汉字原样（小写）返回，保持一字对一位，方便换算高亮位置。 */
export function pinyinInitial(char: string): string {
  if (!/^[㐀-鿿]$/.test(char)) return char.toLowerCase();
  const cached = initialCache.get(char);
  if (cached) return cached;
  const table = pinyinTable();
  let letter = char;
  if (table) {
    for (let index = PINYIN_LETTERS.length - 1; index >= 0; index--) {
      if (table.collator.compare(table.bounds[index], char) <= 0) { letter = PINYIN_LETTERS[index]; break; }
    }
  }
  initialCache.set(char, letter);
  return letter;
}

/** 与原文等长（按 UTF-16 位）的首字母串：“新建 PDF” → “xj pdf”。 */
export function pinyinInitials(text: string): string {
  let result = '';
  for (const char of text) result += char.length === 1 ? pinyinInitial(char) : char.toLowerCase();
  return result;
}

const fold = (value: string) => value.normalize('NFKC').toLowerCase();

export interface TextMatch { score: number; ranges: Range[] }

/**
 * 命令或标题是否命中查询。空格分隔的每个词都要命中（与资料搜索一致）。
 * 命中方式按得分：标题开头 > 标题内 > 拼音首字母 > 别名。
 */
export function matchText(query: string, title: string, aliases: readonly string[] = []): TextMatch | null {
  const tokens = fold(query).trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return null;
  const folded = fold(title);
  const initials = pinyinInitials(title);
  const foldedAliases = aliases.map(fold);
  const ranges: Range[] = [];
  let score = 0;
  for (const token of tokens) {
    const position = folded.indexOf(token);
    if (position >= 0 && folded.length === title.length) {
      ranges.push({ start: position, end: position + token.length });
      score += position === 0 ? 40 : 30;
      continue;
    }
    if (position >= 0) { score += 28; continue; }
    if (/^[a-z]+$/.test(token)) {
      const at = initials.indexOf(token);
      if (at >= 0) {
        ranges.push({ start: at, end: at + token.length });
        score += at === 0 ? 24 : 18;
        continue;
      }
    }
    if (foldedAliases.some(alias => alias.includes(token) || (/^[a-z]+$/.test(token) && pinyinInitials(alias).includes(token)))) { score += 10; continue; }
    return null;
  }
  return { score, ranges: mergeRanges(ranges) };
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter(range => range.end > range.start).map(range => ({ ...range })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

// 需要整段去掉的内容：内部链接、Markdown 链接的地址部分、图片、UUID、行首记号、强调符号。
const REMOVE_PATTERNS: readonly RegExp[] = [
  /\[来源[:：][^\]\n]*\]\(field:\/\/[^)\s]*\)?/g,                     // 文稿里的引用指针整段去掉（出处另有签与上标）
  /(?<=^…?)[^[\]\n…]*\]\((?:field|field-media):\/\/[^)\s]*\)?/g,       // 摘要从引用指针中间截起：剩下的半个标题也去掉
  /\[来源[:：][^\]\n…]*(?:\](?:\([^)\s…]*)?)?(?=…?$)/g,               // 摘要在引用指针中间截断：去掉半个指针
  /\]\((?:field|field-media):\/\/[^)\s]*\)?/g,                    // [文字](field://…) 的地址
  /\]\(\s*<?https?:\/\/[^)\s]*>?\)?/g,                               // [文字](https://…) 的地址
  /(?:field|field-media):\/\/\S*/g,                                  // 截断后剩下的内部地址
  /!\[/g,                                                            // 图片记号开头
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // UUID
  /(?:^|(?<=\n))[ \t]{0,3}#{1,6}[ \t]+/g,                            // 标题记号
  /(?:^|(?<=\n))[ \t]{0,3}>[ \t]?/g,                                 // 引用记号
  /(?:^|(?<=\n))[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/g,                 // 列表记号
  /\*\*|__|`/g,                                                      // 强调与代码记号
  /\[(?=[^\]\n]*\])/g,                                               // 链接文字的左方括号
];

/**
 * 把一段原始摘要变成“读得懂的一段话”：不露 Markdown、`field://` 与 UUID；行与段之间中文用一个全角空格隔开、
 * 西文用一个空格，不再把标题、署名和正文首句粘成一串（DLG-02）。`title`：摘要从正文开头取时，第一行与卡片标题
 * 相同（Markdown 文章的 `# 标题`）就跳过它。高亮位置随文字一起换算；落在被删除内容里的高亮丢弃。
 */
export function readableExcerpt(text: string, ranges: readonly Range[] = [], options: { title?: string } = {}): { text: string; ranges: Range[] } {
  const removed = new Uint8Array(text.length);
  const title = options.title?.replace(/\s+/g, ' ').trim();
  if (title) {
    const first = /^\s*(?:#{1,6}[ \t]+)?([^\n]*)(?:\n|$)/.exec(text);
    if (first && first[1].replace(/\s+/g, ' ').trim() === title) removed.fill(1, 0, first[0].length);
  }
  for (const pattern of REMOVE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      for (let index = start; index < start + match[0].length; index++) removed[index] = 1;
    }
  }
  let output = '';
  const sourceOf: number[] = [];
  let pendingSpace = false, pendingBreak = false;
  for (let index = 0; index < text.length; index++) {
    if (removed[index]) continue;
    const char = text[index];
    if (/\s/.test(char)) {
      if (output.length) { pendingSpace = true; if (char === '\n') pendingBreak = true; }
      continue;
    }
    if (pendingSpace) {
      // 换行合并成一段：行与段之间中文用一个全角空格隔开（标题、署名、正文首句不粘连），西文用一个空格；
      // 原文里本来就有的空格保留一个。换行两边有一边是西文或数字（“01:50”接“画面”）时用半角空格。
      const previous = output.at(-1) ?? '';
      // 弯引号在中文里也用，不算西文（“十五分钟生活圈”前面仍用全角空格）。
      const latinJoin = /[\w)\].,;:!?]/.test(previous) || /[\w(]/.test(char);
      // 截断记号“…”紧贴文字：开头的“…”后面、结尾的“…”前面不加空格。
      const atCut = output === '…' || (char === '…' && index === text.length - 1);
      if (!atCut) { output += pendingBreak && !latinJoin ? '　' : ' '; sourceOf.push(index); }
      pendingSpace = false; pendingBreak = false;
    }
    output += char;
    sourceOf.push(index);
  }
  const mapped: Range[] = [];
  for (const range of ranges) {
    let start = -1, end = -1;
    for (let index = 0; index < sourceOf.length; index++) {
      const source = sourceOf[index];
      if (source >= range.start && source < range.end) {
        if (start < 0) start = index;
        end = index + 1;
      }
    }
    if (start >= 0) mapped.push({ start, end });
  }
  return { text: output, ranges: mergeRanges(mapped) };
}
