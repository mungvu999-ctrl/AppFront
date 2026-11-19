/**
 * Story của bảng "Đề xuất của máy cho cả nhà" — bảy trạng thái của A11, cộng một story chạy
 * `MOCK_HOUSE_PROPOSAL` qua viewmodel. Bài kiểm dùng lại `proposalArgsFor` (R-70), nên hàm này và
 * các hằng dữ liệu phải nằm trong `meta.excludeStories` (một export không phải story làm trắng file).
 */

import type { Meta, StoryObj } from '@storybook/react';

import { MOCK_HOUSE_PROPOSAL } from '@/api/__mocks__/client';
import type { HouseProposal } from '@/api/schemas/houseProposal';
import { type HouseProjectFloor, summarise, toHouseProposalRows } from '@/lib/viewmodel/houseProposal';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import { FloorProposalPanel, type FloorProposalPanelProps } from './FloorProposalPanel';

/** Bốn tầng của dự án mẫu, đúng id với `MOCK_HOUSE_PROPOSAL`; số hiện tại cố ý lệch đề xuất. */
export const PROPOSAL_SAMPLE_FLOORS: readonly HouseProjectFloor[] = [
  { id: 'flr-mock-1', name: 'Tầng 1', order: 0, elevationMm: 0, heightMm: 3300 },
  { id: 'flr-mock-2', name: 'Tầng 2', order: 1, elevationMm: 3300, heightMm: 3300 },
  { id: 'flr-mock-3', name: 'Tầng 3', order: 2, elevationMm: 6600, heightMm: 3300 },
  { id: 'flr-mock-4', name: 'Tầng 4', order: 3, elevationMm: 9900, heightMm: 3300 },
];

/** Bản có một tầng máy chắc >= 0,9 ở mọi ô và không câu hỏi: tầng đó nhận được bằng một cú bấm. */
export const PROPOSAL_ONE_CLICK: HouseProposal = {
  ...MOCK_HOUSE_PROPOSAL,
  floors: MOCK_HOUSE_PROPOSAL.floors.map((entry) =>
    entry.floorId === 'flr-mock-1' ? { ...entry, heightConfidence: 0.92 } : entry,
  ),
};

const IDLE = { onAccept: () => undefined, onAcceptAll: () => undefined, onRetry: () => undefined } as const;

const ROWS = toHouseProposalRows(PROPOSAL_ONE_CLICK, PROPOSAL_SAMPLE_FLOORS);
const SUMMARY = summarise(ROWS);
const EMPTY_SUMMARY = summarise([]);
/** Tầng 1..3 có đề xuất, tầng 4 không: trạng thái "một phần". */
const PARTIAL_ROWS = toHouseProposalRows(
  { ...PROPOSAL_ONE_CLICK, floors: PROPOSAL_ONE_CLICK.floors.slice(0, 3) },
  PROPOSAL_SAMPLE_FLOORS,
);
const PARTIAL_SUMMARY = summarise(PARTIAL_ROWS);

/** Props view của một trạng thái. */
export function proposalArgsFor(state: SevenState): FloorProposalPanelProps {
  switch (state) {
    case 'empty':
      return { ...IDLE, state, rows: [], summary: EMPTY_SUMMARY };
    case 'loading':
      return { ...IDLE, state, rows: [], summary: EMPTY_SUMMARY };
    case 'partial':
      return { ...IDLE, state, rows: PARTIAL_ROWS, summary: PARTIAL_SUMMARY };
    case 'error':
      return { ...IDLE, state, rows: [], summary: EMPTY_SUMMARY };
    case 'forbidden':
      return { ...IDLE, state, rows: ROWS, summary: SUMMARY };
    case 'collapsed':
      return { ...IDLE, state, rows: ROWS, summary: SUMMARY, onExpand: () => undefined };
    case 'success':
      return { ...IDLE, state, rows: ROWS, summary: SUMMARY };
  }
}

const meta = {
  title: 'Screens/QC/FloorManager/FloorProposalPanel',
  component: FloorProposalPanel,
  excludeStories: ['proposalArgsFor', 'PROPOSAL_SAMPLE_FLOORS', 'PROPOSAL_ONE_CLICK'],
} satisfies Meta<typeof FloorProposalPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 1. Rỗng — máy chưa có đề xuất nào. */
export const Rong: Story = { args: proposalArgsFor('empty') };

/** 2. Đang tải — khung xương. */
export const DangTai: Story = { args: proposalArgsFor('loading') };

/** 3. Một phần — tầng 4 máy không đề xuất gì. */
export const MotPhan: Story = { args: proposalArgsFor('partial') };

/** 4. Lỗi — không đọc được đề xuất, có nút thử lại. */
export const Loi: Story = { args: proposalArgsFor('error') };

/** 5. Xong — bốn tầng đủ ba dải độ chắc; Tầng 1 nhận được bằng một cú bấm. */
export const ThanhCong: Story = { args: proposalArgsFor('success') };

/** 6. Không có quyền — chỉ đọc, không có nút "Nhận". */
export const KhongCoQuyen: Story = { args: proposalArgsFor('forbidden') };

/** 7. Thu gọn — chỉ còn thanh đầu và nút mở lại. */
export const ThuGon: Story = { args: proposalArgsFor('collapsed') };

/** 8. Dữ liệu mẫu nguyên bản `MOCK_HOUSE_PROPOSAL` qua viewmodel: không tầng nào nhận bằng một cú bấm. */
export const DuLieuMauNguyenBan: Story = {
  args: (() => {
    const rows = toHouseProposalRows(MOCK_HOUSE_PROPOSAL, PROPOSAL_SAMPLE_FLOORS);

    return { ...IDLE, state: 'success', rows, summary: summarise(rows) };
  })(),
};
