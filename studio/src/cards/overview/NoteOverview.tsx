import { Words } from '../Words';
import { segmentText } from '../text-measure';
import type { CardOverviewProps } from './types';

export function NoteOverview({ data, title }: CardOverviewProps) {
  const first = segmentText(data.body, 'sentence').find(run => run.text.trim());
  return (
    <div className="field-card__overview field-card__overview--note card-drag" aria-hidden="true">
      <div className="field-card__overview-content">
        <Words as="h3" text={first?.text || title} />
      </div>
    </div>
  );
}
