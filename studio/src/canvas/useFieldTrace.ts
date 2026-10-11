import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStoreApi, type Edge, type Node } from '@xyflow/react';
import type { Board, CardData } from '../model';
import { createFieldTrace, type FieldTraceController } from './trace-player';

type EdgeData = { kind?: string; to?: string } | undefined;

/**
 * App 里的溯光与系签（DESIGN_SYSTEM.md §6.17、§7）。必须在 ReactFlowProvider 之内调用（App 已在其中）。
 * 返回的对象在组件生命周期内不变，可以放进 useCallback 的依赖里。接线见 docs/redesign/integration/trace.md。
 */
export function useFieldTrace(getBoard: () => Pick<Board, 'nodes' | 'edges'> | null | undefined): FieldTraceController {
  const store = useStoreApi<Node<CardData>, Edge>();
  const flow = useReactFlow<Node<CardData>, Edge>();
  const latest = useRef({ store, flow, getBoard });
  latest.current = { store, flow, getBoard };
  const [controller] = useState(() => createFieldTrace({
    root: () => latest.current.store.getState().domNode ?? null,
    zoom: () => latest.current.store.getState().transform[2] || 1,
    nodeRect: id => {
      const node = latest.current.store.getState().nodeLookup.get(id);
      const width = node?.measured?.width ?? node?.width, height = node?.measured?.height ?? node?.height;
      if (!node || !width || !height) return null;
      const { x, y } = node.internals.positionAbsolute;
      return { x, y, width, height };
    },
    getViewport: () => latest.current.flow.getViewport(),
    setViewport: (viewport, options) => { void latest.current.flow.setViewport(viewport, options); },
    board: () => latest.current.getBoard(),
    excerptEdgeOf: quoteId => {
      const state = latest.current.store.getState();
      const citation = state.nodeLookup.get(quoteId)?.data?.citation?.nodeId;
      const edge = state.edges.find(item => {
        const data = item.data as EdgeData;
        return data?.kind ? data.kind === 'excerpt' && data.to === quoteId : item.target === quoteId && item.source === citation;
      });
      return edge?.id ?? null;
    },
  }));
  useEffect(() => controller.attach(), [controller]);
  return controller;
}
