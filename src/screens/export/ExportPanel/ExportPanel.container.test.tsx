/**
 * Lớp gộp W4: "chia sẻ" của `ExportPanel` có thật sự mở `ShareDialogContainer`
 * không, hay chỉ là một hợp đồng đứng yên (kiểm toán chín màn chưa ai gắn).
 *
 * `ExportPanel`/`ShareDialog` đều có bộ kiểm bảy trạng thái riêng đã xanh —
 * file này KHÔNG lặp lại chúng. Nó chỉ chứng minh đúng một việc: bấm nút
 * "chia sẻ" trong `ExportPanelContainer` dựng ra hộp thoại THẬT của
 * `ShareDialogContainer` (không phải một bản giả), và đóng lại được.
 *
 * `VITE_USE_MOCK_API=true` — cùng cặp `FurnitureLibraryPanel.test.tsx` dùng —
 * để lượt đọc danh sách thành viên của `ShareDialogContainer` trả lời từ
 * `createMockApiClient()` thay vì chạm mạng thật; `Modal.Header`/`Modal.Footer`
 * của hộp thoại vẫn dựng ngay cả khi lượt đọc liên kết chia sẻ (đi qua
 * `ShareLinkGateway` HTTP thật, không đọc cờ này) còn đang treo hay lỗi —
 * đúng điều `ShareDialog.tsx:10-15` ghi: sáu trong bảy trạng thái đều vẽ đủ
 * khung, container không khi nào trống.
 *
 * F-06: máy chủ v1 không phục vụ liên kết chia sẻ (BE-BIND #47–#49 là v2), nên bản
 * thật KHÔNG có nút "chia sẻ" và không gắn hộp thoại. Ba bài cũ giữ ý cho ngày v2
 * bật lại bằng cách lật `SHARE_LINKS_SUPPORTED` qua `shareLinkFlag`.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type * as ShareLinkModule from '@/lib/export/shareLink';
import type * as ShareDialogModule from '@/screens/export/ShareDialog';
import { createTestQueryClient, renderWithProviders } from '@/lib/testing/render';
import { useStore } from '@/store';

import { ExportPanelContainer } from './ExportPanel.container';
import { createExportPanelGateway } from './exportPanelGateway';
import { useExportPanel } from './useExportPanel';

const PROJECT_ID = 'P-000000001';

/** Giá trị `SHARE_LINKS_SUPPORTED` mà mã đọc trong tệp này; `null` = giữ bản thật. */
const shareLinkFlag = vi.hoisted(() => ({ value: null as boolean | null }));

/**
 * Số lần `ShareDialogContainer` THẬT được render. Bọc chứ không thay: ba bài cũ cần
 * hộp thoại thật; bài F-06 cần biết container có gắn hộp thoại hay không.
 */
const shareDialogRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/screens/export/ShareDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof ShareDialogModule>();
  return {
    ...actual,
    ShareDialogContainer: (props: ComponentProps<typeof actual.ShareDialogContainer>) => {
      shareDialogRenders.count += 1;
      return createElement(actual.ShareDialogContainer, props);
    },
  };
});

vi.mock('@/lib/export/shareLink', async (importOriginal) => {
  const actual = await importOriginal<typeof ShareLinkModule>();
  return {
    ...actual,
    get SHARE_LINKS_SUPPORTED(): boolean {
      return shareLinkFlag.value ?? actual.SHARE_LINKS_SUPPORTED;
    },
  };
});

/** Tầng + vai để `status` là `success` (có header, có nút "chia sẻ") — không `empty`/`forbidden`. */
function seedStore(): void {
  const graph = createSampleBuilding();
  const store = useStore.getState();

  store.setUserRoles(['engineer']);
  store.setFloors(graph.levels);
  store.setSpatial(normalizeSpatial(graph), 'v-test');
}

/** `keepStore`: `renderWithProviders` xoá store về mặc định trước mỗi lượt dựng, đè lên `seedStore()`. */
function renderExportPanel() {
  return renderWithProviders(
    <MemoryRouter>
      <ExportPanelContainer projectId={PROJECT_ID} />
    </MemoryRouter>,
    { keepStore: true },
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK_API', 'true');
  seedStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  shareLinkFlag.value = null;
  shareDialogRenders.count = 0;
});

describe('F-06 — cờ tắt: không nút "chia sẻ", không request tới share-links', () => {
  it('không nút "chia sẻ", không hộp thoại, không URL nào chứa /share-links', async () => {
    shareLinkFlag.value = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderExportPanel();

    expect(await screen.findByRole('button', { name: /^xuất/iu })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chia sẻ/iu })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shareDialogRenders.count).toBe(0);
    const urls = fetchSpy.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    expect(urls.filter((url) => url.includes('/share-links'))).toEqual([]);
  });
});

describe('ExportPanelContainer — nút "chia sẻ" mở ShareDialogContainer (R-73)', () => {
  beforeEach(() => {
    shareLinkFlag.value = true;
  });

  it('không có hộp thoại chia sẻ nào khi màn vừa mở', async () => {
    renderExportPanel();

    expect(await screen.findByRole('button', { name: /chia sẻ/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bấm "chia sẻ" dựng ra ĐÚNG hộp thoại của S-ShareDialog, không phải một trang khác', async () => {
    renderExportPanel();

    fireEvent.click(await screen.findByRole('button', { name: /chia sẻ/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // Tựa đề thật của `ShareDialog.tsx:37` — không phải một khung rỗng đứng thay chỗ.
    expect(screen.getByText('Chia sẻ dự án')).toBeInTheDocument();
  });

  it('đóng hộp thoại trả `ExportPanel` về không còn hộp thoại nào (A12: có đường đóng)', async () => {
    renderExportPanel();

    fireEvent.click(await screen.findByRole('button', { name: /chia sẻ/i }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Đóng hộp thoại' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('B-V12-05 — xuất xong thì tệp tải về máy, đúng lời màn đã hứa', () => {
  it('một lượt xuất thành công gọi `deliver` đúng một lần với chính tệp vừa xuất', async () => {
    const deliver = vi.fn();
    const gateway = createExportPanelGateway({ deliver });
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useExportPanel({ projectId: PROJECT_ID, gateway }), { wrapper });

    act(() => {
      result.current.onSelectFormat('spatial-json');
    });
    act(() => {
      result.current.onExport();
    });

    await waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1);
    });
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({ fileName: expect.stringMatching(/\.json$/u) });
  });
});

describe('[BUG-467] tuỳ chọn ảnh: nhãn nào cũng có giá trị', () => {
  it('chưa có tầng nào thì "Góc nhìn hiện tại" là "—", không để trống', () => {
    const gateway = createExportPanelGateway({ deliver: vi.fn() });
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    useStore.getState().setFloors([]); // không có tầng nào thì mới còn "—" (30-C-026)
    expect(useStore.getState().activeFloorId).toBeNull();
    const { result } = renderHook(() => useExportPanel({ projectId: PROJECT_ID, gateway }), { wrapper });

    expect(result.current.options.image.viewId).toBe('—');
  });
});
