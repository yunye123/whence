import { useCallback } from 'react';
import { useStoreApi } from '@xyflow/react';
import type { CardMeasurements } from '../card-placement';

type FlowStore = ReturnType<typeof useStoreApi>;

/**
 * The canvas's measured card sizes (React Flow `measured`, the same numbers App feeds `frameContainsCard`
 * for the tray label), so a dialog counts a group exactly like the canvas does (FC-01): an image without a
 * stored height follows its picture's ratio on the canvas, and only the measurement knows how tall it is.
 * Dialogs also render outside the canvas (tests, static markup); there is nothing to read there.
 */
export function useCanvasMeasurements(): () => CardMeasurements {
  let store: FlowStore | null = null;
  // useStoreApi throws outside <ReactFlowProvider>. That does not change while a dialog is mounted,
  // so the hooks it calls stay in the same order on every render.
  try { store = useStoreApi(); } catch { store = null; }
  return useCallback(() => {
    const result: CardMeasurements = {};
    if (!store) return result;
    for (const [id, node] of store.getState().nodeLookup) {
      const width = node.measured?.width, height = node.measured?.height;
      if (width && height) result[id] = { width, height };
    }
    return result;
  }, [store]);
}
