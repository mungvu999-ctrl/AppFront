/**
 * S-38 — vỏ màn thư viện mẫu 3D dùng chung. View thuần (R-60, mục D): mọi dữ liệu qua
 * `ModelLibraryProps`, không chạm store/mạng, không nhập `three`.
 *
 * Ba câu của màn (NGUYEN-TAC-BO-CUC §1): `PageHead` nói làm gì (H1 động từ), trạng thái
 * (Badge số mẫu nặng + câu có số mẫu và tổng dung lượng — thay dải ba ô số cũ, vì ô số
 * chỉ dùng khi bấm được để lọc), và KHÔNG có nút chính: bản này chưa có đường tải `.glb`
 * lên (`capabilities.canUploadModel === false`, xem `types.ts`), nên `next` trống thay vì
 * một nút chết. Danh sách nằm trong MỘT `Section`, tìm/lọc ở đầu khung.
 *
 * Bảy trạng thái A11 rẽ nhánh ở đây. "không có quyền" ở màn này nghĩa là CHỈ XEM, không
 * phải chặn xem: bảng vẫn vẽ đủ, chỉ thêm một `InlineAlert` nói lý do. Sự khác biệt giữa
 * "một phần", "thành công" và "không có quyền" nằm trong dữ liệu (`model.rows`,
 * `model.readOnlyReason`), không phải trong nhánh JSX.
 */
import type { ReactNode } from 'react';

import { Boxes } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { PageHead } from '@/components/shell/PageHead';
import { Section } from '@/components/shell/Section';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';

import { Pager } from '../Pager';
import { usePaged } from '../usePaged';
import { ModelLibraryDetail } from './ModelLibraryDetail';
import { ModelLibraryTable } from './ModelLibraryTable';
import { ModelLibraryToolbar } from './ModelLibraryToolbar';
import type { ModelLibraryModel, ModelLibraryProps } from './types';

const PAGE_EYEBROW = 'Quản trị';
const PAGE_TITLE = 'Xem thư viện mẫu 3D';
const EMPTY_TITLE = 'Chưa có mẫu 3D nào';
const EMPTY_DESCRIPTION = 'Thư viện chưa có mẫu 3D nào.';
const EMPTY_BADGE = 'Chưa có mẫu 3D';
const ERROR_TITLE = 'Không tải được thư viện mẫu 3D';
const ERROR_BADGE = 'Không tải được';
const GENERIC_ERROR_MESSAGE = 'Đã có lỗi xảy ra.';
const RETRY_LABEL = 'Thử lại';
const HEAVY_SUFFIX = 'mẫu nặng';
const LOADING_ROW_COUNT = 10;
const COLUMN_COUNT = 6;
const PREVIEW_HEADER = 'Ảnh xem trước';

/** Dòng trạng thái: số mẫu nặng ở Badge, số mẫu + tổng dung lượng ở câu — mỗi số một chỗ. */
function LibraryStatus({ model }: { readonly model: ModelLibraryModel }) {
  if (model.state === 'loading') return null;
  if (model.isLibraryEmpty) return <Badge variant="neutral">{EMPTY_BADGE}</Badge>;
  if (model.state === 'error') return <Badge variant="violation">{ERROR_BADGE}</Badge>;

  const { summary } = model;
  return (
    <>
      {!summary.isAllWithinBudget && (
        <Badge variant="attention">
          <span className="tabular-nums" data-testid="model-library-heavy-count">
            {summary.heavyCountLabel}
          </span>{' '}
          {HEAVY_SUFFIX}
        </Badge>
      )}
      <span>
        <span className="tabular-nums" data-testid="model-library-total-count">
          {summary.totalCountLabel}
        </span>
        {' mẫu 3D, tổng dung lượng '}
        <span className="tabular-nums" data-testid="model-library-total-size">
          {summary.totalSizeLabel}
        </span>
        .
      </span>
    </>
  );
}

function ModelLibraryShell({ children, model }: { readonly children: ReactNode; readonly model: ModelLibraryModel }) {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-8 py-8 min-[120rem]:max-w-[1440px]">
      {/* Không breadcrumb: thanh tab quản trị đã chỉ đúng mục này. */}
      <PageHead className="mb-2" eyebrow={PAGE_EYEBROW} status={<LibraryStatus model={model} />} title={PAGE_TITLE} />
      {children}
    </div>
  );
}

export function ModelLibrary({ actions, model }: ModelLibraryProps) {
  const paged = usePaged(model.rows);
  if (model.state === 'loading') {
    return (
      <ModelLibraryShell model={model}>
        <Section flush>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>
                  <span className="sr-only">{PREVIEW_HEADER}</span>
                </Table.Head>
                <Table.Head>Tên</Table.Head>
                <Table.Head>Danh mục</Table.Head>
                <Table.Head>Kích thước bao</Table.Head>
                <Table.Head>Độ chi tiết (tam giác)</Table.Head>
                <Table.Head>Dung lượng</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Skeleton columns={COLUMN_COUNT} rows={LOADING_ROW_COUNT} />
            </Table.Body>
          </Table.Root>
        </Section>
      </ModelLibraryShell>
    );
  }

  if (model.isLibraryEmpty) {
    return (
      <ModelLibraryShell model={model}>
        <Section>
          <EmptyState description={EMPTY_DESCRIPTION} icon={<Boxes aria-hidden="true" />} title={EMPTY_TITLE} />
        </Section>
      </ModelLibraryShell>
    );
  }

  if (model.state === 'error') {
    return (
      <ModelLibraryShell model={model}>
        <InlineAlert
          action={{ label: RETRY_LABEL, onClick: actions.retryLoad }}
          level="violation"
          message={model.errorMessage ?? GENERIC_ERROR_MESSAGE}
          title={ERROR_TITLE}
        />
      </ModelLibraryShell>
    );
  }

  return (
    <ModelLibraryShell model={model}>
      {model.readOnlyReason !== null && <InlineAlert level="attention" message={model.readOnlyReason} />}
      {/* G2-17: panel chi tiết đứng cạnh khung danh sách (≥1024), không rơi xuống dưới cuối danh sách. */}
      <div className="flex flex-col gap-4 min-[64rem]:flex-row min-[64rem]:items-start">
        <Section className="min-w-0 flex-1" flush>
          <ModelLibraryToolbar actions={actions} model={model} />
          <div className={model.viewMode === 'grid' || model.isNarrow ? 'p-5' : undefined}>
            <ModelLibraryTable actions={actions} model={{ ...model, rows: paged.pageRows }} />
          </div>
          <Pager onPageChange={paged.setPage} page={paged.page} pageCount={paged.pageCount} total={paged.total} />
        </Section>
        {model.detail !== null && (
          <div className="min-[64rem]:sticky min-[64rem]:top-4 min-[64rem]:max-h-[calc(100vh-2rem)]">
            <ModelLibraryDetail actions={actions} model={model.detail} />
          </div>
        )}
      </div>
    </ModelLibraryShell>
  );
}
