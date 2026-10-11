import { Words } from '../Words';
import type { CardOverviewProps } from './types';

export function QuoteOverview({ data, title }: CardOverviewProps) {
  const original = data.citation?.text ?? data.body;
  const sentence = original.trim() ? original : title;
  return (
    <div className="field-card__overview field-card__overview--quote card-drag" aria-hidden="true">
      {data.citation && (
        <span className="field-card__overview-tag" data-edge-anchor="stamp" />
      )}
      <div className="field-card__overview-content">
        <Words as="h3" text={sentence} />
      </div>
    </div>
  );
}
