import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HouseFloorProposal, HouseProposal } from '@/api/schemas/houseProposal';
import type { HttpError } from '@/lib/http';
import { createShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { createNotificationBus } from '@/lib/mutations/notificationBus';
import { createTestQueryClient } from '@/lib/testing/render';
import { resetSelectorCaches } from '@/store/selectors';
import { useStore } from '@/store';

import {
  createMockFloorManagerGateway,
  FLOOR_MANAGER_SAMPLE_GROUND_ID,
  FLOOR_MANAGER_SAMPLE_ROOF_ID,
  FLOOR_MANAGER_SAMPLE_SECOND_ID,
  levelsOf,
} from './floorManagerGateway';
import { useFloorManager, type ApplyLevelValue } from './useFloorManager';
import { useFloorProposals, type HouseProposalApi, type ProposalFloor } from './useFloorProposals';

const PROJECT_ID = 'project-floor-proposals';
const GROUND = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
const SECOND = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);
const ROOF = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);

const entry = (floorId: string, values: Partial<HouseFloorProposal>): HouseFloorProposal => ({
  floorId,
  kind: 'plan',
  kindConfidence: 0.98,
  storeyLabel: 'floor',
  storeyConfidence: 0.95,
  elevationConfidence: 0.95,
  elevationSource: 'plan',
  heightConfidence: 0.95,
  heightSource: 'plan',
  questions: [],
  ...values,
});

/** Tầng trệt: chiều cao 4,2 m, chắc chắn → nhận một lần. Tầng mái: cao độ trùng Tầng 2, kém chắc. */
const PROPOSAL: HouseProposal = {
  floors: [
    entry(GROUND, { storeyLabel: 'ground', elevationMm: 0, heightMm: 4200 }),
    entry(ROOF, { elevationMm: 3900, elevationConfidence: 0.5, heightMm: 3000, heightConfidence: 0.5 }),
  ],
  runIds: ['run-1'],
};

const apiOf = (read: HouseProposalApi['houseProposal']['read']): HouseProposalApi => ({ houseProposal: { read } });
const okApi = (data: HouseProposal | null): HouseProposalApi => apiOf(() => Promise.resolve({ ok: true, data }));
const FAILURE: HttpError = { kind: 'network', requestId: 'req-1', retryable: true, raw: 'offline' };

const wrapperOf = () => {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }): ReactNode => createElement(QueryClientProvider, { client }, children);
};

const STATIC_FLOORS: readonly ProposalFloor[] = [
  { id: GROUND, name: 'Tầng trệt', elevationMm: 0, heightMm: 3900 },
  { id: SECOND, name: 'Tầng 2', elevationMm: 3900, heightMm: 3600 },
  { id: ROOF, name: 'Tầng mái', elevationMm: 7500, heightMm: 3600 },
];

function mountAlone(api: HouseProposalApi | null, apply: ApplyLevelValue = vi.fn(() => Promise.resolve(true))) {
  return renderHook(() => useFloorProposals(PROJECT_ID, STATIC_FLOORS, { apply, canEdit: true, api }), {
    wrapper: wrapperOf(),
  });
}

/** Cả hai hook trên cổng giả: "Nhận" đi qua đường ghi thật của ô nhập tay. */
function mountWired(api: HouseProposalApi) {
  const spoken: string[] = [];
  return renderHook(
    () => {
      const manager = useFloorManager({
        projectId: PROJECT_ID,
        roles: ['engineer'],
        gateway: createMockFloorManagerGateway(),
        registry: createShortcutRegistry(),
        notifications: createNotificationBus(),
        announcer: { announce: (line) => void spoken.push(line), destroy: () => undefined },
      });
      const proposals = useFloorProposals(PROJECT_ID, manager.rows, {
        apply: manager.applyLevelValue,
        canEdit: manager.canEdit,
        api,
      });
      return { manager, proposals };
    },
    { wrapper: wrapperOf() },
  );
}

const levelOf = (id: string) => levelsOf(useStore.getState().spatial).find((level) => String(level.id) === id);

afterEach(() => {
  cleanup();
  useStore.getState().setSpatial(null, null);
  resetSelectorCaches();
});

describe('useFloorProposals — trạng thái', () => {
  it('lượt đọc đầu: loading và ẩn; xong thì partial (Tầng 2 không có đề xuất)', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    expect(mounted.result.current.panel.state).toBe('loading');
    expect(mounted.result.current.hidden).toBe(true);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    expect(mounted.result.current.panel.state).toBe('partial');
  });

  it('công tắc tắt (data null) → ẩn, đọc đúng một lần', async () => {
    const read = vi.fn(() => Promise.resolve({ ok: true as const, data: null }));
    const mounted = mountAlone(apiOf(read));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mounted.result.current.panel.state).not.toBe('loading'));
    expect(mounted.result.current.hidden).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('api null → không đọc, ẩn', () => {
    expect(mountAlone(null).result.current.hidden).toBe(true);
  });

  it('đề xuất rỗng → empty; đủ tầng → success', async () => {
    const empty = mountAlone(okApi({ floors: [], runIds: [] }));
    await waitFor(() => expect(empty.result.current.panel.state).toBe('empty'));
    const full = mountAlone(okApi({ ...PROPOSAL, floors: [...PROPOSAL.floors, entry(SECOND, { heightMm: 3600 })] }));
    await waitFor(() => expect(full.result.current.panel.state).toBe('success'));
  });

  it('lỗi không thử lại; "Thử lại" đọc lại và hiện bảng', async () => {
    const read = vi
      .fn<HouseProposalApi['houseProposal']['read']>()
      .mockResolvedValueOnce({ ok: false, error: FAILURE })
      .mockResolvedValue({ ok: true, data: PROPOSAL });
    const mounted = mountAlone(apiOf(read));
    await waitFor(() => expect(mounted.result.current.panel.state).toBe('error'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.hidden).toBe(false);
    expect(mounted.result.current.panel.errorMessage).toBeTruthy();
    act(() => mounted.result.current.panel.onRetry());
    await waitFor(() => expect(mounted.result.current.panel.state).toBe('partial'));
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('useFloorProposals — nhận', () => {
  it('"Nhận" gọi applyLevelValue(floorId, field, mm)', async () => {
    const apply = vi.fn(() => Promise.resolve(true));
    const mounted = mountAlone(okApi(PROPOSAL), apply);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    act(() => mounted.result.current.panel.onAccept(ROOF, 'elevation', 3900));
    expect(apply).toHaveBeenCalledWith(ROOF, 'elevation', 3900);
  });

  it('"Nhận tất cả" chỉ chạm dòng oneClick, dừng ở lượt hỏng đầu', async () => {
    const apply = vi.fn(() => Promise.resolve(true));
    const mounted = mountAlone(okApi(PROPOSAL), apply);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    act(() => mounted.result.current.panel.onAcceptAll());
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith(GROUND, 'height', 4200);

    const failing = vi.fn(() => Promise.resolve(false));
    const two = mountAlone(
      okApi({ ...PROPOSAL, floors: [entry(GROUND, { heightMm: 4200 }), entry(SECOND, { heightMm: 3300 })] }),
      failing,
    );
    await waitFor(() => expect(two.result.current.hidden).toBe(false));
    act(() => two.result.current.panel.onAcceptAll());
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('nhận xong qua đường ghi thật: tầng đổi, ô hết "nhận được"', async () => {
    const mounted = mountWired(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.proposals.hidden).toBe(false));
    const groundRow = () => mounted.result.current.proposals.panel.rows.find((row) => row.floorId === GROUND);
    expect(groundRow()?.height.acceptable).toBe(true);

    act(() => mounted.result.current.proposals.panel.onAcceptAll());

    await waitFor(() => expect(levelOf(GROUND)?.heightMm).toBe(4200));
    await waitFor(() => expect(groundRow()?.height.acceptable).toBe(false));
    expect(levelOf(ROOF)?.heightMm).toBe(3600);
  });

  it('trùng cao độ: cùng câu chặn với ô nhập tay, không ghi, dòng vẫn nhận được', async () => {
    const mounted = mountWired(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.proposals.hidden).toBe(false));
    const steps = mounted.result.current.manager.historyStepCount();

    act(() => mounted.result.current.proposals.panel.onAccept(ROOF, 'elevation', 3900));

    await waitFor(() => expect(mounted.result.current.manager.duplicateElevationMessage).not.toBeNull());
    expect(mounted.result.current.manager.historyStepCount()).toBe(steps);
    expect(levelOf(ROOF)?.elevationMm).toBe(7500);
    const roofRow = mounted.result.current.proposals.panel.rows.find((row) => row.floorId === ROOF);
    expect(roofRow?.elevation.acceptable).toBe(true);
  });
});
