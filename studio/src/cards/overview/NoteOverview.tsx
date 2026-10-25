import { Words } from '../Words';
import { segmentText } from '../text-measure';
import type { CardOverviewProps } from './types';

export function NoteOverview({ data, title, cover }: CardOverviewProps) {
  const first = segmentText(data.body, 'sentence').find(run => run.text.trim());
  const count = data.pictures?.length ?? 0;
  return (
    <div className={`field-card__overview field-card__overview--note card-drag${cover ? ' has-picture' : ''}`} aria-hidden="true">
      {cover && <img src={cover} alt="" draggable={false} />}
      <div className="field-card__overview-content">
        <Words as="h3" text={cover ? title : (first?.text || title)} />
        {cover && count > 1 && <span className="field-card__overview-sub">{count} 张</span>}
      </div>
    </div>
  );
}
