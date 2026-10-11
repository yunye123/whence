import { isTextSource } from './card-utils';
import { VideoOverview } from './overview/VideoOverview';
import { ImageOverview } from './overview/ImageOverview';
import { FolderOverview } from './overview/FolderOverview';
import { QuoteOverview } from './overview/QuoteOverview';
import { DraftOverview } from './overview/DraftOverview';
import { NoteOverview } from './overview/NoteOverview';
import { FrameOverview } from './overview/FrameOverview';
import type { CardOverviewProps } from './overview/types';

// Keep the public helper exports used by the existing LOD contract tests.
export { overviewText, unbreakableHyphens } from './overview/text';
export { draftOverviewParagraphs, type DraftOverviewParagraph } from './overview/DraftOverview';
export { frameLabelBlocked } from './overview/FrameOverview';

/** Dispatch only: card-specific silhouettes are owned alongside their card faces. */
export function CardOverview(props: CardOverviewProps) {
  if (props.data.kind === 'frame') return <FrameOverview id={props.id} title={props.title} frameCount={props.frameCount} />;
  if (props.data.kind === 'image') return <ImageOverview {...props} />;
  if (props.data.kind === 'video') return <VideoOverview {...props} />;
  if (props.data.kind === 'quote') return <QuoteOverview {...props} />;
  if (props.data.kind === 'draft') return <DraftOverview {...props} />;
  if (props.data.kind === 'note' && !isTextSource(props.data)) return <NoteOverview {...props} />;
  return <FolderOverview {...props} />;
}
