/** FIX-P0-15: tầng cần xem lại (N16 `readiness`) thành một dòng preflight attention; Xuất vẫn bật (30-C-023). */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Level } from '@/domain/spatial/types';
import { ROUTES } from '@/routes/paths';

import { ExportPanel } from './ExportPanel';
import { buildExportPanelProps, formatsSelecting } from './exportPanelFixtures';
import { buildPreflightRows } from './exportPanelGateway';

afterEach(cleanup);

const PROJECT_ID = 'P-1';
const level = { id: 'L-1', name: 'Tầng 1', reviewed: true, scaleMillimetresPerPixel: 12 } as unknown as Level;
const levelWithoutScale = { id: 'L-1', name: 'Tầng 1', reviewed: true } as unknown as Level;
const rowsFor = (floorMeta?: Parameters<typeof buildPreflightRows>[0]['floorMeta']) =>
  buildPreflightRows({
    projectId: PROJECT_ID,
    graph: null,
    levels: [level],
    violations: [],
    ...(floorMeta !== undefined ? { floorMeta } : {}),
  });

describe('buildPreflightRows — readiness (FIX-P0-15)', () => {
  it('BE chưa trả readiness, tỷ lệ còn tạm: dòng attention dẫn tới Đặt tỷ lệ', () => {
    const row = rowsFor({ 'L-1': { scaleStatus: 'unresolved' } }).find((entry) => entry.id === 'readiness');

    expect(row).toEqual({
      id: 'readiness',
      label: 'Cần xem lại 1 tầng: Tầng 1 (tỷ lệ tạm).',
      tone: 'attention',
      fixHref: ROUTES.project.scale(PROJECT_ID, 'L-1'),
    });
  });

  it('readiness needsReview vì lỗi nghiêm trọng: dòng dẫn tới Duyệt tầng', () => {
    const row = rowsFor({
      'L-1': { readiness: { state: 'needsReview', reasons: ['criticalIssues', 'fallbackWallModel'] } },
    }).find((entry) => entry.id === 'readiness');

    expect(row?.label).toBe(
      'Cần xem lại 1 tầng: Tầng 1 (lỗi nghiêm trọng, tường dò bằng mô hình dự phòng).',
    );
    expect(row?.fixHref).toBe(ROUTES.project.walls(PROJECT_ID, 'L-1'));
  });

  it('tầng có mái máy dựng chưa duyệt (NHA-07b): dòng dẫn tới Duyệt tầng', () => {
    const row = rowsFor({ 'L-1': { readiness: { state: 'needsReview', reasons: ['roofUnreviewed'] } } }).find(
      (entry) => entry.id === 'readiness',
    );

    expect(row?.label).toBe('Cần xem lại 1 tầng: Tầng 1 (mái máy dựng chưa duyệt).');
    expect(row?.fixHref).toBe(ROUTES.project.walls(PROJECT_ID, 'L-1'));
  });

  it('mái chưa duyệt đi cùng tỷ lệ tạm: nêu cả hai, liên kết sửa vẫn là Đặt tỷ lệ', () => {
    const row = rowsFor({
      'L-1': { readiness: { state: 'needsReview', reasons: ['scaleUnresolved', 'roofUnreviewed'] } },
    }).find((entry) => entry.id === 'readiness');

    expect(row?.label).toBe('Cần xem lại 1 tầng: Tầng 1 (tỷ lệ tạm, mái máy dựng chưa duyệt).');
    expect(row?.fixHref).toBe(ROUTES.project.scale(PROJECT_ID, 'L-1'));
  });

  it('readiness của BE thắng scaleStatus; ready hoặc không có siêu dữ liệu thì không có dòng', () => {
    const ready = rowsFor({ 'L-1': { readiness: { state: 'ready', reasons: [] }, scaleStatus: 'unresolved' } });

    expect(ready.some((entry) => entry.id === 'readiness')).toBe(false);
    expect(rowsFor().some((entry) => entry.id === 'readiness')).toBe(false);
  });

  it('tầng có bản vẽ mà chưa có tỷ lệ: dòng attention dẫn tới Đặt tỷ lệ (U12)', () => {
    const row = buildPreflightRows({
      projectId: PROJECT_ID,
      graph: null,
      levels: [levelWithoutScale],
      violations: [],
    }).find((entry) => entry.id === 'readiness');

    expect(row?.label).toBe('Cần xem lại 1 tầng: Tầng 1 (tỷ lệ tạm).');
    expect(row?.fixHref).toBe(ROUTES.project.scale(PROJECT_ID, 'L-1'));
  });

  it('dòng readiness không chặn nút Xuất', () => {
    const preflight = rowsFor({ 'L-1': { scaleStatus: 'unresolved' } });
    const props = buildExportPanelProps('success', { formats: formatsSelecting('glb'), preflight });

    render(<ExportPanel {...props} />);

    expect(screen.getByText('Cần xem lại 1 tầng: Tầng 1 (tỷ lệ tạm).')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Xuất \.glb$/u })).not.toBeDisabled();
  });
});
