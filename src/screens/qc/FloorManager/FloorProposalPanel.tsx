/**
 * Thanh + bảng "Đề xuất của máy cho cả nhà" (Mức 3, lát cắt 1, việc F3/F5) — VIEW THUẦN.
 *
 * Nhận dòng và câu tóm tắt đã viết sẵn từ `@/lib/viewmodel/houseProposal`; không lấy dữ liệu, không
 * đụng kho. Việc ẩn cả bảng (công tắc tắt, lượt đọc đầu, không có gì để hiện) là của container.
 *
 * ## Gọn
 *
 * Mặc định là MỘT thanh: tên, câu tóm tắt, nút "Xem đề xuất" (`aria-expanded`). Thu gọn thì không còn gì
 * bấm được khác. Không có nút nhận hàng loạt: mỗi ô nhận riêng, một lượt một lúc (`busy`).
 *
 * ## Bảy trạng thái (A11) của bảng
 *
 * | `state`     | Vẽ gì                                                                          |
 * |-------------|--------------------------------------------------------------------------------|
 * | `empty`     | một dòng "Máy chưa có đề xuất nào" (container không bao giờ vẽ trạng thái này)  |
 * | `loading`   | thanh đầu "đang đọc" + khung xương (chỉ khi đọc lại sau lỗi)                    |
 * | `partial`   | thanh (+ bảng khi mở); tầng máy không đề xuất có một dòng nói rõ                |
 * | `error`     | một dòng lặng trong thanh: "Chưa lấy được đề xuất của máy." + "Thử lại"         |
 * | `success`   | thanh (+ bảng khi mở)                                                           |
 * | `forbidden` | như `success`, chỉ đọc: không có nút "Nhận" nào                                 |
 * | `collapsed` | luôn chỉ thanh, bất kể `expanded` (cho story và bài kiểm A11)                   |
 *
 * Luật A5: nói MỘT lần là đề xuất chưa có người duyệt; chip độ chắc bằng lời; không chỗ nào dùng xanh
 * "đã xác minh", kể cả sau khi nhận. Thứ tự dòng là thứ tự tầng của dự án, giống bảng tầng bên dưới.
 */

import { useEffect, useRef } from 'react';

import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import type { HouseProposalRowVm, HouseProposalSummary } from '@/lib/viewmodel/houseProposal';

import { FloorProposalRow, type FloorProposalField } from './FloorProposalRow';

export type { FloorProposalField };

export type FloorProposalState = 'empty' | 'loading' | 'partial' | 'error' | 'success' | 'forbidden' | 'collapsed';

export interface FloorProposalPanelProps {
  readonly state: FloorProposalState;
  readonly rows: readonly HouseProposalRowVm[];
  readonly summary: HouseProposalSummary;
  /** Bảng đang mở (trạng thái do hook giữ suốt phiên). */
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Một lượt "Nhận" đang chạy: mọi nút "Nhận" tắt. */
  readonly busy: boolean;
  /** Khoá `floorId:field` đã nhận trong phiên (`acceptedKey`). */
  readonly accepted: ReadonlySet<string>;
  /** Câu kết quả lượt nhận: hiện ngay dưới thanh, cũng là vùng thông báo lịch sự duy nhất của bảng. */
  readonly message: string;
  /** Đối tượng mới sau mỗi lượt nhận được: dời tiêu điểm về ô đầu dòng. */
  readonly focus: { readonly floorId: string } | null;
  /** Nhận một ô của một tầng. */
  readonly onAccept: (row: HouseProposalRowVm, field: FloorProposalField) => void;
  /** Đánh dấu / bỏ đánh dấu bản vẽ của dòng là mặt cắt (dùng chung `busy`). */
  readonly onToggleSection: (row: HouseProposalRowVm) => void;
  readonly onRetry: () => void;
}

const TITLE = 'Đề xuất của máy cho cả nhà';
const NOT_VERIFIED_NOTE = 'Đây là đề xuất của máy, chưa có người duyệt.';
const LOADING_HEADLINE = 'Máy đang đọc các bản vẽ…';
const ERROR_LINE = 'Chưa lấy được đề xuất của máy.';
const EXPAND_LABEL = 'Xem đề xuất';
const COLLAPSE_LABEL = 'Ẩn đề xuất';
const RETRY_LABEL = 'Thử lại';
const EMPTY_TITLE = 'Máy chưa có đề xuất nào.';
const EMPTY_DESCRIPTION = 'Bạn vẫn nhập tay được ở bảng tầng.';
const CAPTION = 'Đề xuất của máy theo từng tầng, cùng thứ tự với bảng tầng bên dưới.';
const SCROLL_LABEL = 'Bảng đề xuất theo tầng';
const HEADERS = ['Tầng', 'Cao độ (hiện tại → đề xuất)', 'Chiều cao (hiện tại → đề xuất)'] as const;
const SECTION_HINT = 'Có bản vẽ mặt cắt? Tải nó lên như một tầng thêm rồi bấm “Đây là mặt cắt” ở dòng đó.';
const SKELETON_KEYS = ['a', 'b'] as const;

export function FloorProposalPanel(props: FloorProposalPanelProps) {
  const { state, rows, summary, onAccept, onToggleSection, onRetry, busy, accepted, focus } = props;
  const hasTable = state === 'partial' || state === 'success' || state === 'forbidden';
  const open = hasTable && props.expanded;
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (focus === null) {
      return;
    }
    const header = tableRef.current?.querySelector<HTMLElement>(`[data-floor-header="${CSS.escape(focus.floorId)}"]`);
    header?.focus();
  }, [focus]);

  if (state === 'empty') {
    return (
      <section aria-label={TITLE} className="rounded-lg border border-border-default px-4 py-2 text-[14px] text-text-secondary">
        <span className="font-semibold text-text-primary">{EMPTY_TITLE}</span> {EMPTY_DESCRIPTION}
      </section>
    );
  }

  const headline = state === 'loading' ? LOADING_HEADLINE : state === 'error' ? ERROR_LINE : summary.headline;
  const toggle = hasTable || state === 'collapsed';

  return (
    <section aria-busy={state === 'loading'} aria-label={TITLE} className="flex flex-col gap-2 rounded-lg border border-border-default px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-72 flex-wrap items-baseline gap-x-2 text-[14px]">
          <h2 className="font-semibold text-text-primary">{TITLE}</h2>
          <p className="text-text-secondary">{headline}</p>
        </div>
        {state === 'error' ? (
          <Button onClick={onRetry} size="sm" variant="ghost">
            {RETRY_LABEL}
          </Button>
        ) : null}
        {toggle ? (
          <Button aria-expanded={open} onClick={props.onToggleExpanded} size="sm" variant="ghost">
            {open ? COLLAPSE_LABEL : EXPAND_LABEL}
          </Button>
        ) : null}
      </div>
      {/* Luôn có trong DOM (vùng sống phải có sẵn trước câu); rỗng thì bù khoảng gap để không chiếm chỗ. */}
      <p aria-live="polite" className="text-[12px] text-text-secondary empty:-mt-2" role="status">
        {props.message}
      </p>
      {state === 'loading' ? (
        <div className="flex flex-col gap-2">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} preset="table-row" />
          ))}
        </div>
      ) : null}
      {open ? (
        // Trần ~45vh để bảng tầng bên dưới vẫn trong màn khi nhận; tiêu điểm vào dòng khuất thì trình duyệt tự cuộn.
        <div aria-label={SCROLL_LABEL} className="max-h-[45vh] overflow-auto" role="region" tabIndex={0}>
          <p className="pb-1 text-[12px] text-text-secondary">{NOT_VERIFIED_NOTE}</p>
          <p className="pb-1 text-[12px] text-text-secondary">{SECTION_HINT}</p>
          <table className="w-full table-fixed border-collapse text-left text-[14px]" ref={tableRef}>
            <caption className="sr-only">{CAPTION}</caption>
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[39%]" />
              <col className="w-[39%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-bg-sunken">
              <tr>
                {HEADERS.map((header) => (
                  <th className="px-3 py-1 text-[12px] font-semibold text-text-secondary" key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            {rows.map((row) => (
              <FloorProposalRow
                accepted={accepted}
                busy={busy}
                canAccept={state !== 'forbidden'}
                key={row.floorId}
                onAccept={onAccept}
                onToggleSection={onToggleSection}
                row={row}
              />
            ))}
          </table>
        </div>
      ) : null}
    </section>
  );
}
