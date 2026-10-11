import { FileText, Frame, Image, Link2, Quote, StickyNote, Video } from 'lucide-react';
import type { CardKind } from '../model';

/** Icon used for each card kind in the materials list and the outline view. */
export const icons: Record<CardKind, typeof FileText> = { video: Video, image: Image, note: StickyNote, quote: Quote, draft: FileText, link: Link2, frame: Frame };

/** Chinese accessibility copy handed to React Flow's `ariaLabelConfig`. */
export const canvasAriaLabels = {
  'node.a11yDescription.default':'按 Enter 或空格选择卡片，按方向键移动，按 Delete 移除，按 Esc 取消选择。',
  'node.a11yDescription.keyboardDisabled':'按 Enter 或空格选择卡片，按方向键移动，按住 Shift 加速，按 Esc 取消选择。',
  'node.a11yDescription.ariaLiveMessage':({direction,x,y}:{direction:string;x:number;y:number})=>`卡片已向${({left:'左',right:'右',up:'上',down:'下'} as Record<string,string>)[direction]??direction}移动，位置 ${Math.round(x)}，${Math.round(y)}。`,
  'edge.a11yDescription.default':'按 Enter 或空格选择连线，按 Delete 移除，按 Esc 取消选择。',
  'controls.ariaLabel':'画布视图控制','controls.zoomIn.ariaLabel':'放大','controls.zoomOut.ariaLabel':'缩小','controls.fitView.ariaLabel':'查看全部','controls.interactive.ariaLabel':'切换画布交互','minimap.ariaLabel':'画布概览','handle.ariaLabel':'卡片连接点',
};
