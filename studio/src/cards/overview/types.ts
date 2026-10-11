import type { CardData } from '../../model';
import type { CardMedia } from '../types';

export interface CardOverviewProps {
  /** The node id: a frame checks whether its label has room above the tray. */
  id?: string;
  data: CardData;
  media: CardMedia;
  /** The title as the card face shows it (video import state, excerpt display title). */
  title: string;
  /** The in-card player is running: the overview keeps a 6px light dot (§6.8 播放中, CV-M3). */
  playing?: boolean;
  /** Cards wholly inside a frame, when App provides the count (“4 张”). */
  frameCount?: number;
  /** Same outer CSS-px width as the face; overview planning must not read DOM geometry. */
  previewWidth?: number;
}


