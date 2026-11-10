/**
 * Trả tiêu điểm cho biểu mẫu sau một lượt gửi (nợ QA-01 #21).
 *
 * Lúc gửi, ô và nút bị khoá (`disabled`), và trình duyệt thả tiêu điểm khỏi phần tử vừa bị khoá
 * về `body`: người dùng bàn phím mất chỗ đứng, Tab kế tiếp bắt đầu lại từ đầu trang. Hook nhớ
 * phần tử cuối cùng có tiêu điểm trong biểu mẫu, và khi lượt gửi xong mà tiêu điểm vẫn nằm ở
 * `body` thì đưa nó về đó — hoặc, nếu phần tử ấy còn khoá (nút gửi sau khi đã gửi, lúc bị khoá
 * 429), về phần tử đầu tiên còn dùng được trong biểu mẫu. Tiêu điểm người dùng đã tự dời đi chỗ
 * khác thì không giật lại.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const FOCUSABLE = 'input:not(:disabled), button:not(:disabled), a[href]';

export function useReturnFocus(isBusy: boolean): {
  readonly ref: React.RefObject<HTMLFormElement | null>;
  readonly onFocus: (event: React.FocusEvent<HTMLFormElement>) => void;
} {
  const ref = useRef<HTMLFormElement>(null);
  const last = useRef<HTMLElement | null>(null);
  const wasBusy = useRef(isBusy);

  const onFocus = useCallback((event: React.FocusEvent<HTMLFormElement>) => {
    if (event.target instanceof HTMLElement) {
      last.current = event.target;
    }
  }, []);

  useEffect(() => {
    const finished = wasBusy.current && !isBusy;
    wasBusy.current = isBusy;

    const active = document.activeElement;

    if (!finished || (active !== null && active !== document.body)) {
      return;
    }

    const remembered = last.current;
    const target =
      remembered !== null && remembered.isConnected && !remembered.matches(':disabled')
        ? remembered
        : ref.current?.querySelector<HTMLElement>(FOCUSABLE);

    target?.focus();
  }, [isBusy]);

  return { ref, onFocus };
}

/**
 * Bọc `submit`: sau mỗi lượt gửi, khi lượt vẽ đã có câu lỗi, tiêu điểm nhảy tới ô
 * `aria-invalid` đầu tiên trong `containerRef` (UX audit A-10) — người dùng bàn phím
 * khỏi phải Shift+Tab đi tìm lỗi.
 */
export function useFocusFirstInvalid(containerRef: RefObject<HTMLElement | null>, submit: () => void): () => void {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt === 0) return;
    containerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt, containerRef]);
  return useCallback(() => {
    submit();
    setAttempt((count) => count + 1);
  }, [submit]);
}
