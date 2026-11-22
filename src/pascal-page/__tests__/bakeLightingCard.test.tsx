/**
 * Thẻ "Nướng ánh sáng" (`../BakeLightingCard`): câu trạng thái theo lượt nướng, khoá nút khi đang
 * nướng, nút xem chỉ khi xong; hook gửi GLB rồi đọc lại khi máy chủ báo đang có lượt chạy.
 */
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import type { LightingBake } from '@/api/schemas/lightingBake';

import { BakeLightingCard, BakeLightingView } from '../BakeLightingCard';
import { bakeStatusLabel, useLightingBake } from '../useLightingBake';

let availability: unknown = { ok: true, data: { enabled: true } };
vi.mock('@/api/appClient', () => ({
  createAppApiClient: () => ({
    lightingBakes: {
      readAvailability: async () => availability,
      readLatest: async () => ({ ok: true, data: null }),
    },
  }),
}));

const T = '2026-11-02T08:00:00.000Z';
const ID = 'bak_01JABCDEFGHJKMNPQRSTVWXYZ0';
const queued: LightingBake = { id: ID, status: 'queued', createdAt: T };
const done: LightingBake = { id: ID, status: 'done', createdAt: T, startedAt: T, endedAt: T };

const noop = () => undefined;
const view = (bake: LightingBake | null) =>
  render(<BakeLightingView bake={bake} busy={false} error={null} onHide={noop} onStart={noop} onView={noop} previewing={false} />);

describe('nướng ánh sáng', () => {
  it('câu trạng thái tiếng Việt cho mọi trạng thái', () => {
    expect(bakeStatusLabel(null)).toBeNull();
    expect(bakeStatusLabel(queued)).toBe('Đang chờ nướng…');
    expect(bakeStatusLabel({ ...queued, status: 'running', startedAt: T })).toBe('Đang nướng ánh sáng…');
    expect(bakeStatusLabel(done)).toBe('Đã nướng xong');
    expect(bakeStatusLabel({ ...done, status: 'failed', failureCode: 'LIGHTING_BAKE_TIMEOUT' })).toBe(
      'Nướng lỗi: quá thời gian cho phép',
    );
  });

  it('khoá nút nướng khi đang chờ; chỉ hiện nút xem khi đã xong', () => {
    const { unmount } = view(queued);
    expect(screen.getByRole('button', { name: 'Nướng lại' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Xem ánh sáng nướng' })).toBeNull();
    unmount();
    view(done);
    expect(screen.getByRole('button', { name: 'Nướng lại' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Xem ánh sáng nướng' })).toBeInTheDocument();
  });

  it('gửi GLB đã xuất; 409 LIGHTING_BAKE_IN_PROGRESS thì đọc lại lượt đang chạy', async () => {
    const glb = new Blob(['glb']);
    const start = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'http', status: 409, code: 'LIGHTING_BAKE_IN_PROGRESS', requestId: 'r', retryable: false, raw: null },
    });
    const readLatest = vi.fn().mockResolvedValueOnce({ ok: true, data: null }).mockResolvedValue({ ok: true, data: queued });
    const client = { lightingBakes: { start, readLatest, readFile: vi.fn() } } as unknown as ApiClient;
    const exportGlb = async () => glb;
    const loadClient = async () => client;
    const { result } = renderHook(() => useLightingBake('P-1', exportGlb, loadClient));
    await waitFor(() => expect(readLatest).toHaveBeenCalledTimes(1));
    result.current.start();
    await waitFor(() => expect(result.current.bake).toEqual(queued));
    expect(start).toHaveBeenCalledWith('P-1', glb);
    expect(result.current.error).toBeNull();
  });

  it('bấm nút gọi đúng hành động', () => {
    const onStart = vi.fn();
    render(<BakeLightingView bake={null} busy={false} error={null} onHide={noop} onStart={onStart} onView={noop} previewing={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nướng ánh sáng' }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});

describe('công tắc nướng ánh sáng (N49)', () => {
  const card = () => render(<BakeLightingCard exportGlb={async () => null} projectId="P-1" />);

  it('hiện khi API báo enabled=true', async () => {
    availability = { ok: true, data: { enabled: true } };
    card();
    expect(await screen.findByRole('button', { name: 'Nướng ánh sáng' })).toBeInTheDocument();
  });

  it.each([
    ['enabled=false', { ok: true, data: { enabled: false } }],
    ['API cũ (404)', { ok: false, error: { kind: 'http', status: 404 } }],
    ['thiếu cờ', { ok: true, data: {} }],
  ])('ẩn hẳn khi %s', async (_name, result) => {
    availability = result;
    const { container } = card();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
