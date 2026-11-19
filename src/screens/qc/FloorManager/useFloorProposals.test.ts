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
import { acceptedKey, useFloorProposals, type HouseProposalApi, type ProposalFloor } from './useFloorProposals';

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

/** Tầng trệt: chiều cao 4,2 m đọc được (nhận được, dời hai tầng trên). Tầng mái: số giả định. */
const PROPOSAL: HouseProposal = {
  enabled: true,
  floors: [
    entry(GROUND, { storeyLabel: 'ground', elevationMm: 0, heightMm: 4200 }),
    entry(ROOF, { elevationMm: 7500, heightMm: 3000, heightSource: 'default' }),
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

/** Promise mở tay: lượt ghi treo cho tới khi bài kiểm cho xong. */
function deferred() {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mountAlone(
  api: HouseProposalApi | null,
  apply: ApplyLevelValue = vi.fn(() => Promise.resolve(true)),
  releaseDraft = vi.fn(),
) {
  return renderHook(
    ({ projectId, floors }: { projectId: string; floors: readonly ProposalFloor[] }) =>
      useFloorProposals(projectId, floors, { apply, releaseDraft, canEdit: true, api }),
    { wrapper: wrapperOf(), initialProps: { projectId: PROJECT_ID, floors: STATIC_FLOORS } },
  );
}

/** Cả hai hook trên cổng giả: "Nhận" đi qua đường ghi thật của ô nhập tay. */
function mountWired(api: HouseProposalApi) {
  return renderHook(
    () => {
      const manager = useFloorManager({
        projectId: PROJECT_ID,
        roles: ['engineer'],
        gateway: createMockFloorManagerGateway(),
        registry: createShortcutRegistry(),
        notifications: createNotificationBus(),
        announcer: { announce: () => undefined, destroy: () => undefined },
      });
      const proposals = useFloorProposals(PROJECT_ID, manager.rows, {
        apply: manager.applyLevelValue,
        releaseDraft: manager.onFloorFieldCancel,
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
  it('lượt đọc đầu: ẩn; xong thì partial (Tầng 2 không có đề xuất)', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    expect(mounted.result.current.hidden).toBe(true);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    expect(mounted.result.current.panel.state).toBe('partial');
  });

  it('công tắc tắt (data null) → ẩn, đọc đúng một lần', async () => {
    const read = vi.fn(() => Promise.resolve({ ok: true as const, data: null }));
    const mounted = mountAlone(apiOf(read));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(mounted.result.current.hidden).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('api null → không đọc, ẩn', () => {
    expect(mountAlone(null).result.current.hidden).toBe(true);
  });

  it('đủ tầng → success', async () => {
    const full = mountAlone(okApi({ ...PROPOSAL, floors: [...PROPOSAL.floors, entry(SECOND, { heightMm: 3600 })] }));
    await waitFor(() => expect(full.result.current.panel.state).toBe('success'));
  });

  it('mặc định thu gọn; bật tắt giữ suốt phiên của hook', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    expect(mounted.result.current.panel.expanded).toBe(false);
    act(() => mounted.result.current.panel.onToggleExpanded());
    expect(mounted.result.current.panel.expanded).toBe(true);
  });

  it('không ô nào khác giá trị hiện tại và không câu hỏi → ẩn hẳn; còn câu hỏi thì hiện', async () => {
    const same = mountAlone(okApi({ enabled: true, floors: [entry(GROUND, { elevationMm: 0, heightMm: 3900 })], runIds: ['r'] }));
    await act(async () => Promise.resolve());
    await waitFor(() => expect(same.result.current.panel.state).not.toBe('loading'));
    expect(same.result.current.hidden).toBe(true);

    const asking = mountAlone(
      okApi({
        enabled: true,
        floors: [entry(GROUND, { elevationMm: 0, heightMm: 3900, questions: [{ code: 'NO_TEXT' }] })],
        runIds: ['r'],
      }),
    );
    await waitFor(() => expect(asking.result.current.hidden).toBe(false));
  });

  it('lỗi đọc: một dòng lặng (state error, không ẩn), không tự thử lại; "Thử lại" đọc lại', async () => {
    const read = vi
      .fn<HouseProposalApi['houseProposal']['read']>()
      .mockResolvedValueOnce({ ok: false, error: FAILURE })
      .mockResolvedValue({ ok: true, data: PROPOSAL });
    const mounted = mountAlone(apiOf(read));
    await waitFor(() => expect(mounted.result.current.panel.state).toBe('error'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.hidden).toBe(false);
    act(() => mounted.result.current.panel.onRetry());
    await waitFor(() => expect(mounted.result.current.panel.state).toBe('partial'));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('điểm 8: mảng tầng mới cùng nội dung không dựng lại dòng', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    const before = mounted.result.current.panel.rows;
    mounted.rerender({ projectId: PROJECT_ID, floors: STATIC_FLOORS.map((floor) => ({ ...floor })) });
    expect(mounted.result.current.panel.rows).toBe(before);
    mounted.rerender({ projectId: PROJECT_ID, floors: STATIC_FLOORS.map((floor) => ({ ...floor, heightMm: 3000 })) });
    expect(mounted.result.current.panel.rows).not.toBe(before);
  });
});

describe('useFloorProposals — nhận', () => {
  const groundOf = (rows: ReturnType<typeof mountAlone>['result']['current']['panel']['rows']) => {
    const row = rows.find((item) => item.floorId === GROUND);
    if (row === undefined) throw new Error('thiếu Tầng trệt');
    return row;
  };

  it('không có nhận hàng loạt: panel chỉ có onAccept cho từng ô', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    expect(Object.keys(mounted.result.current.panel).filter((key) => /all|bulk/i.test(key))).toEqual([]);
  });

  it('"Nhận" gọi apply(floorId, field, mm, releaseDraft); releaseDraft bỏ nháp của đúng ô', async () => {
    const apply = vi.fn<ApplyLevelValue>(() => Promise.resolve(true));
    const releaseDraft = vi.fn();
    const mounted = mountAlone(okApi(PROPOSAL), apply, releaseDraft);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    await act(async () => mounted.result.current.panel.onAccept(groundOf(mounted.result.current.panel.rows), 'height'));
    expect(apply).toHaveBeenCalledTimes(1);
    const [id, field, mm, release] = apply.mock.calls[0] ?? [];
    expect([id, field, mm]).toEqual([GROUND, 'height', 4200]);
    release?.();
    expect(releaseDraft).toHaveBeenCalledWith(GROUND, 'height');
  });

  it('một lượt một lúc: busy khi đang ghi, bấm đúp chỉ ghi một lần', async () => {
    const pending = deferred();
    const apply = vi.fn<ApplyLevelValue>(() => pending.promise);
    const mounted = mountAlone(okApi(PROPOSAL), apply);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    const row = groundOf(mounted.result.current.panel.rows);
    act(() => {
      mounted.result.current.panel.onAccept(row, 'height');
      mounted.result.current.panel.onAccept(row, 'height');
    });
    expect(mounted.result.current.panel.busy).toBe(true);
    await act(async () => pending.resolve(true));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.panel.busy).toBe(false);
  });

  it('nhận được: ô vào "đã nhận", tiêu điểm về dòng, câu thông báo nói thêm việc dời tầng', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    await act(async () => mounted.result.current.panel.onAccept(groundOf(mounted.result.current.panel.rows), 'height'));
    const { panel } = mounted.result.current;
    expect(panel.accepted.has(acceptedKey(GROUND, 'height'))).toBe(true);
    expect(panel.focus).toEqual({ floorId: GROUND });
    expect(panel.message).toMatch(/^Đã nhận chiều cao Tầng trệt: .*Cao độ Tầng 2, Tầng mái dời/);
  });

  it('nhận hỏng: thông báo "Chưa nhận được:", ô vẫn nhận được, không vào "đã nhận"', async () => {
    const mounted = mountAlone(okApi(PROPOSAL), vi.fn(() => Promise.resolve(false)));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    await act(async () => mounted.result.current.panel.onAccept(groundOf(mounted.result.current.panel.rows), 'height'));
    const { panel } = mounted.result.current;
    expect(panel.message).toMatch(/^Chưa nhận được: /);
    expect(panel.accepted.size).toBe(0);
    expect(panel.focus).toBeNull();
    expect(groundOf(panel.rows).height.acceptable).toBe(true);

    const throwing = mountAlone(okApi(PROPOSAL), vi.fn(() => Promise.reject(new Error('x'))));
    await waitFor(() => expect(throwing.result.current.hidden).toBe(false));
    await act(async () => throwing.result.current.panel.onAccept(groundOf(throwing.result.current.panel.rows), 'height'));
    expect(throwing.result.current.panel.message).toMatch(/^Chưa nhận được: /);
    expect(throwing.result.current.panel.busy).toBe(false);
  });

  it('gỡ màn khi lượt ghi đang chạy: ghi đúng một lần, sau đó không làm gì', async () => {
    const pending = deferred();
    const apply = vi.fn<ApplyLevelValue>(() => pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mounted = mountAlone(okApi(PROPOSAL), apply);
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    act(() => mounted.result.current.panel.onAccept(groundOf(mounted.result.current.panel.rows), 'height'));
    mounted.unmount();
    await act(async () => pending.resolve(true));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('đổi dự án khi lượt ghi đang chạy: phiên mới không nhận chữ "Đã nhận" của dự án cũ', async () => {
    const pending = deferred();
    const mounted = mountAlone(okApi(PROPOSAL), vi.fn<ApplyLevelValue>(() => pending.promise));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    act(() => mounted.result.current.panel.onAccept(groundOf(mounted.result.current.panel.rows), 'height'));
    mounted.rerender({ projectId: 'project-other', floors: STATIC_FLOORS });
    await act(async () => pending.resolve(true));
    expect(mounted.result.current.panel.message).toBe('');
    expect(mounted.result.current.panel.accepted.size).toBe(0);
    expect(mounted.result.current.panel.busy).toBe(false);
  });

  it('nhận qua đường ghi thật: tầng đổi, tầng trên dời theo, ô hết "nhận được" và dòng vẫn hiện', async () => {
    const mounted = mountWired(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.proposals.hidden).toBe(false));
    const groundRow = () => groundOf(mounted.result.current.proposals.panel.rows);
    expect(groundRow().height.acceptable).toBe(true);

    await act(async () => mounted.result.current.proposals.panel.onAccept(groundRow(), 'height'));

    await waitFor(() => expect(levelOf(GROUND)?.heightMm).toBe(4200));
    await waitFor(() => expect(groundRow().height.acceptable).toBe(false));
    expect(levelOf(SECOND)?.elevationMm).toBe(4200);
    expect(mounted.result.current.proposals.hidden).toBe(false);
  });

  it('số giả định không bao giờ nhận được', async () => {
    const mounted = mountAlone(okApi(PROPOSAL));
    await waitFor(() => expect(mounted.result.current.hidden).toBe(false));
    const roof = mounted.result.current.panel.rows.find((row) => row.floorId === ROOF);
    expect(roof?.height.sourceKind).toBe('assumed');
    expect(roof?.height.acceptable).toBe(false);
  });
});
