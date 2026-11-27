// Where a key press really came from. Extension parts render in a Shadow DOM, and for a listener outside it the
// browser retargets the event: e.target is the part's box, not the input inside it. So "is the person typing?"
// must look at the first element of the event's path, or every letter typed in an extension fires a shortcut.

/** The element the key was pressed in (inside a part's shadow root too). */
export const keyOrigin = (e) => e.composedPath?.()[0] ?? e.target

/** Did the key come from inside an extension part (a shadow root)? */
export const fromPart = (e) => keyOrigin(e) !== e.target

/** Is the person typing in a text field, a select or editable text? */
export function typingIn(e) {
  const el = keyOrigin(e)
  return !!(el?.isContentEditable || el?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
}

/** A text field where the browser's own undo applies (not a checkbox, button…). */
export function textFieldIn(e) {
  const el = keyOrigin(e)
  if (el?.isContentEditable || el?.closest?.('textarea')) return true
  return el?.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color', 'submit'].includes(el.type)
}
