import { createNode } from './board-utils';
import { formatDraftQuote } from './draft-references';
import { createTextAnchor } from './text-anchor';
import { INITIAL_TRANSCRIPT_REVISION } from './transcript-tools';
import { timecode, uid, type Board, type BoardEdge, type BoardNode, type CardData, type TemplateId, type TranscriptLine } from './model';

/**
 * Sample media shipped under `public/assets/samples/` for the three example boards.
 * Sources, prompts and licences: docs/redesign/EXAMPLE_CONTENT.md.
 * Persistence must accept these paths before the examples can be saved (see that document, “集成”).
 */
export const SAMPLE_ASSET_PATTERN = /^\/assets\/samples\/[a-z0-9-]+\.(?:webp|jpg|mp4)$/;
export const isSampleAsset = (value: unknown): value is string => typeof value === 'string' && SAMPLE_ASSET_PATTERN.test(value);
const sample = (file: string) => `/assets/samples/${file}`;

export type ExampleId = 'writing' | 'video' | 'creative';
export interface ExampleInfo {
  id: ExampleId;
  /** Welcome entry label (DESIGN_SYSTEM §6.24). */
  entry: string;
  /** Title of the board the entry opens. */
  title: string;
  /** One line under the entry label. */
  summary: string;
  /** Sample image for the entry's material swatch; the writing entry draws paper instead (§6.24). */
  cover?: string;
}
export const EXAMPLES: readonly ExampleInfo[] = [
  { id: 'writing', entry: '我写文章', title: '十五分钟的城市', summary: '导入一篇长文，摘下两句，写进第二稿。' },
  { id: 'video', entry: '我做视频', title: '凌晨四点的早餐摊', summary: '一段短片和逐字稿，按时间码摘录，写成脚本。', cover: sample('v01-stall.webp') },
  { id: 'creative', entry: '我做创意', title: '城市清晨', summary: '12 张原比例图片分成两组，配两张笔记和一条来源链接。', cover: sample('c-steam.webp') },
];

function card(kind: BoardNode['data']['kind'], x: number, y: number, data: Partial<BoardNode['data']>, width = 290, height?: number): BoardNode {
  const node = createNode(kind, { x, y });
  node.data = { ...node.data, ...data };
  node.style = height === undefined ? { width } : { width, height };
  return node;
}

/** Example cards keep their own words: no default body, tags or tone leak in from createNode (CD-M3). */
function exampleCard(kind: CardData['kind'], x: number, y: number, data: Partial<CardData>, width: number, height?: number): BoardNode {
  const node = card(kind, x, y, { body: '', demo: true, ...data }, width, height);
  if (data.tone === undefined) delete node.data.tone;
  if (kind !== 'video') delete node.data.transcript;
  if (kind !== 'draft') delete node.data.draftVersions;
  return node;
}

function edge(source: BoardNode, target: BoardNode, label: string, type?: string): BoardEdge {
  return { id: uid(), source: source.id, target: target.id, label, ...(type ? { type } : {}) };
}

function baseBoard(title: string, description: string, category: Board['category']): Board {
  const now = new Date().toISOString();
  return { id: uid(), title, description, category, createdAt: now, updatedAt: now, nodes: [], edges: [], viewport: { ...START_VIEWPORT } };
}

/** A text excerpt exactly as createTextQuoteBatch would store it, anchored to its only occurrence. */
function textQuote(source: BoardNode, text: string, reading: string, x: number, y: number): BoardNode {
  const body = source.data.body.replace(/\r\n?/g, '\n');
  const from = body.indexOf(text);
  if (from < 0 || body.indexOf(text, from + 1) >= 0) throw new Error(`示例摘录必须在来源中唯一出现：${text}`);
  return exampleCard('quote', x, y, {
    title: `摘录 · ${source.data.title}`, body: reading, tags: ['参考摘录'],
    citation: { nodeId: source.id, title: source.data.title, text, textAnchor: createTextAnchor(body, from, from + text.length) },
  }, QUOTE_WIDTH);
}

/** A transcript excerpt exactly as createQuoteBatch would store it (consecutive lines joined by LF). */
function transcriptQuote(video: BoardNode, from: number, to: number, reading: string, x: number, y: number): BoardNode {
  const lines = video.data.transcript!.slice(from, to + 1);
  const start = lines[0].start, end = lines.at(-1)!.end;
  return exampleCard('quote', x, y, {
    title: `摘录 · ${timecode(start)}–${timecode(end)}`, body: reading, tags: ['参考摘录'],
    citation: { nodeId: video.id, title: video.data.title, start, end, text: lines.map(line => line.text).join('\n'), transcriptRevision: INITIAL_TRANSCRIPT_REVISION },
  }, QUOTE_WIDTH);
}

/**
 * Layout constants (DESIGN_SYSTEM §5, §6.9–6.15): columns leave a 56px channel so edge labels
 * (≥40px) sit between cards, and the starting chain fits a 1366×768 window at 100%.
 */
const QUOTE_WIDTH = 284; // 272 paper + 12 tag overhang (§6.11)
const DRAFT_WIDTH = 340;
const CHANNEL = 56;
const START_VIEWPORT = { x: 32, y: 48, zoom: 1 };

// ── 我写文章：十五分钟的城市 ─────────────────────────────────────────────

const ARTICLE = [
  '# 步行十五分钟，能到达什么',
  '',
  '## 引子',
  '',
  '早上七点出门，十五分钟里，你能买到一份早饭、把孩子送进学校、在社区医院挂上号吗？',
  '',
  '我问过很多人这个问题。住在老城区的人通常想一想就能回答，住在新城区的人会先打开地图。',
  '',
  '这个问题比房价更诚实。房价告诉你一座城市有多贵，这个问题告诉你，住在这里的日子是什么样子。',
  '',
  '## 一、把城市折叠进十五分钟',
  '',
  '“十五分钟生活圈”是这些年城市规划里常听到的说法：居住、工作、买菜、看病、上学和休闲，这些日常需要，最好都能在步行或骑行十五分钟的范围里得到满足。',
  '',
  '它背后的判断很朴素：一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。',
  '',
  '距离不是用公里计算的，而是用一个人的体力、时间和耐心计算的。对一个推着婴儿车的母亲，对一个膝盖不好的老人，同样的八百米，长度并不一样。',
  '',
  '有人做过一个小实验：让一位七十岁的老人和一个三十岁的年轻人走同一条路去菜场。年轻人用了九分钟，老人用了十九分钟，中间还在一棵树下歇了一次。圆圈的半径，对他们来说不是同一个数字。',
  '',
  '## 二、地图上的圆圈',
  '',
  '在规划图上，这个想法通常被画成一个圆：以家为圆心，半径大约一公里，圆里标出菜场、学校、诊所和公园。圆画得越满，这个片区看起来就越好。',
  '',
  '我见过一张很漂亮的规划图，圆圈里密密麻麻全是图标：书店、健身房、咖啡馆、托育中心。可图标不会告诉你，书店周一闭馆，托育中心只收两岁以上的孩子。',
  '',
  '但“完成多少件事”这个说法，藏着一个前提：事情得在你去的时候正在发生。',
  '',
  '一家菜场开在那里，不等于它在你需要的时候开着门。一所社区医院就在楼下，可它八点才开始挂号，而你七点半就得出门上班。',
  '',
  '## 三、谁在走，什么时候走',
  '',
  '去年秋天，我跟着一个老社区的几位居民，记录了他们一整天的步行轨迹。',
  '',
  '记录的方法很笨：一个本子，一块表，跟在后面走。一位退休的钳工每天早上五点半出门，先去早餐摊坐十分钟，再去菜场转一圈，七点前一定回家，因为孙子七点二十要出门上学。他一天走的路加起来不到两公里，却串起了整个社区最早醒来的几个地方。',
  '',
  '他们最常去的，并不是规划图上标出来的设施，而是几个没有名字的地方：天亮前就开张的早餐摊，修车铺门口的两张矮凳，傍晚才热闹起来的小广场。',
  '',
  '这些地方有一个共同点：它们的营业时间，是跟着人的作息长出来的。',
  '',
  '早餐摊四点出摊，是因为头班公交的司机五点前要吃上东西；菜市场六点最热闹，是因为退休的老人习惯早起；小广场七点以后才有人，是因为那时候晚饭刚吃完。',
  '',
  '没有人规划过这些时间。它们是一天一天被人走出来的。',
  '',
  '## 四、新城的反例',
  '',
  '同一周，我又去了城市另一头的一个新城区。那里的马路很宽，楼很新，规划图上的圆圈几乎是满的：两所学校、一座商业中心、一个社区服务站，步行都在十五分钟以内。',
  '',
  '可早上六点半，我在那里走了二十分钟，只找到一家亮着灯的便利店。',
  '',
  '那家便利店开在一座停车楼的一层，从小区门口过去要穿过两个路口，等两次红灯。店员说，早上来的大多是赶地铁的年轻人，买一个饭团就走，很少有人坐下。',
  '',
  '一位送孩子上学的母亲告诉我，她每天先开车去老城区买早饭，再折回来送孩子。“圈是画满了，”她说，“可早上这一段是空的。”',
  '',
  '## 五、把时间加进地图',
  '',
  '所以我想，衡量一个社区，除了问“十五分钟能走到哪里”，还应该问“我走到的时候，那里有没有人”。',
  '',
  '一张只有空间的地图，会把城市画得比它实际更近。把时间加进去，地图会变得复杂一些，也会诚实一些：清晨的圈很小，正午的圈很大，深夜的圈几乎只剩一家便利店。',
  '',
  '如果把一个社区一天里每个小时能走到的地方都画出来，会得到一组大小不一的圆。它们像呼吸一样，早上收紧，中午张开，夜里又缩回去。',
  '',
  '规划能做的，也许不是把每一样设施都放进圆里，而是给那些跟着作息长出来的小地方留出位置：一块可以支摊的空地，一段允许早市的路边，一个不必等到八点才开门的窗口。',
  '',
  '## 后记',
  '',
  '写完这篇笔记的那天早上，我又去了那个早餐摊。摊主正在收桌子，问我要不要来一碗豆浆。',
  '',
  '他说再过几年就不干了，腰不行。我问那以后谁来四点出摊，他想了想，说总会有人的。',
  '',
  '我看了一眼表，七点十分。从我住的地方走过来，正好十五分钟。',
].join('\n');

const WALKING_NOTES = [
  '写给社区研究者的一份调查方法，讲怎样记录居民一天里的步行轨迹。',
  '',
  '步行时间应该按走得最慢的那个人来算：推婴儿车的家长、拄拐杖的老人、背着书包的孩子。',
  '',
  '记录的不只是去了哪里，还有几点去、待了多久、为什么去。同一条路线，至少在清晨、正午和傍晚各走一次。',
].join('\n');

function createWritingExample(): Board {
  const board = baseBoard('十五分钟的城市', '一篇关于步行距离与城市作息的文章，从一篇导入的长文写到第二稿。', 'writing');
  const colB = 300 + CHANNEL, colC = colB + QUOTE_WIDTH + CHANNEL;
  // 署名放在卡片元信息（sourceAuthor），不写进正文：正文第 1 段就是引子的第一句，段号与肉眼数的一致（DLG-16）。
  const article = exampleCard('note', 0, 0, { title: '步行十五分钟，能到达什么', body: ARTICLE, tags: ['文字资料', 'Markdown'], sourceAuthor: '林冉', collectedAt: '2026-10-02T14:15:00.000Z' }, 300);
  const link = exampleCard('link', 0, 270, {
    title: '社区步行调查：一份方法笔记', url: 'https://example.org/walking-survey-notes', body: WALKING_NOTES, tone: 'blue',
  }, 300);
  const opening = textQuote(article, '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。',
    '适合作开头的论点，但要补一个反例：新城的圈画满了，早上却是空的。', colB, 0);
  const turn = textQuote(article, '它们的营业时间，是跟着人的作息长出来的。',
    '全文的转折在这里。第三稿可以拿它收尾。', colB, 276);
  const slowest = textQuote(link, '步行时间应该按走得最慢的那个人来算',
    '补进第二段：距离是用人的体力量出来的。', colB, 552);
  const draftBody = [
    '凌晨四点，老周的早餐摊已经亮着灯。一口铁锅，两张折叠桌，炉子上的豆浆刚刚翻滚。街上还没有行人，只有路口的公交站亭在路灯下格外清楚。',
    '',
    `我原本想写一篇关于城市规划的文章。读资料时，有一句话我抄了下来：${formatDraftQuote(opening)}站在老周的摊前，我才发现这句话只说对了一半。十五分钟能走到的地方，得在你走到的时候开着门。`,
    '',
    '老周四点出摊，是因为头班车的司机五点前要吃上东西。菜市场六点最热闹，是因为老人们起得早。没有人规划过这些时间，它们是一天一天被人走出来的。',
    '',
    `一份社区调查的方法笔记里写着：${formatDraftQuote(slowest)}我想再加半句：也应该按最早出门的那个人来算。`,
    '',
    '我们习惯把“十五分钟城市”想成一张地图：以家为圆心画一个圈，圈里有菜场、学校、诊所和公园。地图上看不见的，是这个圈要靠很多人在天亮之前把灯点亮。',
    '',
    '所以十五分钟是倒过来算的。不是我们走向城市，而是城市在天亮之前，先走到了我们门口。',
  ].join('\n');
  const draft = exampleCard('draft', colC, 0, {
    title: '十五分钟的城市', body: draftBody, tags: ['第二稿'],
    draftVersions: [{ id: uid(), title: '第一稿', createdAt: board.createdAt, body: [
      '“十五分钟生活圈”是近年来城市规划的热门理念。它主张居住、工作、购物、医疗、教育和休闲，都应在步行十五分钟内完成。',
      '',
      '这个理念很好，但落地有难度。本文想从空间、人群和时间三个方面展开讨论。',
    ].join('\n') }],
  }, DRAFT_WIDTH);
  const note = exampleCard('note', colC, 500, {
    title: '开头的写法', body: '开头不要讲大道理，先讲一个具体的人。\n\n只留三个细节：四点的灯、铁锅的白汽、头班车。', tone: 'butter',
  }, DRAFT_WIDTH);
  board.nodes = [article, link, opening, turn, slowest, draft, note];
  board.edges = [
    edge(article, opening, '摘录', 'smoothstep'),
    edge(article, turn, '摘录', 'smoothstep'),
    edge(link, slowest, '摘录', 'smoothstep'),
    edge(note, draft, '改开头'),
  ];
  return board;
}

// ── 我做视频：凌晨四点的早餐摊 ──────────────────────────────────────────

/** Voice-over script of the silent sample film; starts at 0, 6 and 13 s are contract K1. */
const BREAKFAST_TRANSCRIPT: [number, number, string][] = [
  [0, 6, '凌晨四点，这条街上只有一盏灯是亮的。'],
  [6, 13, '灯下是老周的早餐摊，一口铁锅，两张折叠桌。'],
  [13, 19, '他三点二十起床，闹钟从来不用定。'],
  [19, 25, '豆浆用的是前一天晚上泡好的黄豆。'],
  [25, 31, '蒸笼一掀开，整条街都是白汽。'],
  [31, 37, '我问他，这么早出摊，能有几个客人？'],
  [37, 43, '他说，四点到五点，一共也就十来碗。'],
  [43, 49, '油条下锅的声音，是这条街醒来的第一个声音。'],
  [49, 55, '四点四十，路口的公交站亭亮了。'],
  [55, 61, '总站就在前面两百米。'],
  [61, 66, '头班车五点十分发车，司机们四点半就得到。'],
  [66, 72, '冬天的时候，那会儿天还黑透着。'],
  [72, 79, '摊主说，四点出摊不是为了赚钱，'],
  [79, 86, '是为了等头班公交的司机。'],
  [86, 92, '司机们站着吃完一碗馄饨，正好够开到第一站。'],
  [92, 98, '再晚一点，来的是扫街的环卫工，坐下就吃，不多说话。'],
  [98, 104, '老周说，这些人他大多叫不出名字，'],
  [104, 110, '但谁今天没来，他心里有数。'],
  [110, 116, '六点以后，天慢慢亮了，路上开始有人。'],
  [116, 122, '早班的护士来得最匆忙，豆浆打包带走。'],
  [122, 128, '七点，送孩子的家长多了，摊前排起了队。'],
  [128, 134, '等写字楼里的人出门，老周已经在收桌子了。'],
  [134, 140, '城市醒来之前，已经有人替它醒着。'],
];
export const BREAKFAST_FILM = { file: sample('breakfast-stall.mp4'), poster: sample('v01-stall.webp'), duration: 140 } as const;

function createVideoExample(): Board {
  const board = baseBoard('凌晨四点的早餐摊', '一支两分多钟的短片：从逐字稿里摘下两句，写进分镜脚本。', 'video');
  const colB = 320 + CHANNEL, colC = colB + QUOTE_WIDTH + CHANNEL;
  const transcript: TranscriptLine[] = BREAKFAST_TRANSCRIPT.map(([start, end, text]) => ({ id: uid(), start, end, text }));
  const video = exampleCard('video', 0, 0, {
    title: '凌晨四点的早餐摊', body: '示例短片，无声。逐字稿是旁白稿，点任意一句可跳到对应画面。',
    url: BREAKFAST_FILM.file, poster: BREAKFAST_FILM.poster, duration: BREAKFAST_FILM.duration, transcript, collectedAt: '2026-10-03T13:40:00.000Z',
  }, 320);
  const reason = transcriptQuote(video, 12, 13, '这是片子的题眼。放在开场之后：先让观众看见灯，再听见原因。', colB, 0);
  const regulars = transcriptQuote(video, 16, 17, '结尾用这句。画面停在叠好的塑料凳上，不加音乐。', colB, 276);
  const scriptBody = [
    '## 开场 00:00–00:43',
    '',
    '画面：路口只有一盏灯，铁锅冒着白汽。不配乐，只留油锅和风声。',
    '',
    '旁白从“凌晨四点”开始，先交代人，再交代时间。',
    '',
    '## 展开 00:43–01:50',
    '',
    '画面：公交总站亮灯，头班车出站。切回摊前，司机站着吃馄饨。',
    '',
    `这一段只靠老周的一句话撑住：${formatDraftQuote(reason)}镜头：跟着司机吃完、上车，不解释。`,
    '',
    '## 结尾 01:50–02:20',
    '',
    `画面：天亮，摊前排起队，然后收摊。${formatDraftQuote(regulars)}镜头：最后停在叠好的塑料凳上，黑场三秒。`,
  ].join('\n');
  const script = exampleCard('draft', colC, 0, {
    title: '早餐摊 · 分镜脚本', body: scriptBody, tags: ['第二稿'],
    draftVersions: [{ id: uid(), title: '第一稿', createdAt: board.createdAt, body: '开场：早餐摊的夜景。\n\n展开：采访摊主，介绍他的一天。\n\n结尾：天亮了，城市开始忙碌。' }],
  }, DRAFT_WIDTH);
  const intent = exampleCard('note', colC, 500, {
    title: '这支片子想让人感受到什么？',
    body: '城市醒来之前，已经有人替它醒着。\n\n镜头少动，让蒸汽自己动。\n环境声比音乐重要。\n不拍正脸也可以，拍手和锅。', tone: 'butter',
  }, DRAFT_WIDTH);
  const depot = exampleCard('image', 0, 318, { title: '头班车出站', poster: sample('v03-depot.webp') }, 320, 180);
  const drivers = exampleCard('image', 0, 522, { title: '司机的早饭', poster: sample('v05-drivers.webp') }, 320, 180);
  board.nodes = [video, reason, regulars, script, intent, depot, drivers];
  board.edges = [
    edge(video, reason, '摘录', 'smoothstep'),
    edge(video, regulars, '摘录', 'smoothstep'),
    edge(intent, script, '想表达的'),
  ];
  board.cover = BREAKFAST_FILM.poster;
  return board;
}

// ── 我做创意：城市清晨 ──────────────────────────────────────────────────

interface Shot { file: string; ratio: number; title: string }
const IMAGE_GAP = 12;
const FRAME_PADDING = 16;
/** Frame label sits outside the tray's top edge (§6.15), so stacked frames need this much air. */
const FRAME_STACK_GAP = 64;

/** Images keep their original ratio; each row is scaled to fill the tray width (target row height ≈184, §5.4). */
function imageRows(rows: Shot[][], x: number, y: number, innerWidth: number) {
  const nodes: BoardNode[] = [];
  let top = y;
  for (const row of rows) {
    const height = (innerWidth - IMAGE_GAP * (row.length - 1)) / row.reduce((sum, shot) => sum + shot.ratio, 0);
    let left = x;
    row.forEach((shot, index) => {
      const width = index === row.length - 1 ? x + innerWidth - left : Math.round(height * shot.ratio);
      nodes.push(exampleCard('image', left, Math.round(top), { title: shot.title, poster: sample(shot.file) }, width, Math.round(height)));
      left += width + IMAGE_GAP;
    });
    top += height + IMAGE_GAP;
  }
  return { nodes, height: Math.round(top - IMAGE_GAP - y) };
}

function tray(title: string, x: number, y: number, innerWidth: number, rows: Shot[][]) {
  const images = imageRows(rows, x + FRAME_PADDING, y + FRAME_PADDING, innerWidth);
  const frame = exampleCard('frame', x, y, { title }, innerWidth + FRAME_PADDING * 2, images.height + FRAME_PADDING * 2);
  return { frame, images: images.nodes, bottom: y + images.height + FRAME_PADDING * 2 };
}

function createCreativeExample(): Board {
  const board = baseBoard('城市清晨', '一组城市清晨的画面参考：冷青打底，暖黄只给灯。', 'design');
  // §6.15 首屏就是画面（DLG-06）：托盘内宽 1016（1366 宽窗口 100% 也放得下），每行按原比例填满，行高 235–240；
  // 第一组三行占满 1440×900 首屏（图片约占可见画布 69%），第二组一行，笔记与来源链接卡放在托盘下方。
  const trayWidth = 1016;
  const street = tray('清晨的街', 0, 36, trayWidth, [
    [
      { file: 'c-dawn-wide.webp', ratio: 21 / 9, title: '老街的鱼肚白' },
      { file: 'c-crossing.webp', ratio: 1, title: '俯看十字路口' },
      { file: 'c-sweeper.webp', ratio: 4 / 5, title: '巷口的扫帚' },
    ],
    [
      { file: 'c-noodle.webp', ratio: 4 / 3, title: '面馆的窗' },
      { file: 'c-window.webp', ratio: 3 / 2, title: '车窗上的雾' },
      { file: 'c-market.webp', ratio: 4 / 3, title: '六点的菜市场' },
    ],
    [
      { file: 'c-newtown.webp', ratio: 16 / 9, title: '新城的斑马线' },
      { file: 'c-rooftop.webp', ratio: 2 / 3, title: '屋顶晾床单' },
      { file: 'v06-busstop.webp', ratio: 16 / 9, title: '等头班车' },
    ],
  ]);
  const stall = tray('人与摊', 0, street.bottom + FRAME_STACK_GAP, trayWidth, [
    [
      { file: 'v04-laozhou.webp', ratio: 16 / 9, title: '老周的油锅' },
      { file: 'v01-stall.webp', ratio: 16 / 9, title: '四点的早餐摊' },
      { file: 'c-steam.webp', ratio: 3 / 4, title: '刚掀开的蒸笼' },
    ],
  ]);
  const notesY = stall.bottom + 48, noteWidth = 320;
  const concept = exampleCard('note', 0, notesY, {
    title: '视觉概念',
    body: '城市醒来之前的那一个小时。\n\n冷青蓝打底，画面里只留一处暖黄的灯。\n人都在做事，不看镜头。\n给天空和湿地面留白，让蒸汽和雾自己动。', tone: 'mint',
  }, noteWidth);
  const avoid = exampleCard('note', noteWidth + 40, notesY, {
    title: '不要什么', body: '不要招牌和文字。\n不要摆拍和笑脸。\n不要暖橙滤镜，暖色只给灯。', tone: 'lavender',
  }, noteWidth);
  // 组外一张来源链接卡（§6.15）：参考从哪里来，与图片放在同一块画布上。
  const reference = exampleCard('link', (noteWidth + 40) * 2, notesY, {
    title: '蓝调时刻：一份街景布光笔记', url: 'https://example.org/blue-hour-street-light',
    body: '日出前二三十分钟，天空和街灯一样亮。让画面里只有一处暖光，放在三分之一的位置；其余交给冷青色的天和湿地面。', tone: 'blue',
  }, trayWidth + FRAME_PADDING * 2 - (noteWidth + 40) * 2);
  board.nodes = [street.frame, stall.frame, concept, avoid, reference, ...street.images, ...stall.images];
  board.cover = sample('c-steam.webp');
  return board;
}

/** Example boards for the welcome entries (DESIGN_SYSTEM §6.24). Every call returns fresh ids. */
export function createExampleBoard(id: ExampleId): Board {
  return id === 'writing' ? createWritingExample() : id === 'video' ? createVideoExample() : createCreativeExample();
}

/**
 * 新建画布（空白或起点模板）。默认 100%（START_VIEWPORT）：空画布没有需要收进来的内容，第一条笔记按真实字号显示；
 * 模板内容由 App 的首屏定位（§5.5）决定缩放。
 */
export function createBoard(template: TemplateId): Board {
  const now = new Date().toISOString();
  const titles: Record<TemplateId, string> = {
    demo: '把日子过成一部电影', blank: '一张新的画布', video: '下一个好故事', writing: '写下值得被读到的文字', design: '让灵感有形状',
  };
  const board: Board = {
    id: uid(), title: titles[template], description: template === 'demo' ? '在平凡的日常里，发现值得讲述的瞬间。' : '',
    category: template === 'writing' ? 'writing' : template === 'design' ? 'design' : 'video',
    createdAt: now, updatedAt: now, nodes: [], edges: [], viewport: { ...START_VIEWPORT },
  };
  if (template === 'blank') return board;
  if (template === 'demo') {
    const video = card('video', 0, 0, {
      title: '故事从一个普通的清晨开始', body: '演示分镜 · 想象一段 48 秒的日常短片：光透过窗，城市慢慢醒来。',
      poster: '/assets/scene-morning.svg', duration: 48, tags: ['日常叙事', '开场参考'], demo: true,
      transcript: [
        { id: uid(), start: 0, end: 6, text: '我们总在等待，一个值得记录的日子。' },
        { id: uid(), start: 6, end: 13, text: '可阳光落在桌角的时候，故事已经开始了。' },
        { id: uid(), start: 13, end: 22, text: '把镜头转向那些，被我们匆匆略过的瞬间。' },
        { id: uid(), start: 22, end: 34, text: '一杯咖啡，一条走过很多次的路，一个没有目的的下午。' },
        { id: uid(), start: 34, end: 48, text: '生活没有暂停键，但我们可以学着看见。' },
      ],
    }, 320);
    const architecture = card('image', 358, 0, { title: '光经过的地方', body: '原创几何插画 · 建筑与光影情绪参考', poster: '/assets/scene-architecture.svg', tags: ['暖灰', '留白'], demo: true }, 280);
    const landscape = card('image', 675, 0, { title: '给故事一次呼吸', body: '原创几何插画 · 旅行与旷野情绪参考', poster: '/assets/scene-landscape.svg', tags: ['远景', '安静'], demo: true }, 280);
    const quote = card('quote', 0, 380, { title: '想留住的一句话', body: '', tone: 'mint',
      citation: { nodeId: video.id, title: video.data.title, start: 6, end: 13, text: '可阳光落在桌角的时候，故事已经开始了。' }, demo: true }, 320);
    const note = card('note', 358, 340, { title: '这个故事想让人感受到什么？', body: '不必去很远的地方，生活也值得被认真看见。\n\n• 拍下重复日常里的微小变化\n• 用环境声留出一点安静\n• 结尾回到开头的那束光', tone: 'butter', tags: ['创作意图'], demo: true }, 280);
    const draft = card('draft', 675, 330, { title: '把日子过成一部电影', body: '我曾以为，要去很远的地方，才能拍出一个好故事。\n\n直到那个清晨，阳光穿过窗帘，在桌上停了很久。\n\n原来那些平凡得快要忘记的日子，也一直在发光。', tags: ['第一稿'], demo: true }, 340);
    const link = card('link', 1035, 0, { title: '收集网页资料', body: '添加网页链接，让灵感和它的出处一起留下来。此卡是操作示例。', tone: 'blue', demo: true }, 320);
    board.nodes = [video, architecture, landscape, quote, note, draft, link];
    board.edges = [
      { id: uid(), source: video.id, target: quote.id, label: '摘录自' },
      { id: uid(), source: quote.id, target: draft.id, label: '写进故事' },
      { id: uid(), source: note.id, target: draft.id, label: '创作意图' },
    ];
    board.cover = '/assets/scene-morning.svg';
    return board;
  }
  if (template === 'video') {
    board.description = '从一段视频素材，到写成的脚本。';
    board.nodes = [
      card('video', 0, 0, { title: '视频素材', body: '' }, 320),
      card('note', 360, 0, { title: '这支视频，为谁而拍？', body: '观众是谁？\n想传递哪一个感受？\n看完后，希望他们记住什么？' }),
      card('draft', 690, 0, { title: '我的视频脚本', body: '## 开场\n\n## 展开\n\n## 结尾', draftVersions: [] }, 340),
    ];
  } else if (template === 'writing') {
    board.description = '把阅读、摘录与思考，连接成一篇文章。';
    board.nodes = [
      card('frame', 0, 0, { title: '素材', body: '' }, 330, 360),
      card('note', 370, 0, { title: '文章的一个核心问题', body: '我想回答什么？\n我的亲身经验是什么？\n哪些资料能支持我的观点？', tone: 'lavender' }),
      card('draft', 700, 0, { title: '文稿', body: '', draftVersions: [] }, 360),
    ];
  } else {
    board.description = '从视觉参考到设计意图，让每一次选择有依据。';
    board.nodes = [
      card('frame', 0, 0, { title: '情绪', body: '' }, 420, 300),
      card('frame', 450, 0, { title: '色彩', body: '' }, 420, 300),
      card('frame', 0, 360, { title: '构图', body: '' }, 420, 300),
      card('frame', 450, 360, { title: '材质', body: '' }, 420, 300),
      card('note', 910, 0, { title: '设计意图', body: '使用场景\n\n想传递的气质\n\n必须解决的问题', tone: 'mint' }),
    ];
  }
  return board;
}
