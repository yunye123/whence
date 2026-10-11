import { useSyncExternalStore, type ReactNode, type SVGProps } from 'react';

/**
 * 来处定制图标（PLAN §2.5）：索引卡、资料夹、稿纸、便笺；不再画签孔和线绳。
 * 功能图标仍用 24 网格、1.75 线宽、currentColor；目录字形取批准样稿的 20×16 几何。
 * 标志与字标保持方案 A「原点」，通用动作仍用 lucide-react。
 */
export interface FieldIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  /** 有意义的图标写 title；装饰性图标省略，自动 aria-hidden。 */
  title?: string;
}

function Glyph({ size = 16, title, strokeWidth = 1.75, children, ...rest }: FieldIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * 标志「原点」（2026-10-07 起，DESIGN_SYSTEM.md §9）：一张墨色方纸，左下角一枚朱点，纸在朱点处让出一段以朱点为圆心的圆弧。
 * 墨跟随文字色（currentColor），朱点读 --brand-dot；没有这个令牌时退回文字色，就是单色版。
 * 几何取自品牌稿逐尺寸整数表（docs/research/brand-2026-10-07/marks/laichu-whence/build/final_marks.py 的 A_TABLE）：
 * 16、24、32 是品牌给的 mark-16 / mark-24 / mark-32；28 用同表外框 24 那一套（纸边 19、朱点 5、让位 8），居中放进 28 画布。
 * 125% / 150% 缩放下换成按设备像素画的版本（viewBox 就是设备像素），纸边仍落在整数设备像素上；
 * 前提是标志框的左上角本身在整数设备像素上（侧栏、窄轨、欢迎页的位置都取 4 的倍数，见 §9）。其他尺寸和缩放用最接近的一套缩放。
 */
export type MarkSpec = { n: number; x: number; y: number; s: number; r: number; R: number };
const MARK_SPECS: Record<string, MarkSpec> = {
  // n 画布边长；(x, y) 纸的左上角 = 朱点圆心的 x；s 纸边；r 朱点半径；R 让位半径（圆心同朱点）。
  '16': { n: 16, x: 4, y: 1, s: 11, r: 3, R: 5 },           // mark-16
  '24': { n: 24, x: 6, y: 2, s: 16, r: 4, R: 6.4 },         // mark-24 主版
  '28': { n: 28, x: 7, y: 2, s: 19, r: 5, R: 8 },           // A_TABLE 外框 24
  '32': { n: 32, x: 8, y: 2, s: 22, r: 6, R: 9 },           // mark-32
  '24@1.25': { n: 30, x: 8, y: 3, s: 19, r: 5, R: 8 },      // mark-24@1.25x（30 设备像素）
  '24@1.5': { n: 36, x: 9, y: 3, s: 24, r: 6, R: 9.5 },     // mark-24@1.5x（36 设备像素）
  '28@1.25': { n: 35, x: 8, y: 3, s: 24, r: 6, R: 9.5 },    // A_TABLE 外框 30，放进 35 设备像素（左 2、上 3）
  '28@1.5': { n: 42, x: 10, y: 3, s: 29, r: 7, R: 11.5 },   // 按同表规则补的外框 36（纸 29、朱点 7、让位 11.5），四周各留 3
};
const markGrid = (size: number) => (size <= 20 ? 16 : size <= 26 ? 24 : size <= 30 ? 28 : 32);
const dprKey = (dpr: number) => (Math.abs(dpr - 1.25) < .01 ? '@1.25' : Math.abs(dpr - 1.5) < .01 ? '@1.5' : '');
export function markSpec(size: number, dpr: number): MarkSpec {
  const grid = markGrid(size);
  return (grid === size && MARK_SPECS[`${grid}${dprKey(dpr)}`]) || MARK_SPECS[grid];
}

/** 纸的轮廓：方纸，左下角让出以朱点为圆心、半径 R 的圆弧。 */
export const markPath = ({ x, y, s, R }: MarkSpec) => `M${x} ${y}H${x + s}V${y + s}H${x + R}A${R} ${R} 0 0 0 ${x} ${y + s - R}Z`;

/** 朱点在标志框里的位置（CSS 像素），给欢迎页线绳找起点用。 */
export function markDot(size: number, dpr: number): { cx: number; cy: number; r: number } {
  const { n, x, y, s, r } = markSpec(size, dpr);
  return { cx: x * size / n, cy: (y + s) * size / n, r: r * size / n };
}

const currentDpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
function subscribeDpr(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  let query: MediaQueryList | null = null;
  const listen = () => {
    query?.removeEventListener('change', changed);
    query = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
    query.addEventListener('change', changed);
  };
  function changed() { listen(); onChange(); }
  listen();
  return () => query?.removeEventListener('change', changed);
}
/** 当前设备像素比（系统缩放或页面缩放改变时跟着变）；服务端渲染和测试里是 1。 */
export const useDevicePixelRatio = () => useSyncExternalStore(subscribeDpr, currentDpr, () => 1);

export function MarkIcon({ size = 24, title, ...rest }: FieldIconProps) {
  const spec = markSpec(size, useDevicePixelRatio());
  const { n, x, y, s, r } = spec;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} fill="currentColor" focusable="false" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} {...rest}>
      <path d={markPath(spec)} />
      <circle cx={x} cy={y + s} r={r} style={{ fill: 'var(--brand-dot, currentColor)' }} />
    </svg>
  );
}

/**
 * 字标“来处”：思源宋体 SemiBold 轮廓转曲（OFL-1.1 字体派生），字距 +6%，不随系统字体变化。
 * 用品牌稿的小字号原字形（wordmark-zh-small）：组合里只留标志那一枚朱点，“处”的点不换成圆点。
 * viewBox 裁到字面框，height 就是字面高（与品牌稿侧栏样张同一量法）。
 */
const WORDMARK_BOX = { x: 12, y: 12, w: 200.487, h: 93.35 };
export function Wordmark({ height = 17, title = '来处', ...rest }: Omit<FieldIconProps, 'size'> & { height?: number }) {
  const { x, y, w, h } = WORDMARK_BOX;
  return (
    <svg height={height} width={Math.round(height * w / h * 100) / 100} viewBox={`${x} ${y} ${w} ${h}`} fill="currentColor" focusable="false" role="img" aria-label={title} {...rest}>
      <path d={WORDMARK_LAICHU} />
    </svg>
  );
}

/** 摘录：带顶线的索引卡，保留旧导出名。 */
export function QuoteIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="3.5" y="5.5" width="17" height="13" rx="1" /><path d="M3.5 9h17M7 12.5h10M7 15.5h7" /></Glyph>;
}

/** 连线：横—竖—横折线，两端实心墨点。 */
export function ThreadIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M5 17h5a2 2 0 0 0 2-2V9a2 2 0 0 1 2-2h5" /><circle cx="5" cy="17" r="2" fill="currentColor" stroke="none" /><circle cx="19" cy="7" r="2" fill="currentColor" stroke="none" /></Glyph>;
}

/** 来源：有页签的资料夹，内有打印稿。 */
export function SourceIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M3.5 20V4.5h6l2 2H20.5V20z" /><path d="M6.5 10h11v7h-11zM9 13h6" /></Glyph>;
}

/** 文稿：单张稿纸，粗文线、细武线和正文行。 */
export function DraftIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M5.5 3.5h13v17h-13z" /><path d="M5.5 7h13" strokeWidth="2.2" /><path d="M5.5 9h13" strokeWidth="1" /><path d="M9 12h6M9 15h6M9 18h4" strokeWidth="1.4" /></Glyph>;
}

/** 笔记：平整便笺和两行手写波线。 */
export function NoteIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M5 4.5h14v15H5z" /><path d="M8 10c1.5-.8 2.6.6 4 0s2.4-.9 4 0M8 14c1.2-.6 2.2.4 4 0" /></Glyph>;
}

/** 文字资料：资料夹中的文字页，不画篇幅轨。 */
export function ArticleIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M3.5 20V4.5h6l2 2H20.5V20z" /><path d="M6.5 10h11v7h-11zM9 12.5h6M9 15h4" /></Glyph>;
}

/** 出处印的两个实心字形，与批准样稿 i-play / i-para 同源。 */
export function ProvenancePlayIcon({ size = 9, title, ...rest }: FieldIconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" focusable="false" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} data-provenance-icon="video" {...rest}><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></svg>;
}

export function ProvenanceParagraphIcon({ size = 10, title, ...rest }: FieldIconProps) {
  return <svg width={size * .75} height={size} viewBox="0 0 9 12" fill="currentColor" stroke="none" focusable="false" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} data-provenance-icon="text" {...rest}><path d="M3.9 .6H8.6V11.4H7V2.1H5.9V11.4H4.3V7H3.9A3.2 3.2 0 0 1 3.9 .6Z" /></svg>;
}

function StationeryGlyph({ size = 20, title, style, children, ...rest }: FieldIconProps & { children: ReactNode }) {
  return <svg width={size} height={size * .8} viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1" focusable="false" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} style={{ color: 'var(--fg-3)', ...style }} {...rest}>{children}</svg>;
}

/** 目录迷你文具：按样稿 g-* 几何和材质绘制，内部细线保留完整对比度。 */
export function FolderMiniIcon(props: FieldIconProps) {
  return <StationeryGlyph {...props}><path d="M2.5 14.5V2.5h5.2l1.3 1.6h8.5v10.4z" style={{ fill: 'var(--paper-jacket)' }} /><rect x="4.5" y="6" width="11" height="6.5" style={{ fill: 'var(--paper-plain)' }} /><path d="M6.5 8.3h7M6.5 10.3h5" /></StationeryGlyph>;
}

export function IndexCardMiniIcon(props: FieldIconProps) {
  return <StationeryGlyph {...props}><rect x="2.5" y="3.5" width="15" height="9" style={{ fill: 'var(--paper-plain)' }} /><path d="M2.5 5.9h15" strokeWidth="1.5" style={{ stroke: 'var(--zhu)' }} /><path d="M4.5 8.6h11M4.5 10.8h11" /></StationeryGlyph>;
}

export function ManuscriptMiniIcon(props: FieldIconProps) {
  return <StationeryGlyph {...props}><rect x="4.5" y=".5" width="11" height="15" style={{ fill: 'var(--paper-manuscript)' }} /><path d="M4.5 3.6h11M8 6.5h5.5M8 8.8h5.5M8 11.1h4" /></StationeryGlyph>;
}

export function NoteMiniIcon(props: FieldIconProps) {
  return <StationeryGlyph {...props}><rect x="4" y="2" width="12" height="12" style={{ fill: 'var(--paper-note)' }} /><path d="M6.3 8c1.1-.6 2.2.5 3.3 0s2-.5 3.1 0M6.3 10.8c1.1-.6 2.1.4 3.1 0" /></StationeryGlyph>;
}

export function LightTableMiniIcon(props: FieldIconProps) {
  return <StationeryGlyph {...props}><path d="M2.5 14.5V3.5h1.5V2h5v1.5h8.5v11z" style={{ fill: 'var(--paper-wall)' }} /><rect x="4.5" y="6" width="5" height="3.5" /><rect x="10.8" y="6" width="4.7" height="6.5" /></StationeryGlyph>;
}

/** 视频：画面 + 下方句子刻度轨。 */
export function VideoIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="3.5" y="4.5" width="17" height="11" rx="1.5" /><path d="m10.5 7.6 4 2.4-4 2.4z" fill="currentColor" /><path d="M3.5 19h3M8 19h2M11.5 19h5M18 19h2.5" /></Glyph>;
}

/** 图片：两张叠放的照片（按原比例，不加衬底）。 */
export function ImageIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="3.5" y="7.5" width="11" height="12" rx="1" /><path d="M8 4.5h12.5v11" /></Glyph>;
}

/** 推文：带两行字的对话框（不是 ×）。 */
export function XLogoIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" /><path d="M8 9h8M8 12h5" /></Glyph>;
}

/** 分组：托盘，左上一段标签沿。 */
export function GroupIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="3.5" y="5.5" width="17" height="14" rx="2" /><path d="M3.5 9.5h6" /></Glyph>;
}

/** 分组版式“按比例成行”：三行，每行两块宽窄不一、行高相同（图片按原比例排成行）。 */
export function RowsLayoutIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="3.5" y="4" width="10" height="4" rx=".8" /><rect x="15.5" y="4" width="5" height="4" rx=".8" /><rect x="3.5" y="10" width="5" height="4" rx=".8" /><rect x="10.5" y="10" width="10" height="4" rx=".8" /><rect x="3.5" y="16" width="7.5" height="4" rx=".8" /><rect x="13" y="16" width="7.5" height="4" rx=".8" /></Glyph>;
}

/** 分组版式“网格”：四个等大的方格。 */
export function GridLayoutIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></Glyph>;
}

/** 分组版式“瀑布”：两列，竖条高低错落。 */
export function MasonryLayoutIcon(props: FieldIconProps) {
  return <Glyph {...props}><rect x="4" y="4" width="7" height="10" rx="1" /><rect x="4" y="16" width="7" height="4" rx="1" /><rect x="13" y="4" width="7" height="5" rx="1" /><rect x="13" y="11" width="7" height="9" rx="1" /></Glyph>;
}

/** 我写的（文稿与笔记的合称）：一支铅笔。 */
export function PencilIcon(props: FieldIconProps) {
  return <Glyph {...props}><path d="M4 20l1.2-4.6L15.6 5a1.9 1.9 0 0 1 2.7 0l.7.7a1.9 1.9 0 0 1 0 2.7L8.6 18.8z" /><path d="M13.8 6.8l3.4 3.4" /></Glyph>;
}

const WORDMARK_LAICHU = 'M13.25 57.98H87.7L93.88 50.29Q93.88 50.29 95.02 51.17Q96.15 52.04 97.93 53.4Q99.72 54.76 101.65 56.32Q103.59 57.87 105.2 59.28Q104.8 60.83 102.44 60.83H14.1ZM17.84 28.63H84.11L90.2 21.13Q90.2 21.13 91.3 21.96Q92.41 22.79 94.12 24.15Q95.83 25.5 97.71 27.01Q99.6 28.52 101.16 29.92Q101.01 30.72 100.28 31.12Q99.55 31.52 98.45 31.52H18.64ZM53.97 12.11 67.32 13.47Q67.17 14.47 66.42 15.22Q65.67 15.97 63.67 16.27V101.42Q63.67 101.97 62.46 102.83Q61.24 103.69 59.45 104.34Q57.66 105 55.83 105H53.97ZM49.23 58.32H60.4V59.88Q53.5 72.79 41.24 83.1Q28.98 93.4 12.95 100.15L12 98.75Q20.24 93.8 27.36 87.17Q34.47 80.54 40.08 73.13Q45.69 65.73 49.23 58.32ZM63.87 58.32Q66.96 63.72 71.66 68.51Q76.35 73.3 82 77.26Q87.65 81.22 93.87 84.16Q100.09 87.09 106.19 88.88L106.04 89.99Q103.22 90.55 101.07 92.72Q98.93 94.89 98.08 98.38Q90.17 94.58 83.39 88.93Q76.61 83.28 71.34 75.76Q66.06 68.23 62.53 59.07ZM29.93 33.17Q36.07 35.61 39.56 38.61Q43.05 41.61 44.42 44.57Q45.8 47.52 45.56 50Q45.33 52.49 43.94 53.97Q42.55 55.45 40.48 55.44Q38.41 55.44 36.25 53.52Q36.1 50.17 34.95 46.64Q33.81 43.12 32.2 39.77Q30.58 36.42 28.89 33.71ZM79.27 33.06 92.02 38.39Q91.62 39.24 90.62 39.74Q89.62 40.24 88.02 40.05Q84.25 44.7 79.74 48.94Q75.23 53.19 70.91 56.03L69.67 55.14Q71.96 51.13 74.59 45.12Q77.23 39.11 79.27 33.06ZM189.35 13.31Q189.2 14.36 188.45 15.08Q187.7 15.81 185.69 16.11V86.32Q185.69 86.77 184.56 87.4Q183.42 88.03 181.73 88.53Q180.03 89.03 178.21 89.03H176.3V12ZM150.69 14.12Q150.55 15.12 149.75 15.57Q148.95 16.02 146.85 16.12Q144.74 22.88 141.86 30.34Q138.98 37.79 135.39 45.12Q131.81 52.45 127.72 59.07Q123.63 65.7 119.11 70.8L117.87 70Q120.72 64.7 123.46 57.62Q126.21 50.54 128.63 42.66Q131.05 34.78 132.99 26.92Q134.94 19.06 136.13 12.1ZM134.28 39.74Q137.23 52.97 141.25 62.28Q145.27 71.59 150.67 77.6Q156.06 83.61 163.06 86.98Q170.06 90.35 178.9 91.7Q187.75 93.05 198.8 93.05Q200.25 93.05 202.76 93.05Q205.27 93.05 207.95 93.05Q210.63 93.05 212.49 93.05V94.29Q209.81 94.85 208.38 97.13Q206.94 99.41 206.74 102.39Q205.74 102.39 203.99 102.39Q202.24 102.39 200.49 102.39Q198.75 102.39 197.74 102.39Q186.19 102.39 176.89 100.76Q167.59 99.14 160.39 95.11Q153.19 91.09 147.82 84.04Q142.46 76.99 138.79 66.19Q135.12 55.39 132.89 40.19ZM183.57 38.56Q192.13 40.6 197.56 43.47Q202.99 46.34 205.88 49.42Q208.78 52.51 209.59 55.32Q210.4 58.13 209.56 60.03Q208.72 61.94 206.77 62.44Q204.83 62.94 202.21 61.48Q200.97 58.72 198.78 55.69Q196.59 52.67 193.86 49.71Q191.13 46.76 188.22 44.11Q185.31 41.46 182.67 39.46ZM156.42 33.27 161.61 27.88 170.72 36.18Q170.22 36.98 169.35 37.26Q168.47 37.54 166.72 37.79Q164.87 48.3 161.59 58.17Q158.32 68.05 152.91 76.86Q147.5 85.66 139.14 92.91Q130.77 100.16 118.6 105.35L117.55 104.05Q130.4 96.3 138.54 85.27Q146.69 74.24 151.21 60.95Q155.73 47.67 157.52 33.27ZM162.6 33.27V36.17H136.06L137.76 33.27Z';
