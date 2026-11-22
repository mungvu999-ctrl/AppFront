/**
 * Story của bảng "Đề xuất của máy cho cả nhà" — bảy trạng thái của A11, cộng một story chạy
 * `MOCK_HOUSE_PROPOSAL` qua viewmodel. Bài kiểm dùng lại `proposalArgsFor` (R-70), nên hàm này và
 * các hằng dữ liệu phải nằm trong `meta.excludeStories` (một export không phải story làm trắng file).
 */

import type { Meta, StoryObj } from '@storybook/react';

import { MOCK_HOUSE_PROPOSAL } from '@/api/__mocks__/client';
import { type HouseProjectFloor, summarise, toHouseProposalRows } from '@/lib/viewmodel/houseProposal';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import { FloorProposalPanel, type FloorProposalPanelProps } from './FloorProposalPanel';

/** Bốn tầng của `project-1` (đúng id và số hiện tại của bộ mẫu), từ dưới lên như bảng tầng. */
export const PROPOSAL_SAMPLE_FLOORS: readonly HouseProjectFloor[] = [
  { id: 'L-0000000LX1', name: 'Tầng hầm', order: 0, elevationMm: -3000, heightMm: 3000 },
  { id: 'L-00000000L1', name: 'Tầng 1', order: 1, elevationMm: 0, heightMm: 3900 },
  { id: 'L-00000000L2', name: 'Tầng 2', order: 2, elevationMm: 3900, heightMm: 3600 },
  { id: 'L-00000000L3', name: 'Tầng 3', order: 3, elevationMm: 7500, heightMm: 3600 },
];

const IDLE = {
  expanded: true,
  busy: false,
  accepted: new Set<string>(),
  message: '',
  focus: null,
  onAccept: () => undefined,
  onToggleSection: () => undefined,
  onRetry: () => undefined,
  onToggleExpanded: () => undefined,
} as const;

const ROWS = toHouseProposalRows(MOCK_HOUSE_PROPOSAL, PROPOSAL_SAMPLE_FLOORS);
const SUMMARY = summarise(ROWS);
const EMPTY_SUMMARY = summarise([]);
/** Tầng hầm, 1, 2 có đề xuất, tầng 3 không: trạng thái "một phần". */
const PARTIAL_ROWS = toHouseProposalRows(
  { ...MOCK_HOUSE_PROPOSAL, floors: MOCK_HOUSE_PROPOSAL.floors.slice(0, 3) },
  PROPOSAL_SAMPLE_FLOORS,
);
const PARTIAL_SUMMARY = summarise(PARTIAL_ROWS);
/** Tầng 3 được người dùng đánh dấu là mặt cắt; máy chưa đọc được chữ trên nó. */
const SECTION_ROWS = toHouseProposalRows(
  {
    ...MOCK_HOUSE_PROPOSAL,
    floors: [
      ...MOCK_HOUSE_PROPOSAL.floors.slice(0, 3),
      { floorId: 'L-00000000L3', kind: 'section', kindConfidence: 1, storeyConfidence: 0, questions: [{ code: 'NO_TEXT' }], isSection: true },
    ],
  },
  PROPOSAL_SAMPLE_FLOORS,
);
/** Props view có một dòng mặt cắt (story + bài kiểm). */
export const SECTION_ARGS: FloorProposalPanelProps = { ...IDLE, state: 'partial', rows: SECTION_ROWS, summary: summarise(SECTION_ROWS) };

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
      return { ...IDLE, state, expanded: false, rows: ROWS, summary: SUMMARY };
    case 'success':
      return { ...IDLE, state, rows: ROWS, summary: SUMMARY };
  }
}

const meta = {
  title: 'Screens/QC/FloorManager/FloorProposalPanel',
  component: FloorProposalPanel,
  excludeStories: ['proposalArgsFor', 'PROPOSAL_SAMPLE_FLOORS', 'SECTION_ARGS'],
} satisfies Meta<typeof FloorProposalPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 1. Rỗng — container không bao giờ vẽ; view vẽ một dòng. */
export const Rong: Story = { args: proposalArgsFor('empty') };

/** 2. Đang tải — khung xương. */
export const DangTai: Story = { args: proposalArgsFor('loading') };

/** 3. Một phần — tầng 3 máy không đề xuất gì. */
export const MotPhan: Story = { args: proposalArgsFor('partial') };

/** 4. Lỗi — một dòng lặng trong thanh, có nút thử lại. */
export const Loi: Story = { args: proposalArgsFor('error') };

/** 5. Xong, bảng mở — bốn tầng đủ ba dải độ chắc; mỗi ô nhận được có nút riêng và câu nói trước việc nó làm. */
export const ThanhCong: Story = { args: proposalArgsFor('success') };

/** 6. Không có quyền — chỉ đọc, không có nút "Nhận". */
export const KhongCoQuyen: Story = { args: proposalArgsFor('forbidden') };

/** 7. Thu gọn — mặc định của màn: chỉ một thanh. */
export const ThuGon: Story = { args: proposalArgsFor('collapsed') };

/** Tầng 3 đã đánh dấu là mặt cắt: không số để nhận, có nút "Không phải mặt cắt". */
export const MatCat: Story = { args: SECTION_ARGS };
