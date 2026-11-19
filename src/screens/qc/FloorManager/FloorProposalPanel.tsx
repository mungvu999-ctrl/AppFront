/**
 * Thanh + bảng "Đề xuất của máy cho cả nhà" (Mức 3, lát cắt 1, việc F3/F5) — VIEW THUẦN.
 *
 * Nhận dòng và câu tóm tắt đã viết sẵn từ `@/lib/viewmodel/houseProposal`; không lấy dữ liệu, không
 * đụng kho. Việc ẩn cả bảng (công tắc tắt, hoặc không có gì khác giá trị hiện tại và không câu hỏi) là
 * của container: view này chỉ vẽ khi được gọi.
 *
 * ## Gọn
 *
 * Mặc định là MỘT thanh: câu tóm tắt, nút "Xem đề xuất" và nút nhận hàng loạt. Bảng mở tại chỗ khi
 * `expanded`; trạng thái mở do hook giữ suốt phiên.
 *
 * ## Bảy trạng thái (A11) của bảng
 *
 * | `state`     | Vẽ gì                                                                          |
 * |-------------|--------------------------------------------------------------------------------|
 * | `empty`     | một dòng "Máy chưa có đề xuất nào" (container không bao giờ vẽ trạng thái này)  |
 * | `loading`   | thanh đầu "đang đọc" + khung xương                                              |
 * | `partial`   | thanh (+ bảng khi mở); tầng máy không đề xuất có một dòng nói rõ                |
 * | `error`     | `InlineAlert` + nút "Thử lại"                                                   |
 * | `success`   | thanh (+ bảng khi mở)                                                           |
 * | `forbidden` | như `success`, chỉ đọc: không có nút "Nhận" nào, không có nút nhận hàng loạt    |
 * | `collapsed` | luôn chỉ thanh, bất kể `expanded` (cho story và bài kiểm A11)                   |
 *
 * Luật A5: mọi giá trị máy đưa ra được nói MỘT lần ở chú thích bảng là đề xuất chưa có người duyệt,
 * kèm chip độ chắc bằng lời; không chỗ nào dùng xanh "đã xác minh". Thứ tự dòng là thứ tự tầng của
 * dự án, giống bảng tầng bên dưới.
 */

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { formatNumber } from '@/lib/format/number';
import type { HouseProposalRowVm, HouseProposalSummary } from '@/lib/viewmodel/houseProposal';

import { FloorProposalRow, type FloorProposalField } from './FloorProposalRow';

export type { FloorProposalField };

export type FloorProposalState = 'empty' | 'loading' | 'partial' | 'error' | 'success' | 'forbidden' | 'collapsed';

export interface FloorProposalPanelProps {
  readonly state: FloorProposalState;
  readonly rows: readonly HouseProposalRowVm[];
  readonly summary: HouseProposalSummary;
  readonly errorMessage?: string | undefined;
  /** Bảng đang mở (trạng thái do hook giữ suốt phiên). */
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Nhận một ô của một tầng: ghi `valueMm` vào cao độ hoặc chiều cao. */
  readonly onAccept: (floorId: string, field: FloorProposalField, valueMm: number) => void;
  /** Chỉ các ô `oneClick`; view không tự lọc, hook làm việc đó. */
  readonly onAcceptAll: () => void;
  readonly onRetry: () => void;
}

const TITLE = 'Đề xuất của máy cho cả nhà';
const NOT_VERIFIED_NOTE = 'Đây là đề xuất của máy, chưa có người duyệt. Nguồn của từng giá trị ghi cuối ô.';
const LOADING_HEADLINE = 'Máy đang đọc các bản vẽ…';
const ACCEPT_ALL_HELP = 'Chỉ nhận các giá trị máy không còn câu hỏi; phần còn lại cần bạn xem.';
const EXPAND_LABEL = 'Xem đề xuất';
const COLLAPSE_LABEL = 'Ẩn đề xuất';
const RETRY_LABEL = 'Thử lại';
const DEFAULT_ERROR = 'Không đọc được đề xuất của máy. Thử lại sau ít phút.';
const EMPTY_TITLE = 'Máy chưa có đề xuất nào.';
const EMPTY_DESCRIPTION = 'Bạn vẫn nhập tay được ở bảng tầng.';
const CAPTION = 'Đề xuất của máy theo từng tầng, cùng thứ tự với bảng tầng bên dưới.';
const HEADERS = ['Tầng', 'Cao độ (m): hiện tại, đề xuất', 'Chiều cao (mm): hiện tại, đề xuất'] as const;
const SKELETON_KEYS = ['a', 'b'] as const;

const acceptAllLabel = (count: number): string =>
  `Nhận ${formatNumber(count, { fractionDigits: 0 })} đề xuất không còn câu hỏi`;

interface HeaderBarProps {
  readonly headline: string;
  readonly acceptCount: number;
  readonly showAcceptAll: boolean;
  readonly onAcceptAll: () => void;
  readonly toggle: { readonly expanded: boolean; readonly onToggle: () => void } | null;
}

function HeaderBar({ headline, acceptCount, showAcceptAll, onAcceptAll, toggle }: HeaderBarProps) {
  const acceptable = showAcceptAll && acceptCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <h2 className="font-semibold text-text-primary">{TITLE}</h2>
          <p className="text-text-secondary">{headline}</p>
        </div>
        {acceptable ? <p className="text-[12px] text-text-secondary">{ACCEPT_ALL_HELP}</p> : null}
      </div>
      {toggle === null ? null : (
        <Button aria-expanded={toggle.expanded} onClick={toggle.onToggle} size="sm" variant="ghost">
          {toggle.expanded ? COLLAPSE_LABEL : EXPAND_LABEL}
        </Button>
      )}
      {acceptable ? (
        <Button onClick={onAcceptAll} size="sm" variant="secondary">
          {acceptAllLabel(acceptCount)}
        </Button>
      ) : null}
    </div>
  );
}

export function FloorProposalPanel(props: FloorProposalPanelProps) {
  const { state, rows, summary, onAccept, onAcceptAll, onRetry } = props;
  const hasTable = state === 'partial' || state === 'success' || state === 'forbidden';
  const open = hasTable && props.expanded;

  if (state === 'empty') {
    return (
      <section aria-label={TITLE} className="rounded-lg border border-border-default px-4 py-2 text-[14px] text-text-secondary">
        <span className="font-semibold text-text-primary">{EMPTY_TITLE}</span> {EMPTY_DESCRIPTION}
      </section>
    );
  }

  return (
    <section aria-busy={state === 'loading'} aria-label={TITLE} className="flex flex-col gap-2 rounded-lg border border-border-default px-4 py-2">
      <HeaderBar
        acceptCount={summary.oneClickCount}
        headline={state === 'loading' ? LOADING_HEADLINE : summary.headline}
        onAcceptAll={onAcceptAll}
        showAcceptAll={state === 'partial' || state === 'success' || state === 'collapsed'}
        toggle={hasTable || state === 'collapsed' ? { expanded: open, onToggle: props.onToggleExpanded } : null}
      />
      {state === 'loading' ? (
        <div className="flex flex-col gap-2">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} preset="table-row" />
          ))}
        </div>
      ) : null}
      {state === 'error' ? (
        <InlineAlert action={{ label: RETRY_LABEL, onClick: onRetry }} level="violation" message={props.errorMessage ?? DEFAULT_ERROR} />
      ) : null}
      {open ? (
        <div className="overflow-x-auto">
          <p className="pb-1 text-[12px] text-text-secondary">{NOT_VERIFIED_NOTE}</p>
          <table className="w-full table-fixed border-collapse text-left text-[14px]">
            <caption className="sr-only">{CAPTION}</caption>
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[37%]" />
              <col className="w-[37%]" />
            </colgroup>
            <thead className="bg-bg-sunken">
              <tr>
                {HEADERS.map((header) => (
                  <th className="px-3 py-1 text-[12px] font-semibold text-text-secondary" key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            {rows.map((row) => (
              <FloorProposalRow canAccept={state !== 'forbidden'} key={row.floorId} onAccept={onAccept} row={row} />
            ))}
          </table>
        </div>
      ) : null}
    </section>
  );
}
