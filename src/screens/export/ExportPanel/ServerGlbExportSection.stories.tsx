/**
 * Các trạng thái của {@link ServerGlbExportSection} (M1-01, R-50): đường nhanh, đang dựng, sẵn sàng,
 * có thiếu sót, không dùng được, lỗi. View thuần — `args` tĩnh, không hook, không mạng.
 */
import type { Meta, StoryObj } from '@storybook/react';

import { ServerGlbExportSection } from './ServerGlbExportSection';
import { SERVER_GLB_STALE_NOTE, type ServerGlbExportView, type ServerGlbResultView } from './useServerGlbExport';

const meta = {
  title: 'Screens/Export/ServerGlbExportSection',
  component: ServerGlbExportSection,
  tags: ['autodocs'],
} satisfies Meta<typeof ServerGlbExportSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const view = (patch: Partial<ServerGlbExportView> = {}): ServerGlbExportView => ({
  engine: 'server',
  isBusy: false,
  progressLabel: null,
  errorMessage: null,
  snapshotLine: 'Dựng từ bản lưu: tầng Tầng trệt revision 3 · lúc 12:00',
  staleNote: null,
  result: null,
  onSelectEngine: () => undefined,
  onDownload: () => undefined,
  ...patch,
});

const result = (patch: Partial<ServerGlbResultView> = {}): ServerGlbResultView => ({
  qualityLabel: 'Sẵn sàng',
  qualityTone: 'ok',
  issues: [],
  canDownloadGlb: true,
  glbSizeLabel: '4,2 MB',
  ...patch,
});

/** Đường nhanh — chỉ hai lựa chọn. */
export const Quick: Story = { args: { view: view({ engine: 'quick', snapshotLine: null }) } };

/** Đang dựng — tiến độ, chưa có nút tải. */
export const Building: Story = {
  args: { view: view({ isBusy: true, progressLabel: 'Máy chủ đang dựng mô hình…', snapshotLine: null }) },
};

/** Sẵn sàng — huy hiệu trung tính (A5), ba nút tải. */
export const Ready: Story = { args: { view: view({ result: result() }) } };

/** Có thiếu sót, dữ liệu đã đổi sau lần xuất. */
export const Degraded: Story = {
  args: {
    view: view({
      staleNote: SERVER_GLB_STALE_NOTE,
      result: result({
        qualityLabel: 'Có thiếu sót',
        qualityTone: 'attention',
        issues: [{ key: 'major-0', severity: 'major', reason: 'Cửa thiếu bộ cửa', countLabel: '× 2' }],
      }),
    }),
  },
};

/** Không dùng được — ẩn tải GLB. */
export const Blocked: Story = {
  args: {
    view: view({
      result: result({
        qualityLabel: 'Không dùng được',
        qualityTone: 'violation',
        canDownloadGlb: false,
        glbSizeLabel: null,
        issues: [{ key: 'critical-0', severity: 'critical', reason: 'Tầng không có tường', countLabel: '× 1' }],
      }),
    }),
  },
};

/** Lỗi — câu tiếng Việt theo mã. */
export const ErrorState: Story = {
  args: { view: view({ snapshotLine: null, errorMessage: 'Máy chủ dựng quá lâu nên đã dừng. Thử xuất lại sau.' }) },
};
