export interface CardActivationEvent {
  shiftKey?: boolean;
  defaultPrevented?: boolean;
}

/** Shift belongs to canvas selection; the hand tool belongs to navigation. */
export function canActivateCard(tool: 'select' | 'hand' | undefined, event?: CardActivationEvent) {
  return tool !== 'hand' && !event?.shiftKey && !event?.defaultPrevented;
}

/** Controls own their double click (text selection, playback, menus), never the card opener. */
export function isCardControlTarget(target: EventTarget | null) {
  return typeof Element !== 'undefined' && target instanceof Element && !!target.closest(
    'button, textarea, input, select, a, video, [contenteditable="true"], [role="textbox"], .react-flow__handle, .react-flow__resize-control',
  );
}

/** Editing must stop before canvas selection/navigation takes ownership again. */
export function canKeepNoteEditing(selected: boolean | undefined, readOnly: boolean | undefined, tool: 'select' | 'hand' | undefined, overview: boolean) {
  return !!selected && !readOnly && tool !== 'hand' && !overview;
}
