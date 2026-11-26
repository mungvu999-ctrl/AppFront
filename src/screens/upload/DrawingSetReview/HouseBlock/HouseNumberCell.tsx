/**
 * Một ô số sửa được của khối "Ngôi nhà" (NHA-08b/08c) — VIEW THUẦN, dùng chung cho bảng tầng và thẻ mái: giá trị
 * kèm chip nguồn, nút "Nhận" (chấp nhận số của máy, nếu có), "Sửa" (mở ô nhập) và "Bỏ số đã nhập".
 *
 * Không có nút lưu (A7): Enter hoặc rời ô là ghi vào bản duyệt, Esc đóng ô mà không ghi. Trạng thái duy nhất
 * giữ ở đây là chữ đang gõ trong ô sửa; đọc chữ thành số là việc của viewmodel (`read`).
 */

import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MISSING_VALUE } from '@/lib/format/number';
import type { HouseCell } from '@/lib/viewmodel/setBuilding';
import type { NumberRead } from '@/lib/viewmodel/setBuildingDecisions';

const TEXT = { accept: 'Nhận', edit: 'Sửa', clear: 'Bỏ số đã nhập' } as const;

export function HouseValue({ cell }: { cell: HouseCell | null }) {
  if (cell === null) return <span className="text-text-secondary">{MISSING_VALUE}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-text-primary">{cell.text}</span>
      <Badge variant={cell.status}>{cell.chip}</Badge>
    </span>
  );
}

export interface HouseNumberCellProps {
  readonly cell: HouseCell | null;
  /** Chữ của số người duyệt đã nhập, đặt sẵn vào ô sửa; rỗng khi chưa nhập. */
  readonly typedText: string;
  /** Nhãn ô nhập, kèm đơn vị. */
  readonly inputLabel: string;
  readonly inputMode?: 'numeric' | 'text';
  /** Nhãn đọc lên của nút "Sửa" và nút "Bỏ số đã nhập": nói rõ ô nào, và mở đầu bằng đúng chữ trên nút. */
  readonly editLabel: string;
  readonly clearLabel: string;
  /** Có khi máy có số nhận được: nút "Nhận". */
  readonly accept?: { readonly label: string; readonly run: () => void } | undefined;
  readonly read: (text: string) => NumberRead;
  /** `undefined` = bỏ số đã nhập, quay về giá trị của máy. */
  readonly onSet: (value: number | undefined) => void;
}

export function HouseNumberCell({
  accept,
  cell,
  clearLabel,
  editLabel,
  inputLabel,
  inputMode = 'numeric',
  onSet,
  read,
  typedText,
}: HouseNumberCellProps) {
  /** Chữ đang gõ; `null` = ô sửa đang đóng. */
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  /** Ô vừa được đóng có chủ ý: sự kiện rời ô lúc nó bị gỡ khỏi trang không được ghi lại lần nữa (Esc là huỷ). */
  const doneRef = useRef(false);
  const isOpen = draft !== null;
  const hasTyped = typedText !== '';

  // Bàn phím (A12): mở ô thì con trỏ vào ô, đóng ô thì trả về nút "Sửa".
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
    else if (wasOpenRef.current) editButtonRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const close = (): void => {
    doneRef.current = true;
    setDraft(null);
    setProblem(null);
  };
  const commit = (text: string): void => {
    if (text.trim() === '') {
      // Xoá trắng ô: bỏ số đã nhập (nếu có) rồi đóng.
      if (hasTyped) onSet(undefined);
      close();

      return;
    }
    const result = read(text);

    if ('problem' in result) {
      setProblem(result.problem);

      return;
    }
    onSet(result.value);
    close();
  };

  return (
    <div className="flex flex-col gap-1">
      <HouseValue cell={cell} />
      {draft === null ? (
        <span className="flex flex-wrap gap-1">
          {accept === undefined ? null : (
            <Button
              aria-label={accept.label}
              onClick={() => {
                accept.run();
                // Nút này sắp biến mất: giữ tiêu điểm trong ô cho người dùng bàn phím.
                editButtonRef.current?.focus();
              }}
              size="sm"
              variant="ghost"
            >
              {TEXT.accept}
            </Button>
          )}
          <Button
            aria-label={editLabel}
            onClick={() => {
              doneRef.current = false;
              setDraft(typedText);
            }}
            ref={editButtonRef}
            size="sm"
            variant="ghost"
          >
            {TEXT.edit}
          </Button>
          {hasTyped ? (
            <Button
              aria-label={clearLabel}
              onClick={() => {
                onSet(undefined);
                editButtonRef.current?.focus();
              }}
              size="sm"
              variant="ghost"
            >
              {TEXT.clear}
            </Button>
          ) : null}
        </span>
      ) : (
        <Input
          error={problem ?? undefined}
          inputMode={inputMode}
          label={inputLabel}
          onBlur={() => {
            // Rời ô mà không đổi gì thì đóng; có đổi thì ghi như Enter.
            if (doneRef.current) return;
            if (draft === typedText) close();
            else commit(draft);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Không chặn thì phím rơi tiếp vào nút "Sửa" vừa nhận lại tiêu điểm và mở lại ô.
              event.preventDefault();
              commit(draft);
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
          ref={inputRef}
          value={draft}
        />
      )}
    </div>
  );
}
