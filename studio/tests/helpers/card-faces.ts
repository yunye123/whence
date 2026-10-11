
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import CanvasCard from '../../src/CanvasCard';
import { CardContext, type CardActions } from '../../src/board-context';
import { createExampleBoard } from '../../src/templates';
import { CardData } from '../../src/model';
import { isTextSource } from '../../src/cards/card-utils';

// Behaviour of the redesigned card faces (DESIGN_SYSTEM §6.8–6.15): accessible names, what the face says
// and what it never shows. Class names are only asserted where they are a contract (K3/K5/K10, C13).

export const noop = () => {};
export function render(data: CardData, overrides: Partial<CardActions> & Record<string, unknown> = {}, id = 'card') {
  const actions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, focusSource: noop,
    getMediaUrl: (mediaId?: string) => mediaId ? 'blob:isolated-media' : undefined, activeVideo: null, inspectedId: null, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop,
    captureVideoPlayback: noop, restoreVideoPlayback: noop, cancelVideoImport: noop, retryVideoImport: noop,
    videoImportAvailable: true, videoImportActionPending: () => false, sourceNodeIds: new Set<string>(), tool: 'select',
    ...overrides,
  } as CardActions;
  const props = { id, selected: false, data } as NodeProps<Node<CardData>>;
  return renderToStaticMarkup(createElement(ReactFlowProvider, null,
    createElement(CardContext.Provider, { value: actions }, createElement(CanvasCard, props)),
  ));
}

export const video = createExampleBoard('video');
export const writing = createExampleBoard('writing');
export const film = video.nodes.find(node => node.data.kind === 'video')!;
export const filmQuote = video.nodes.find(node => node.data.kind === 'quote')!;
export const article = writing.nodes.find(node => isTextSource(node.data))!;
export const textQuote = writing.nodes.find(node => node.data.kind === 'quote' && node.data.citation?.nodeId === article.id)!;
export const draft = writing.nodes.find(node => node.data.kind === 'draft')!;

