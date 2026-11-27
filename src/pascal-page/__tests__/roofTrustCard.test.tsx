import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { RoofTrustCard, type RoofTrustStores } from '../RoofTrustCard';

const AI = { appfront: { confidence: 0.6, source: 'ai', reviewed: false } };
const APPROVED = { appfront: { confidence: 0.6, source: 'human', reviewed: true } };
const HAND_DRAWN = { appfront: { confidence: 1, source: 'human', reviewed: false } };

const nodesOf = (metadata: object) => ({
  'roof_RF-0123456789AB': { id: 'roof_RF-0123456789AB', type: 'roof', parentId: 'level_1', metadata },
  rseg_1: { id: 'rseg_1', type: 'roof-segment', parentId: 'roof_RF-0123456789AB' },
  wall_1: { id: 'wall_1', type: 'wall', parentId: 'level_1' },
});

function storesOf(selectedIds: readonly string[], metadata: object = AI) {
  const updateNode = vi.fn();
  const singleStep = vi.fn((run: () => void) => {
    run();
  });
  const useViewer = create(() => ({ selection: { selectedIds } }));
  const useScene = create(() => ({ nodes: nodesOf(metadata), updateNode }));

  return { stores: { useViewer, useScene, singleStep } as unknown as RoofTrustStores, updateNode, singleStep, useScene };
}

afterEach(cleanup);

describe('RoofTrustCard (NHA-09)', () => {
  it('chọn mái do máy dựng: chip nói rõ cần duyệt, không mang tông "đã xác minh", kèm nút "Duyệt mái"', () => {
    render(<RoofTrustCard readOnly={false} stores={storesOf(['roof_RF-0123456789AB']).stores} />);
    const chip = screen.getByRole('status');

    expect(chip.textContent).toBe('Mái do máy dựng — cần duyệt');
    expect(chip.getAttribute('data-tone')).toBe('attention');
    expect(screen.getByRole('button', { name: 'Duyệt mái' })).toBeTruthy();
  });

  it('"Duyệt mái" ghi đúng một lượt trong đúng một bước hoàn tác: đổi cả nguồn lẫn cờ duyệt của node mái', async () => {
    const { singleStep, stores, updateNode } = storesOf(['roof_RF-0123456789AB']);

    render(<RoofTrustCard readOnly={false} stores={stores} />);
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Duyệt mái' }));
    expect(singleStep).toHaveBeenCalledTimes(1);
    expect(updateNode).toHaveBeenCalledTimes(1);
    expect(updateNode).toHaveBeenCalledWith('roof_RF-0123456789AB', { metadata: { appfront: { confidence: 0.6, source: 'human', reviewed: true } } });
  });

  it('chọn một mặt mái thì duyệt mái chủ của nó', async () => {
    const { stores, updateNode } = storesOf(['rseg_1']);

    render(<RoofTrustCard readOnly={false} stores={stores} />);
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Duyệt mái' }));
    expect(updateNode.mock.calls[0]?.[0]).toBe('roof_RF-0123456789AB');
  });

  it('cảnh đổi thành đã duyệt thì chip xanh và hết nút; hoàn tác (cảnh quay về) thì chip và nút trở lại', () => {
    const { stores, useScene } = storesOf(['roof_RF-0123456789AB']);

    render(<RoofTrustCard readOnly={false} stores={stores} />);
    act(() => {
      // eslint-disable-next-line local/no-direct-set -- kho giả của test (thay cho `useScene` của Pascal), không phải kho AppFront.
      useScene.setState({ nodes: nodesOf(APPROVED) });
    });
    expect(screen.getByRole('status').textContent).toBe('Bạn đã duyệt');
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('verified');
    expect(screen.queryByRole('button')).toBeNull();
    act(() => {
      // eslint-disable-next-line local/no-direct-set -- kho giả của test (thay cho `useScene` của Pascal), không phải kho AppFront.
      useScene.setState({ nodes: nodesOf(AI) });
    });
    expect(screen.getByRole('status').textContent).toBe('Mái do máy dựng — cần duyệt');
    expect(screen.getByRole('button', { name: 'Duyệt mái' })).toBeTruthy();
  });

  it('mái trình soạn vừa nhân bản (id chưa phải của bản vẽ) mang túi chép từ mái gốc: không chip, không nút', () => {
    const copy = { roof_k3n9q2w8e7r6: { id: 'roof_k3n9q2w8e7r6', type: 'roof', parentId: 'level_1', metadata: APPROVED } };
    const useViewer = create(() => ({ selection: { selectedIds: ['roof_k3n9q2w8e7r6'] as readonly string[] } }));
    const useScene = create(() => ({ nodes: copy, updateNode: vi.fn() }));
    const { container } = render(
      <RoofTrustCard readOnly={false} stores={{ useViewer, useScene, singleStep: vi.fn() } as unknown as RoofTrustStores} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('chỉ xem: có chip, không có nút', () => {
    render(<RoofTrustCard readOnly stores={storesOf(['roof_RF-0123456789AB']).stores} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['mái người vẽ', ['roof_RF-0123456789AB'], HAND_DRAWN],
    ['node không phải mái', ['wall_1'], AI],
    ['chọn hai node', ['roof_RF-0123456789AB', 'rseg_1'], AI],
    ['không chọn gì', [], AI],
  ] as const)('%s: không hiện gì', (_name, selectedIds, metadata) => {
    const { container } = render(<RoofTrustCard readOnly={false} stores={storesOf(selectedIds, metadata).stores} />);

    expect(container.innerHTML).toBe('');
  });

  it('main.tsx gắn thẻ thẳng vào cụm "Cảnh", ngoài nhóm thẻ của thẻ thao tác nhanh (thẻ đó không hiện khi chọn mái)', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/pascal-page/main.tsx'), 'utf8');
    const start = main.indexOf('const itemCards = (');

    expect(start).toBeGreaterThan(-1);
    expect(main.slice(start, main.indexOf('return (', start))).not.toContain('<RoofTrust');
    // Đứng riêng một dòng: không nằm trong biểu thức `điều kiện ? … : …` nào (lỗi cũ: chỉ người xem mới thấy thẻ).
    expect(main.match(/^\s*<RoofTrust readOnly=\{readOnly\} \/>$/gmu)).toHaveLength(1);
    expect(main.match(/<RoofTrustCard /gu)).toHaveLength(1);
  });
});
