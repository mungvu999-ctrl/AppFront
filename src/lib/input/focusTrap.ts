/**
 * A focus trap for dialogs and sliding panels.
 *
 * The keyboard must be able to go everywhere, and inside a modal layer
 * "everywhere" means "in here, around, and back out to where you came
 * from". Three promises, each one checked by a test rather than trusted:
 *
 * - **Tab cycles inside the layer.** From the last control Tab lands on the
 *   first, Shift+Tab from the first lands on the last, and a press that
 *   somehow finds the focus outside the layer drags it back in. A layer
 *   with nothing focusable keeps the focus on its own container — the
 *   focus never vanishes off the page.
 * - **Escape closes.** The trap does not know what closing means — when the
 *   owner gives an `onEscape` it calls it and stops the event there, so the
 *   shortcut arbiter (shortcutRegistry) never handles the same press a
 *   second time. A trap with no `onEscape` swallows nothing: the press keeps
 *   bubbling to the window listener, because "Esc đóng lớp trên cùng"
 *   (invariant A12) must hold even for a layer that forgot to wire closing.
 * - **Focus goes home.** The element focused at `activate` is remembered
 *   and focused again at `release` (a focused `body` is no opener); if
 *   there was none, or it has left the document by then,
 *   focus falls to the caller's fallback, then to the first focusable
 *   element on the page, and as a last resort to `body` — anywhere but
 *   nowhere.
 *
 * The keydown listener lives on the layer's own container element, never
 * on `window`: the one window listener in the codebase belongs to the
 * shortcut registry, and a trap is local behaviour of one layer, exactly
 * like the Tab handling `Modal.tsx` does inline.
 *
 * Pure DOM, no React — a component wires it in an effect, a test wires it
 * with `document.createElement`.
 */

/**
 * Everything that can take the focus. Positive tab indexes are forbidden in
 * this codebase (checked by `findPositiveTabIndexes` in focusOrder.ts), so
 * document order is tab order and no sorting is needed here.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(', ');

/**
 * The elements inside `container` a Tab press can reach, in document order.
 *
 * Skips negative tab indexes (focusable by script, not by Tab) and anything
 * inside a hidden or aria-hidden subtree. Visibility from layout is not
 * consulted — jsdom has no layout, and the seven-state rule keeps hidden
 * interface behind `hidden`/`aria-hidden` rather than bare CSS.
 */
export function getFocusableElements(container: HTMLElement): readonly HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

  return candidates.filter((element) => {
    const tabIndex = element.getAttribute('tabindex');

    if (tabIndex !== null && Number.parseInt(tabIndex, 10) < 0) {
      return false;
    }

    // Content of a closed <details> (a collapsed menu) is not rendered, so it can neither
    // take the focus nor be a Tab stop; counting it made the trap focus nothing (UX #4).
    const closed = element.closest('details:not([open])');

    if (closed !== null && !element.closest('summary')) {
      return false;
    }

    return element.closest('[hidden], [aria-hidden="true"]') === null;
  });
}

export interface FocusTrapOptions {
  /** Called on Escape. The owner decides what closing means. */
  onEscape?: () => void;
  /**
   * Focused on activate. Defaults to the element the layer marks with
   * `data-autofocus` (the field a form opens on), then the first focusable,
   * then the container.
   */
  initialFocus?: HTMLElement;
  /** Focused on release when the opener has left the document. */
  fallbackFocus?: HTMLElement;
}

export interface FocusTrapHandle {
  /** Remembers the opener, moves focus in, starts trapping. Idempotent. */
  activate(): void;
  /** Stops trapping and sends the focus home. Idempotent. */
  release(): void;
}

export function createFocusTrap(
  container: HTMLElement,
  options: FocusTrapOptions = {},
): FocusTrapHandle {
  let active = false;
  let opener: HTMLElement | null = null;

  const doc = container.ownerDocument;

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      // Swallow only when someone actually handles it: an untended Escape
      // must still reach the shortcut arbiter on `window` (invariant A12),
      // and `onEscape` is optional.
      if (options.onEscape === undefined) {
        return;
      }

      // An open popup inside the layer (a Select's combobox carries
      // aria-expanded="true") is the top layer: Esc is its own to close,
      // not the dialog's (invariant A12, BUG-152). An open disclosure button
      // also carries aria-expanded but owns no popup, so it does not count.
      if (
        event.target instanceof Element &&
        event.target.getAttribute('aria-expanded') === 'true' &&
        (event.target.getAttribute('role') === 'combobox' || event.target.hasAttribute('aria-haspopup'))
      ) {
        return;
      }

      event.stopPropagation();
      options.onEscape();

      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusableElements(container);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (first === undefined || last === undefined) {
      // Nothing to cycle through: the focus stays on the container rather
      // than tabbing out of the layer.
      event.preventDefault();
      container.focus();

      return;
    }

    const current = doc.activeElement;
    const atEdge = event.shiftKey ? current === first : current === last;
    const outside = current === container || !container.contains(current);

    if (atEdge || outside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  /** The chain that guarantees the focus lands somewhere, in order of merit. */
  const sendFocusHome = (): void => {
    if (opener !== null && opener.isConnected) {
      opener.focus();

      return;
    }

    if (options.fallbackFocus !== undefined && options.fallbackFocus.isConnected) {
      options.fallbackFocus.focus();

      return;
    }

    // No opener (the layer opened from an unfocused page): the page's work area
    // is home, never the first tab stop, which is the "skip to content" link (#5).
    const home = doc.querySelector<HTMLElement>('[data-focus-home], [data-app-content], main, [role="main"]');

    if (home !== null && !container.contains(home)) {
      if (!home.hasAttribute('tabindex')) {
        home.tabIndex = -1;
      }

      home.focus({ preventScroll: true });

      return;
    }

    const elsewhere = getFocusableElements(doc.body).find(
      (element) => !container.contains(element),
    );

    // The two guesses below were never chosen by anyone: they take the focus without
    // scrolling, so closing a layer opened from an unfocused page keeps the reader's place (R1-01).
    if (elsewhere !== undefined) {
      elsewhere.focus({ preventScroll: true });

      return;
    }

    // Last resort: an empty page. Body takes a programmatic focus so the
    // focus exists somewhere rather than nowhere.
    doc.body.tabIndex = -1;
    doc.body.focus({ preventScroll: true });
  };

  const activate = (): void => {
    if (active) {
      return;
    }

    active = true;
    // A layer that opens on mount finds `body` focused. Body is no opener: going "home"
    // to it strands the keyboard, so release falls through to the fallback chain (BUG-559).
    opener =
      doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;

    if (!container.hasAttribute('tabindex')) {
      // Negative, so the container can hold the focus without joining the
      // Tab order (positive indexes are forbidden).
      container.tabIndex = -1;
    }

    container.addEventListener('keydown', handleKeyDown);

    const focusable = getFocusableElements(container);
    const marked = focusable.find((element) => element.hasAttribute('data-autofocus'));

    (options.initialFocus ?? marked ?? focusable[0] ?? container).focus();

    // A candidate that cannot take the focus (display:none, inert) leaves it outside:
    // try the rest, then the container, so the focus never stays behind the layer.
    for (const element of focusable) {
      if (container.contains(doc.activeElement)) {
        break;
      }

      element.focus();
    }

    if (!container.contains(doc.activeElement)) {
      container.focus();
    }
  };

  const release = (): void => {
    if (!active) {
      return;
    }

    active = false;
    container.removeEventListener('keydown', handleKeyDown);
    sendFocusHome();
    opener = null;
  };

  return { activate, release };
}
