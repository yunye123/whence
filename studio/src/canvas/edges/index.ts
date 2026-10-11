/**
 * 连线（DESIGN_SYSTEM.md §6.17，不含溯光动画）。App 侧的接入方法见 docs/redesign/integration/edges.md。
 */
import type { DefaultEdgeOptions, EdgeTypes } from '@xyflow/react';
import { FieldEdge } from './FieldEdge';
import { CITE_EDGE_TYPE } from './model';

export { FieldEdge } from './FieldEdge';
export { FieldConnectionLine, cardAtPoint } from './FieldConnectionLine';
export { buildFlowEdges, useFieldFlowEdges, storedEdgeChanges, type FieldFlowEdge } from './flow-edges';
export { resolveConnectionDrop, CONNECT_HINT, FIELD_CONNECTION_RADIUS, type ConnectionDrop } from './connect';
export { CITE_EDGE_PREFIX, CITE_EDGE_TYPE, isDerivedEdgeId, fieldEdgeRecords, edgeEmphasis, edgeAriaLabel, draftCitations, type FieldEdgeData, type FieldEdgeKind } from './model';

/**
 * 已保存连线的 `type` 原样保留（K1：smoothstep 是“默认样式”的别名），全部由 FieldEdge 画；
 * 未知类型 React Flow 会回落到 `default`，同样是 FieldEdge。
 */
export const fieldEdgeTypes: EdgeTypes = {
  default: FieldEdge,
  smoothstep: FieldEdge,
  step: FieldEdge,
  straight: FieldEdge,
  simplebezier: FieldEdge,
  [CITE_EDGE_TYPE]: FieldEdge,
};

/** 不再写颜色：线的颜色、粗细、标签字体都来自 features/edges.css 的语义令牌。命中区由 FieldEdge 自己画。 */
export const fieldDefaultEdgeOptions: DefaultEdgeOptions = { type: 'smoothstep', interactionWidth: 0 };
