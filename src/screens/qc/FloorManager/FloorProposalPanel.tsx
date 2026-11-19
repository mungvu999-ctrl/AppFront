/**
 * Bảng "Đề xuất của máy cho cả nhà" (Mức 3, lát cắt 1, việc F3) — VIEW THUẦN.
 *
 * Nhận dòng và câu tóm tắt đã viết sẵn từ `@/lib/viewmodel/houseProposal`; không lấy dữ liệu, không
 * đụng kho. Việc ẩn cả bảng khi công tắc tắt là của container: view này không có trạng thái "off".
 *
 * ## Bảy trạng thái (A11) của bảng
 *
 * | `state`     | Vẽ gì                                                                      |
 * |-------------|----------------------------------------------------------------------------|
 * | `empty`     | thanh đầu + `EmptyState`: máy chưa có đề xuất nào                           |
 * | `loading`   | thanh đầu "đang đọc" + khung xương                                          |
 * | `partial`   | bảng đủ; tầng máy không đề xuất có một dòng nói rõ                          |
 * | `error`     | `InlineAlert` + nút "Thử lại"                                               |
 * | `success`   | bảng đủ                                                                     |
 * | `forbidden` | bảng chỉ đọc: không có nút "Nhận" nào, không có "Nhận N đề xuất"            |
 * | `collapsed` | chỉ thanh đầu, kèm nút "Mở bảng đề xuất" khi có `onExpand`                  |
 *
 * Luật A5: mọi giá trị máy đưa ra mang chữ "máy đề xuất" và chip độ chắc bằng lời; không chỗ nào dùng
 * xanh "đã xác minh". Thứ tự dòng giữ nguyên như viewmodel trả (độ chắc thấp nhất lên đầu).
 */

import { Lightbulb } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
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
  /** Nhận một ô của một tầng: ghi `valueMm` vào cao độ hoặc chiều cao. */
  readonly onAccept: (floorId: string, field: FloorProposalField, valueMm: number) => void;
  /** Chỉ các tầng `oneClick`; view không tự lọc, container làm việc đó. */
  readonly onAcceptAll: () => void;
  readonly onRetry: () => void;
  readonly onExpand?: (() => void) | undefined;
}

const TITLE = 'Đề xuất của máy cho cả nhà';
const NOT_VERIFIED_NOTE = 'Đây là đề xuất của máy, chưa có người duyệt.';
const LOADING_HEADLINE = 'Máy đang đọc các bản vẽ…';
const ACCEPT_ALL_HELP = 'Chỉ nhận các tầng máy chắc chắn và không còn câu hỏi.';
const EXPAND_LABEL = 'Mở bảng đề xuất';
const RETRY_LABEL = 'Thử lại';
const DEFAULT_ERROR = 'Không đọc được đề xuất của máy. Thử lại sau ít phút.';
const EMPTY_TITLE = 'Máy chưa có đề xuất nào';
const EMPTY_DESCRIPTION = 'Máy chưa đọc được cao độ hay chiều cao từ các bản vẽ. Bạn vẫn nhập tay được ở bảng tầng.';
const CAPTION = 'Đề xuất của máy theo từng tầng. Tầng máy kém chắc nhất xếp trước.';
const HEADERS = ['Tầng', 'Tên tầng máy đọc', 'Cao độ (m)', 'Chiều cao (mm)'] as const;
const SKELETON_KEYS = ['a', 'b', 'c', 'd'] as const;

const acceptAllLabel = (count: number): string =>
  count === 0 ? 'Nhận đề xuất chắc chắn' : `Nhận ${formatNumber(count, { fractionDigits: 0 })} đề xuất chắc chắn`;

interface HeaderBarProps {
  readonly headline: string;
  readonly acceptCount: number;
  readonly showAcceptAll: boolean;
  readonly onAcceptAll: () => void;
  readonly onExpand: (() => void) | undefined;
}

function HeaderBar({ headline, acceptCount, showAcceptAll, onAcceptAll, onExpand }: HeaderBarProps) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="text-[16px] font-semibold text-text-primary">{TITLE}</h2>
        <p className="text-[14px] text-text-primary">{headline}</p>
        <p className="text-[12px] text-text-muted">{NOT_VERIFIED_NOTE}</p>
      </div>
      {onExpand === undefined ? null : (
        <Button onClick={onExpand} size="sm" variant="ghost">
          {EXPAND_LABEL}
        </Button>
      )}
      {showAcceptAll ? (
        <div className="flex flex-col items-end gap-1">
          <Button disabled={acceptCount === 0} onClick={onAcceptAll} size="sm" variant="secondary">
            {acceptAllLabel(acceptCount)}
          </Button>
          <p className="max-w-60 text-right text-[12px] text-text-muted">{ACCEPT_ALL_HELP}</p>
        </div>
      ) : null}
    </div>
  );
}

export function FloorProposalPanel(props: FloorProposalPanelProps) {
  const { state, rows, summary, onAccept, onAcceptAll, onRetry } = props;
  const showsTable = state === 'partial' || state === 'success' || state === 'forbidden';

  return (
    <section aria-busy={state === 'loading'} aria-label={TITLE} className="flex flex-col gap-3 rounded-lg border border-border-default p-4">
      <HeaderBar
        acceptCount={summary.oneClickCount}
        headline={state === 'loading' ? LOADING_HEADLINE : summary.headline}
        onAcceptAll={onAcceptAll}
        onExpand={state === 'collapsed' ? props.onExpand : undefined}
        showAcceptAll={state === 'partial' || state === 'success'}
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
      {state === 'empty' ? <EmptyState description={EMPTY_DESCRIPTION} icon={<Lightbulb />} title={EMPTY_TITLE} /> : null}
      {showsTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[14px]">
            <caption className="sr-only">{CAPTION}</caption>
            <thead className="bg-bg-sunken">
              <tr>
                {HEADERS.map((header) => (
                  <th className="px-3 py-2 text-[13px] font-semibold text-text-secondary" key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FloorProposalRow canAccept={state !== 'forbidden'} key={row.floorId} onAccept={onAccept} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
