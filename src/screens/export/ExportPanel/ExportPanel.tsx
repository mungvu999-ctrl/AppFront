/**
 * Màn Xuất (S-34) — bốn định dạng trong hợp đồng (.glb, PDF, ảnh, Spatial JSON),
 * bố cục hai cột.
 *
 * View thuần (mục D): mọi giá trị đến từ {@link ExportPanelProps}, không
 * store, không mạng, không domain — `local/no-data-layer-in-view` (R-60)
 * không có gì để bắt ở đây.
 *
 * ## Ba câu (HOP-DONG-V6 §1)
 *
 * `PageHead`: eyebrow "Bước 6 · Xuất", H1 "Xuất mô hình", dòng trạng thái = chip
 * (sẵn sàng / nên xem / đang xuất / lỗi) + câu có số thật (định dạng, số tầng, số
 * tệp đã xuất). Bước cuối không có bước sau nên không có `FlowGate`: việc chính là
 * MỘT nút "Xuất <định dạng>" ở chân trang — chỗ cố định cho cả lúc đang xuất (thanh
 * tiến độ thật + Huỷ) và lúc lỗi (Thử lại ở cạnh thẻ, "Về dự án" ở chân).
 *
 * ## Công năng vắng mặt
 *
 * `canEstimateSize`, `canChooseUnit`, `canNameFloorStep`, `canPutDownloadInToast`
 * không có mặt bằng logic nào tương ứng nên không có điều khiển nào giả vờ cần
 * chúng. `canPersistHistory` `false`: danh sách tệp vẫn hiện, kèm câu nói rõ nó
 * chỉ sống trong phiên. `canRenderPdfBytes` và `canCaptureImage` `false`: PDF và
 * ảnh KHÔNG vẽ thành thẻ chọn (nút giả) — chúng hiện thành dòng chữ "chưa xuất
 * được" dưới danh sách, PDF kèm số trang thật (`ExportPanelFormats`).
 * `canIncludeAxisGrid` `false` thì công tắc "gồm lưới trục" rời khỏi DOM.
 *
 * ## Bảy trạng thái (A11)
 *
 * `empty` và `forbidden` thay nội dung bằng một `EmptyState` dưới đầu trang. Năm
 * trạng thái còn lại vẽ đủ hai cột: `error` giữ nguyên mọi thẻ phía dưới banner
 * lỗi, đúng ý "`onRetry` giữ nguyên mọi thiết lập". `progress !== null` là cờ độc
 * lập với `status`: chân trang đổi sang thanh tiến độ bất kể `status`.
 *
 * "Chia sẻ" chỉ phát `onShare()`; container quyết định mở hộp thoại nào (R-73).
 */

import { ChevronRight, FolderOpen, Lock, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { PageHead } from '@/components/shell/PageHead';
import { Section } from '@/components/shell/Section';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { formatNumber } from '@/lib/format/number';
import { cn } from '@/lib/utils';

import { ExportPanelFooter } from './ExportPanelFooter';
import { ExportPanelFormats, SkeletonText } from './ExportPanelFormats';
import { ExportPanelOptions } from './ExportPanelOptions';
import { ExportPanelPreflight } from './ExportPanelPreflight';
import { ServerGlbExportSection } from './ServerGlbExportSection';
import type {
  ExportCapabilities,
  ExportedFileRow,
  ExportFloorChoice,
  ExportFormatId,
  ExportPanelProps,
} from './types';

/** Lý do nút Xuất mờ khi chọn `.glb` mà bỏ hết tầng (RV2#7, BUG-466). */
const NO_FLOOR_CAPTION = 'Chọn ít nhất một tầng để xuất mô hình 3D.';

/** Tên ngắn của định dạng trên nút chính: "Xuất .glb", "Xuất .json"… */
const EXPORT_BUTTON_LABEL: Readonly<Record<ExportFormatId, string>> = {
  glb: 'Xuất .glb',
  pdf: 'Xuất PDF',
  image: 'Xuất ảnh',
  'spatial-json': 'Xuất .json',
};

const count = (value: number): string => formatNumber(value, { fractionDigits: 0 });

/**
 * Định dạng này có sinh ra được một tệp thật không.
 *
 * Spatial JSON luôn có, `.glb` khi có ít nhất một tầng được chọn; PDF và ảnh phụ thuộc hai cờ mà tầng logic
 * hôm nay trả `false`. Suy ra từ props, không phải một trường mới của hợp đồng.
 */
function canDeliverFormat(id: ExportFormatId, capabilities: ExportCapabilities, floors: readonly ExportFloorChoice[]): boolean {
  // `.glb` dựng hình theo TẦNG: chưa chọn tầng nào thì không có tệp nào để dựng (BUG-466).
  if (id === 'glb') return floors.some((floor) => floor.isSelected);
  if (id === 'pdf') return capabilities.canRenderPdfBytes;
  if (id === 'image') return capabilities.canCaptureImage;
  return true;
}

/** U51: bảng giữ thông tin tệp qua lượt tải lại trang, nhưng nội dung tệp chỉ còn trong phiên đã xuất. */
const HISTORY_CAPTION = 'Lưu 20 tệp gần nhất trên trình duyệt này. Tệp từ lần mở trước cần xuất lại để tải về.';
const RESTORED_ROW_NOTE = 'Tệp cũ, xuất lại để tải về';

interface ExportPanelHistoryProps {
  readonly files: readonly ExportedFileRow[];
  readonly isLoading: boolean;
  readonly canPersistHistory: boolean;
  readonly onDownload: (fileId: string) => void;
  readonly onPrint?: ((fileId: string) => void) | undefined;
}

/** Danh sách tệp đã xuất trong phiên làm việc — kèm thời điểm và dung lượng bằng chữ đều. */
function ExportPanelHistory({ files, isLoading, canPersistHistory, onDownload, onPrint }: ExportPanelHistoryProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <Section
      flush
      aria-label="Tệp đã xuất"
      title="Tệp đã xuất"
      {...(canPersistHistory
        ? {}
        : { actions: <span className="text-[13px] text-text-secondary">{HISTORY_CAPTION}</span> })}
    >
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Tệp</Table.Head>
            {/* Dưới `sm` bỏ cột thời điểm để "Tải về lại" còn trong khung. */}
            <Table.Head className="hidden sm:table-cell">Thời điểm</Table.Head>
            <Table.Head>Dung lượng</Table.Head>
            <Table.Head>
              <span className="sr-only">Tải về lại</span>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {files.map((file) => (
            <Table.Row key={file.id}>
              <Table.Cell className="w-full max-w-0 truncate font-mono text-xs" title={file.fileName}>
                {file.fileName}
              </Table.Cell>
              <Table.Cell className="hidden text-xs text-text-secondary sm:table-cell">
                {isLoading ? <SkeletonText className="h-3 w-16" /> : file.momentLabel}
              </Table.Cell>
              <Table.Cell className="font-mono text-xs tabular-nums text-text-secondary">
                {isLoading ? <SkeletonText className="h-3 w-12" /> : file.sizeLabel}
              </Table.Cell>
              <Table.Cell>
                {file.isRestored === true ? (
                  <span className="block text-xs text-text-secondary">{RESTORED_ROW_NOTE}</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Tải về lại ${file.fileName}`}
                    onClick={() => {
                      onDownload(file.id);
                    }}
                  >
                    Tải về lại
                  </Button>
                )}
                {file.isRestored !== true && file.formatId === 'pdf' && onPrint !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`In ${file.fileName}`}
                    onClick={() => {
                      onPrint(file.id);
                    }}
                  >
                    In
                  </Button>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Section>
  );
}

interface StatusProps {
  readonly props: ExportPanelProps;
}

/** Câu 2: chip + một câu có số thật (định dạng, tầng, tệp đã xuất). */
function ExportPanelStatus({ props }: StatusProps) {
  const { status, progress, exportedFiles, preflight } = props;

  // Tầng chưa duyệt xong: nói việc cần làm trước, đừng mở đầu bằng "Xuất được" (U36).
  const approvalPending = preflight.some((row) => row.id === 'approval' && row.fixHref !== null);
  // UX-52: chỉ đếm dòng còn việc (chấm vàng); dòng "Không còn vi phạm nào." không phải một việc.
  const todo = preflight.filter((row) => row.tone === 'attention').length;
  // Không chip xanh: A5 giữ màu "đã xác minh" cho việc của người duyệt, không cho lượt xuất.
  const badge =
    progress !== null ? (
      <Badge variant="neutral">Đang xuất</Badge>
    ) : status === 'error' ? (
      <Badge variant="violation">Xuất chưa thành công</Badge>
    ) : (
      // Còn việc nên xem thì nói thẳng "xuất được, còn N việc" — "Sẵn sàng" cạnh ba cảnh báo làm người mới hoang mang.
      <Badge variant={todo > 0 ? 'attention' : 'neutral'}>
        {todo === 0
          ? 'Sẵn sàng xuất'
          : approvalPending
            ? `Chưa duyệt xong · nên làm ${count(todo)} việc dưới đây trước khi xuất`
            : `Xuất được · còn ${count(todo)} việc nên xem`}
      </Badge>
    );

  const sessionFileCount = exportedFiles.filter((file) => file.isRestored !== true).length;
  const parts = [
    sessionFileCount > 0 ? `đã xuất ${count(sessionFileCount)} tệp trong phiên này` : null,
  ].filter((part): part is string => part !== null);

  return (
    <>
      {badge}
      {parts.length > 0 && <span className="tabular-nums">{`${parts.join(', ')}.`}</span>}
    </>
  );
}

/** Màn Xuất như một hàm của props — test và story dựng thẳng cái này. */
export function ExportPanel(props: ExportPanelProps) {
  const {
    status,
    capabilities,
    formats,
    floors,
    options,
    preflight,
    exportedFiles,
    progress,
    error,
    destinationCaption,
    noticeCaption,
    onBackToProject,
    onOpenData,
    permissionCaption,
    isCollapsed,
    onSelectFormat,
    onToggleFloor,
    onChangeOptions,
    onToggleOptionsExpanded,
    onExport,
    onCancel,
    onRetry,
    onDownload,
    onPrint,
    onFollowFix,
    onShare,
  } = props;

  const isLoading = status === 'loading';

  // Xuất xong thì đọc to tên tệp mới (30-E-012); lần mount đầu không đọc lịch sử cũ.
  const [announcement, setAnnouncement] = useState('');
  const lastFileId = useRef(exportedFiles[0]?.id);
  useEffect(() => {
    const newest = exportedFiles[0];

    if (newest !== undefined && newest.id !== lastFileId.current) {
      setAnnouncement(`Đã xuất ${newest.fileName}`);
    }

    lastFileId.current = newest?.id;
  }, [exportedFiles]);
  const selectedFormat = formats.find((format) => format.isSelected) ?? formats[0] ?? null;
  // M1-01: đường máy chủ xuất cả dự án (N49) — không chọn tầng, không tuỳ chọn của đường nhanh.
  const onServer = selectedFormat?.id === 'glb' && props.serverGlb?.engine === 'server';
  const canExportSelected =
    selectedFormat !== null && (onServer || canDeliverFormat(selectedFormat.id, capabilities, floors));

  const head = (withStatus: boolean) => (
    <PageHead
      className="mb-0"
      eyebrow="Bước 6 · Xuất"
      title="Xuất mô hình"
      status={
        withStatus ? (
          <ExportPanelStatus props={props} />
        ) : (
          <Badge variant="neutral">{status === 'forbidden' ? 'Chỉ được xem' : 'Chưa có mô hình để xuất'}</Badge>
        )
      }
      {...(withStatus && onShare !== null
        ? {
            next: (
              <Button variant="secondary" iconBefore={<Share2 aria-hidden="true" size={16} />} onClick={onShare}>
                Chia sẻ
              </Button>
            ),
          }
        : {})}
    />
  );

  if (status === 'forbidden' || status === 'empty') {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-bg-app">
        <div className="mx-auto flex w-full max-w-[1344px] flex-col gap-6 px-4 pb-6 pt-6 xl:px-8">
          {head(false)}
          {status === 'forbidden' ? (
            <EmptyState
              icon={<Lock aria-hidden="true" />}
              title="Không có quyền xuất bản vẽ"
              description={permissionCaption ?? 'Chỉ một số vai trò trong dự án được xuất bản vẽ.'}
              {...(onBackToProject !== undefined
                ? { action: { label: 'Về dự án', onClick: onBackToProject, variant: 'secondary' as const } }
                : {})}
            />
          ) : (
            <EmptyState
              icon={<FolderOpen aria-hidden="true" />}
              title="Chưa có gì để xuất"
              description="Dự án chưa có bản vẽ nào được xử lý xong. Tải bản vẽ lên, chờ xử lý xong rồi quay lại đây để xuất."
              {...(onBackToProject !== undefined
                ? { action: { label: 'Về dự án', onClick: onBackToProject, variant: 'secondary' as const } }
                : {})}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg-app">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="mx-auto flex w-full max-w-[1344px] flex-1 flex-col gap-6 px-4 pb-6 pt-6 xl:px-8">
        {head(true)}

        {/* Lỗi đặt ngay trên các thẻ (thiết lập giữ nguyên bên dưới): nguyên nhân + gợi ý + Thử lại,
            mã lỗi trong "Chi tiết kỹ thuật"; nút "Về dự án" ở chân trang là lối ra thứ hai. */}
        {status === 'error' && error !== null && (
          <div className="flex flex-col gap-2">
            <InlineAlert level="violation" message={error.message} action={{ label: 'Thử lại', onClick: onRetry }} />
            <p className="pl-3 text-[13px] text-text-secondary">{error.hint}</p>
            <details className="group pl-3 text-[13px] text-text-secondary">
              <summary className="flex cursor-pointer list-none items-center gap-1">
                <ChevronRight
                  aria-hidden="true"
                  size={14}
                  className="transition-transform duration-fast group-open:rotate-90"
                />
                Chi tiết kỹ thuật
              </summary>
              <p className="mt-1 pl-5">
                Mã lỗi: <span className="font-mono text-text-primary">{error.code}</span>
              </p>
            </details>
          </div>
        )}

        {/* Lưới hai cột từ `lg`: trái = định dạng rồi khối kiểm tra (để cột trái không bỏ trống dưới hai thẻ),
            phải 344 px = phạm vi và tuỳ chọn. Hẹp hơn thì một cột, khối kiểm tra lên đầu (impeccable A4 export-768). */}
        <div className={cn('grid grid-cols-1 gap-6', !isCollapsed && 'lg:grid-cols-[minmax(0,1fr)_344px] lg:items-start')}>
          <Section title="Chọn định dạng" className={cn('min-w-0', !isCollapsed && 'lg:col-start-1 lg:row-start-1')}>
            <ExportPanelFormats
              formats={formats}
              capabilities={capabilities}
              isLoading={isLoading}
              onSelectFormat={onSelectFormat}
              {...(onOpenData !== undefined ? { onOpenData } : {})}
            />
            {selectedFormat?.id === 'glb' && props.serverGlb != null && <ServerGlbExportSection view={props.serverGlb} />}
          </Section>

          {selectedFormat !== null && !onServer && (
            <div className={cn('min-w-0', !isCollapsed && 'lg:col-start-2 lg:row-span-2 lg:row-start-1')}>
              <ExportPanelOptions
                floors={floors}
                options={options}
                capabilities={capabilities}
                selectedFormatId={selectedFormat.id}
                onToggleFloor={onToggleFloor}
                onChangeOptions={onChangeOptions}
                onToggleOptionsExpanded={onToggleOptionsExpanded}
              />
            </div>
          )}

          <div className={cn('order-first min-w-0', !isCollapsed && 'lg:order-none lg:col-start-1 lg:row-start-2')}>
            <ExportPanelPreflight rows={preflight} onFollowFix={onFollowFix} />
          </div>
        </div>

        <ExportPanelHistory
          files={exportedFiles}
          isLoading={isLoading}
          canPersistHistory={capabilities.canPersistHistory}
          onDownload={onDownload}
          onPrint={onPrint}
        />
      </div>

      {props.unreviewedConfirm != null && (
        <div
          role="alertdialog"
          aria-label="Xác nhận xuất"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg-surface px-4 py-3 text-sm"
        >
          <span className="min-w-0 flex-1">{props.unreviewedConfirm}</span>
          <Button variant="secondary" size="sm" onClick={props.onReviewFirst}>
            Duyệt trước
          </Button>
          <Button size="sm" onClick={props.onConfirmExport}>
            Vẫn xuất
          </Button>
        </div>
      )}

      <ExportPanelFooter
        progress={progress}
        canExportSelected={canExportSelected}
        exportLabel={selectedFormat === null ? 'Xuất' : EXPORT_BUTTON_LABEL[selectedFormat.id]}
        blockedReason={noticeCaption ?? (selectedFormat?.id === 'glb' && !onServer ? NO_FLOOR_CAPTION : null)}
        destinationCaption={destinationCaption}
        pendingNote={props.pendingNote ?? null}
        isLoading={isLoading}
        onExport={onExport}
        onCancel={onCancel}
        {...(onBackToProject !== undefined ? { onBackToProject } : {})}
      />
    </div>
  );
}
