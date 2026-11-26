import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DETECT_FURNITURE_SAVE_ERROR, useDetectFurniture } from './useDetectFurniture';
import type { SeparateUnitsApi } from './useSeparateUnitsFlag';

const settings = { buildingType: 'residential', confidenceThreshold: 0.75, defaultScaleMmPerPx: 1, lengthUnit: 'mm', snapToleranceMm: 50 };

/** Máy chủ giả có nhớ: lượt ghi thành công đổi điều lượt đọc sau trả về. */
function fakeApi(initial: Record<string, unknown>, replaceOk = true) {
  let stored = { ...initial, revision: 4 };
  const read = vi.fn(async () => ({ ok: true, data: { ...stored } }));
  const replace = vi.fn(async ({ body }: { body: Record<string, unknown> }) => {
    if (!replaceOk) return { ok: false, error: {} };
    stored = { ...body, revision: stored.revision + 1 };
    return { ok: true, data: { ...stored } };
  });
  return { api: { projectSettings: { read, replace } } as unknown as SeparateUnitsApi, read, replace };
}

function setup(api: SeparateUnitsApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useDetectFurniture('project-1', api), { wrapper });
}

describe('useDetectFurniture', () => {
  it('reads true when the project never saved the setting', async () => {
    const { api, read } = fakeApi(settings);
    const { result } = setup(api);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(result.current.detectFurniture).toBe(true);
  });

  it('saves the full body with detectFurniture on the latest revision', async () => {
    const { api, replace } = fakeApi({ ...settings, detectFurniture: false });
    const { result } = setup(api);
    act(() => result.current.setDetectFurniture(true));
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(replace).toHaveBeenCalledWith({
      projectId: 'project-1',
      baseVersion: 4,
      body: { ...settings, detectFurniture: true },
    });
    expect(result.current.detectFurniture).toBe(true);
    expect(result.current.saveError).toBeNull();
  });

  it('keeps the old value and says so when the save fails', async () => {
    const { api } = fakeApi(settings, false);
    const { result } = setup(api);
    act(() => result.current.setDetectFurniture(false));
    await waitFor(() => expect(result.current.saveError).toBe(DETECT_FURNITURE_SAVE_ERROR));
    expect(result.current.detectFurniture).toBe(true);
  });
});
