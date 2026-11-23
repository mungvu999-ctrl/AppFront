/**
 * Bước chọn tệp của "Tải cả bộ hồ sơ" — VIEW THUẦN. Không cần tạo tầng trước.
 *
 * Giới hạn nói TRƯỚC khi chọn (một dòng), và khi vượt thì nói con số đang có cùng cách gỡ, tắt nút tải:
 * không byte nào được gửi khi bộ còn vượt trần. Tệp không nhận được nằm lại trong danh sách với lý do.
 */

import { useRef } from 'react';

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Button } from '@/components/ui/Button';
import { formatFileSize } from '@/lib/format/bytes';
import { formatNumber } from '@/lib/format/number';

import { LIMITS_LINE } from './drawingSetText';
import type { UseDrawingSetPickResult } from './useDrawingSetPick';

/** Mã cho test bắn `change` vào ô chọn tệp ẩn. */
export const DRAWING_SET_FILE_INPUT_TEST_ID = 'drawing-set-file-input';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

const TEXT = {
  choose: 'Chọn tệp',
  chooseMore: 'Thêm tệp',
  start: 'Tải lên',
  cancel: 'Huỷ tải',
  remove: 'Bỏ',
  measuring: 'Đang đọc tệp…',
  uploadingTitle: 'Đang tải bộ hồ sơ lên',
  readingFiles: 'Chọn một PDF nhiều trang hoặc nhiều ảnh cùng lúc.',
  errorTitle: 'Chưa tải được bộ hồ sơ',
  batchTitle: 'Bộ hồ sơ vượt giới hạn',
  recentTitle: 'Bộ hồ sơ đang dở',
  open: 'Tiếp tục',
} as const;

export interface RecentSetVm {
  readonly id: string;
  readonly label: string;
}

export interface DrawingSetPickViewProps {
  readonly pick: UseDrawingSetPickResult;
  readonly recentSets: readonly RecentSetVm[];
  readonly onOpenSet: (setId: string) => void;
}

const pagesText = (pages: number): string => `${formatNumber(pages, { fractionDigits: 0 })} trang`;

export function DrawingSetPickView({ onOpenSet, pick, recentSets }: DrawingSetPickViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { entries, uploading } = pick;

  if (uploading !== null) {
    return (
      <section aria-label={TEXT.uploadingTitle} className="flex flex-col gap-3" role="region">
        <h2 className="text-[16px] font-semibold text-text-primary">{TEXT.uploadingTitle}</h2>
        <progress aria-label={TEXT.uploadingTitle} className="h-2 w-full" max={100} value={uploading.percent} />
        <p aria-live="polite" className="text-[14px] text-text-secondary" role="status">
          {uploading.fileName === null ? `${String(uploading.percent)}%` : `${uploading.fileName} · ${String(uploading.percent)}%`}
        </p>
        <div>
          <Button onClick={pick.cancel} variant="ghost">
            {TEXT.cancel}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Chọn tệp của bộ hồ sơ" className="flex flex-col gap-4">
      <p className="text-[14px] text-text-secondary">{TEXT.readingFiles}</p>
      <p className="text-[13px] text-text-secondary">{LIMITS_LINE}</p>
      <input
        accept={ACCEPT}
        className="sr-only"
        data-testid={DRAWING_SET_FILE_INPUT_TEST_ID}
        multiple
        onChange={(event) => {
          pick.addFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            inputRef.current?.click();
          }}
          variant={entries.length === 0 ? 'primary' : 'secondary'}
        >
          {entries.length === 0 ? TEXT.choose : TEXT.chooseMore}
        </Button>
        {entries.length === 0 ? null : (
          <Button disabled={!pick.canStart} onClick={pick.start} variant="primary">
            {TEXT.start}
          </Button>
        )}
      </div>

      {pick.failure === null ? null : <InlineAlert level="violation" message={pick.failure.sentence} role="alert" title={TEXT.errorTitle} />}
      {pick.batchSentences.length === 0 ? null : (
        <InlineAlert level="attention" message={pick.batchSentences.join(' ')} role="status" title={TEXT.batchTitle} />
      )}

      {entries.length === 0 ? null : (
        <>
          <p className="text-[13px] text-text-secondary">
            {`${formatNumber(pick.totals.files, { fractionDigits: 0 })} tệp, ${pagesText(pick.totals.pages)}, ${formatFileSize(pick.totals.bytes)}`}
          </p>
          <ul aria-label="Các tệp đã chọn" className="flex flex-col divide-y divide-border-default rounded-lg border border-border-default">
            {entries.map((entry) => (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[14px]" key={entry.id}>
                <span className="min-w-0 flex-1 truncate text-text-primary">{entry.name}</span>
                <span className="text-text-secondary">
                  {entry.isMeasuring
                    ? TEXT.measuring
                    : entry.pageCount === null
                      ? formatFileSize(entry.size)
                      : `${formatFileSize(entry.size)} · ${pagesText(entry.pageCount)}`}
                </span>
                <Button
                  aria-label={`${TEXT.remove} ${entry.name}`}
                  onClick={() => {
                    pick.removeEntry(entry.id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {TEXT.remove}
                </Button>
                {entry.rejection === null ? null : (
                  <p className="basis-full text-[13px] text-state-violation-text" role="status">
                    {entry.rejection}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {recentSets.length === 0 ? null : (
        <section aria-label={TEXT.recentTitle} className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold text-text-primary">{TEXT.recentTitle}</h2>
          <ul className="flex flex-col gap-1">
            {recentSets.map((item) => (
              <li className="flex items-center gap-3 text-[14px]" key={item.id}>
                <span className="text-text-secondary">{item.label}</span>
                <Button
                  onClick={() => {
                    onOpenSet(item.id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {TEXT.open}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
