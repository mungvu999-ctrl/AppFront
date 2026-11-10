import { useEffect, useState, type RefObject } from 'react';

import { createFocusTrap } from '@/lib/input/focusTrap';

/** Dưới `lg` (1024) cột việc là ngăn kéo; từ 1024 nó là cột tĩnh, không phải hộp thoại. */
const NARROW_QUERY = '(max-width: 1023.98px)';
const SCRIM_ATTR = 'data-qc-scrim';

const isNarrow = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;

/**
 * Ngăn kéo cột việc mở ở khổ hẹp (#4) là lớp modal: focus vào ngăn, Tab vòng trong ngăn, Esc đóng,
 * đóng thì trả focus về nút mở, phần nền (trừ nền mờ để bấm đóng) `inert`.
 * Trả về `true` khi ngăn đang là hộp thoại — nơi gọi gắn `role="dialog" aria-modal` theo đó.
 */
export function useColumnDrawerLayer(columnRef: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): boolean {
  const [narrow, setNarrow] = useState(isNarrow);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const isModal = open && narrow;

  useEffect(() => {
    const column = columnRef.current;
    if (!isModal || column === null) return undefined;
    const background = Array.from(column.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element !== column && !element.hasAttribute(SCRIM_ATTR),
    );
    background.forEach((element) => element.setAttribute('inert', ''));
    const trap = createFocusTrap(column, { onEscape: onClose });
    trap.activate();
    return () => {
      // Bỏ inert trước: nút mở nằm trong nền, release mới focus lại được nó.
      background.forEach((element) => element.removeAttribute('inert'));
      trap.release();
    };
    // onClose đổi mỗi lần render; bẫy chỉ dựng lại khi ngăn mở/đóng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModal, columnRef]);

  return isModal;
}

export { SCRIM_ATTR };
