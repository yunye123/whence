import { useMemo } from 'react';
import { approxCharacters, articleCharacters, isLatinText, isTextSource } from '../card-utils';
import { Words } from '../Words';
import { unbreakableHyphens } from './text';
import type { CardOverviewProps } from './types';

export function FolderOverview({ data, title }: CardOverviewProps) {
  const kind = isTextSource(data) ? 'article' : data.kind;
  const length = useMemo(() => (kind === 'article' ? approxCharacters(articleCharacters(data.body)) : ''), [kind, data.body]);
  const latin = data.kind === 'link' && isLatinText(title);
  return (
    <div className={`field-card__overview field-card__overview--${kind} card-drag`} data-folder-overview={kind} aria-hidden="true">
      <div className="field-card__overview-content">
        {latin ? <h3 lang="en">{unbreakableHyphens(title)}</h3> : <Words as="h3" text={title} />}
        {length && <span className="field-card__overview-sub">{length}</span>}
      </div>
    </div>
  );
}
