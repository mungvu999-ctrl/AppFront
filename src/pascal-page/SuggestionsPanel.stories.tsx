/**
 * Các trạng thái của {@link SuggestionsPanel} (M2): chưa có gợi ý, một tầng đủ nhóm (có món đã nhận nuôi,
 * nhóm chỉ liệt kê, gợi ý cũ), tầng đã tắt lớp và chờ lưu, chỉ xem. View thuần — `args` tĩnh.
 */
import type { Meta, StoryObj } from '@storybook/react';

import type { FloorSuggestionsView } from './suggestionLayer';
import { SuggestionsPanel } from './SuggestionsPanel';
import type { SuggestionLayerView } from './useSuggestionLayer';

const meta = {
  title: 'Pascal/SuggestionsPanel',
  component: SuggestionsPanel,
  tags: ['autodocs'],
} satisfies Meta<typeof SuggestionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const FLOOR: FloorSuggestionsView = {
  floorId: 'L-01',
  floorName: 'Tầng 1',
  visible: true,
  pending: false,
  groups: [
    {
      rule: 'R1',
      title: 'Len chân tường',
      countLabel: '2/3 đang bật',
      listOnly: false,
      items: [
        { id: 'DRESS-R1-R-1-W-1', label: 'Len chân tường — Phòng khách', on: true, adopted: false },
        { id: 'DRESS-R1-R-1-W-2', label: 'Len chân tường — Phòng khách', on: false, adopted: false },
        { id: 'DRESS-R1-R-2-W-3', label: 'Len chân tường — Phòng ngủ 1', on: true, adopted: false },
      ],
    },
    {
      rule: 'R3',
      title: 'Phào trần',
      countLabel: '1/1 đang bật',
      listOnly: true,
      items: [{ id: 'DRESS-R3-R-1', label: 'Phào trần — Phòng khách', on: true, adopted: false }],
    },
    {
      rule: 'P1',
      title: 'Đồ chính theo công năng',
      countLabel: '0/1 đang bật',
      listOnly: false,
      items: [{ id: 'DRESS-P1-R-2-bed', label: 'Đồ — Phòng ngủ 1', on: false, adopted: true }],
    },
  ],
  stale: [{ id: 'DRESS-L1-R-9', label: 'Đèn trần — tầng', reason: 'đồ chủ đã bị xoá khỏi bản vẽ' }],
};

const view = (patch: Partial<SuggestionLayerView> = {}): SuggestionLayerView => ({
  floors: [FLOOR],
  readOnly: false,
  onToggleVisible: () => undefined,
  onToggleItem: () => undefined,
  ...patch,
});

export const Empty: Story = { args: { view: view({ floors: [] }) } };
export const Floor: Story = { args: { view: view() } };
export const HiddenPending: Story = { args: { view: view({ floors: [{ ...FLOOR, visible: false, pending: true }] }) } };
export const ReadOnly: Story = { args: { view: view({ readOnly: true }) } };
