import { useEffect, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { CardActions } from '../board-context';
import type { CardData, CardTone } from '../model';
import { getCardSizeLimits } from '../card-size';
import { canActivateCard, isCardControlTarget } from '../card-interaction';
import { CardMenu } from './CardMenu';
import { useLodFrame } from '../canvas/lod';
import { Words } from './Words';
import { installFocusSource } from './focus-source';
import { hasNoteTitle, stationeryKind } from './card-utils';
import type { CardActivate, CardLod } from './types';

interface CardShellProps {
  id: string;
  data: CardData;
  board: CardActions;
  tone: CardTone;
  selected: boolean;
  activeVideo: boolean;
  overview: boolean;
  lod: CardLod;
  hand: boolean;
  editable: boolean;
  noteEditing: boolean;
  menuOpen: boolean;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  menuRef: RefObject<HTMLDivElement | null>;
  activate: CardActivate;
  openCard: () => void;
  beginNoteEditing: () => void;
  /** Interface kind name for the article label (“文字资料”, “摘录”…). */
  kindName: string;
  /** The title as shown (C13 display title for excerpts, “导入未完成：…” for a stopped import). */
  title: string;
  /** Excerpts and default note names stay available to assistive technology. */
  titleHidden?: boolean;
  /** `en` for a Latin title (link cards), so it uses the Latin UI face and English line breaking. */
  titleLang?: string;
  /** Extra modifier, e.g. `article` for a text source drawn as `field-card--article`. */
  variant?: string;
  /** State classes (`is-failed`, `is-importing`, `is-source-gone`, `is-fresh`, `is-lit-source`…). */
  states?: Array<string | false | undefined>;
  /** Rendered before the header in one row (the excerpt's provenance tag). */
  lead?: ReactNode;
  /** Rendered inside the header after the title (excerpt source title, draft stage and length). */
  headerExtra?: ReactNode;
  /** Hover / focus / selection actions shown next to “…” (0 persistent buttons, P1). */
  actions?: ReactNode;
  /** The one meta line: source on the left, state on the right. */
  footer?: ReactNode;
  describedBy?: string;
  style?: CSSProperties;
  /** What sizes the content by itself (a film's ratio): a change re-measures the box the simple tier holds. */
  contentKey?: string | number;
  /** The body renders the output handle itself (on the sentence or length rail, where the thread starts). */
  bodySourceHandle?: boolean;
  /** Icon before the title (the frame label). */
  icon?: ReactNode;
  /** The low-zoom overview layer, rendered only while zoomed out. */
  overviewLayer: ReactNode;
  /** The kind-specific body, rendered between header and footer. */
  children: ReactNode;
}

/**
 * Everything shared by all card kinds (§6.8): the article that carries material, shadow and selection
 * (C14: painted on `.field-card`, so the overview tier keeps paper and selection), its canvas gestures,
 * resize and connection handles, the header, the hover actions with the “…” menu, and the meta footer.
 */
export function CardShell(props: CardShellProps) {
  const {
    id, data, board, tone, selected, activeVideo, overview, lod, hand, editable, noteEditing,
    menuOpen, setMenuOpen, menuRef, activate, openCard, beginNoteEditing, overviewLayer, children,
    kindName, title, titleHidden, titleLang, variant, states = [], lead, headerExtra, actions, footer, describedBy, style,
    contentKey, bodySourceHandle, icon,
  } = props;
  const isFrame = data.kind === 'frame';
  const sizeLimits = getCardSizeLimits(data);
  useEffect(installFocusSource, []);
  // The simple tier re-lays the content inside an unchanged box (K9-7): hold a content-sized card at its
  // measured height; an editor or a running player keeps the full layout. An image card is never held: its
  // height is the picture's ratio, which no tier changes, and a hold froze the 4:3 box measured before the
  // picture loaded (FC-03).
  // A note of pictures is a cover: its height is the first image, so a frozen full-text box would stay blank.
  const coverNote = data.kind === 'note' && !variant && (data.pictures?.length ?? 0) > 0;
  const lodBox = useLodFrame(id, lod, noteEditing || activeVideo || data.kind === 'image' || coverNote, contentKey);
  const className = [
    'field-card',
    `field-card--${data.kind}`,
    `field-card--${tone}`,
    variant && `field-card--${variant}`,
    data.demo && 'is-demo',
    selected && 'is-selected',
    activeVideo && 'is-playing',
    overview && 'is-overview',
    board.readOnly && 'is-readonly',
    hand && 'is-hand',
    noteEditing && 'is-editing',
    ...states,
  ].filter(Boolean).join(' ');

  const header = (
    <header className="field-card__header card-drag">
      {icon}
      <Words as="h3" text={title} className={titleHidden ? 'sr-only' : undefined} lang={titleLang} />
      {headerExtra}
    </header>
  );

  return (
    <article
      className={className}
      data-kind={data.kind}
      data-stationery={stationeryKind(data)}
      data-has-title={hasNoteTitle(data) ? '' : undefined}
      data-has-cover={coverNote ? '' : undefined}
      data-display={overview ? 'overview' : 'detail'}
      data-lod={lod}
      data-lod-frame={lodBox.fixed ? '' : undefined}
      // An excerpt is named by what it says (C13): its stored default “摘录 · <来源>” is the same for every
      // excerpt of one source, so two of them read alike (CANVAS-03). Other kinds keep the stored title.
      aria-label={`${kindName}：${data.kind === 'quote' ? title : data.title || (isFrame ? '未命名分组' : data.kind === 'draft' ? '未命名文稿' : '未命名')}`}
      aria-describedby={describedBy}
      style={lodBox.height ? { ...style, height: lodBox.height } : style}
      onClickCapture={event => {
        // A Shift-click on a visible control still belongs to the node's multiselection handler.
        // Editors and an active player's native controls retain their own selection/seeking gestures.
        if (
          event.shiftKey
          && isCardControlTarget(event.target)
          && !(event.target as Element).closest('textarea, input, select, video, [contenteditable="true"], [role="textbox"]')
        ) event.preventDefault();
      }}
      onKeyDown={event => {
        // Controls handle the key first. Keep their arrow keys away from the node mover,
        // while leaving the browser's text cursor, media seek and focus behavior intact.
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && isCardControlTarget(event.target)) {
          event.stopPropagation();
        }
      }}
      onDoubleClick={event => {
        event.stopPropagation();
        if (!canActivateCard(board.tool, event) || isCardControlTarget(event.target)) return;
        if (editable && data.kind === 'note' && (event.target as Element).closest('[data-note-preview]')) {
          event.preventDefault();
          beginNoteEditing();
          return;
        }
        openCard();
      }}
    >
      <NodeResizer
        isVisible={!!selected && editable && !overview}
        {...sizeLimits}
        keepAspectRatio={data.kind === 'image'}
        lineClassName="field-card__resize-line"
        handleClassName="field-card__resize-handle"
      />
      {!isFrame && <CardHandle type="target" connectable={editable && !overview} />}
      {!isFrame && !bodySourceHandle && <CardHandle type="source" connectable={editable && !overview} />}

      {overviewLayer}
      <div className="field-card__surface" inert={overview || hand} aria-hidden={overview}>
        {lead ? <div className="field-card__head card-drag-content">{lead}{header}</div> : header}

        {children}

        <div className="field-card__actions card-drag-content">
          {actions}
          <CardMenu
            id={id}
            data={data}
            board={board}
            activate={activate}
            openCard={openCard}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            menuRef={menuRef}
          />
        </div>

        {!isFrame && (
          <footer className={`field-card__footer card-drag-content${footer ? '' : ' is-empty'}`}>
            {footer}
          </footer>
        )}
      </div>
    </article>
  );
}

/**
 * Left-in / right-out connection points, drawn as 10px hollow rings on hover (§6.8). They sit where the
 * threads tie: an excerpt's input on its tag hole (CSS), a video's or article's output on its rail (the
 * body renders that one inside the rail). Frames have none. Exactly one handle of each kind per card:
 * the smoke scripts address them by name.
 */
export function CardHandle({ type, connectable }: { type: 'source' | 'target'; connectable: boolean }) {
  return (
    <Handle
      type={type}
      position={type === 'target' ? Position.Left : Position.Right}
      className="field-card__handle"
      isConnectable={connectable}
      aria-label={type === 'target' ? '连接到这张卡片' : '从这张卡片连线'}
    />
  );
}
