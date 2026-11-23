/**
 * K-06 — "Chạy lại từ bản gốc": cổng dữ liệu (câu cho từng mã lỗi của N51) và hook.
 *
 * Mã lỗi lấy từ `AppBack/apps/api/drawings/errors.py`: 409 `UPLOAD_NOT_COMPLETE`,
 * `UPLOAD_SOURCE_GONE`, `UPLOAD_SUPERSEDED`, `PIPELINE_RUNNING`, `PIPELINE_NOT_FAILED`.
 * Máy chủ KHÔNG trả 410 (W8 không có 410) — vẫn kiểm nhánh 410 vì cổng đọc nó như tệp gốc đã mất.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import type { HttpError } from '@/lib/http';
import { createTestQueryClient } from '@/lib/testing/render';

import {
  createMockPipelineFailureGateway,
  createPipelineFailureGateway,
  describeRerunFailure,
  PIPELINE_FAILURE_SAMPLE_FLOOR_ID,
  PIPELINE_FAILURE_SAMPLE_STEP_ID,
  type PipelineFailureGateway,
  type PipelineFailureRerunResult,
} from './pipelineFailureGateway';
import { PIPELINE_FAILURE_RERUN_ERROR_TEXT, PIPELINE_FAILURE_TEXT } from './pipelineFailureText';
import type { PipelineFailureNextStep, PipelineFailureProps } from './types';
import { usePipelineFailure, type UsePipelineFailureOptions } from './usePipelineFailure';

const PROJECT_ID = 'project-1';
const UPLOAD_ID = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1';

const httpError = (status: number, code?: string): HttpError => ({
  kind: 'http',
  status,
  ...(code === undefined ? {} : { code }),
  raw: code === undefined ? {} : { code },
  requestId: 'req-rerun',
  retryable: status === 429,
});

const PENDING = { id: UPLOAD_ID, progressPercent: 0, status: 'pending', step: 'Rerun' } as const;

/* -------------------------------------------------------------------------- */
/* Cổng thật: gọi máy khách, đổi lỗi thành câu.                                 */
/* -------------------------------------------------------------------------- */

describe('createPipelineFailureGateway — rerunUpload', () => {
  const clientWith = (rerun: ReturnType<typeof vi.fn>): ApiClient =>
    ({ drawings: { rerun } }) as unknown as ApiClient;

  it('thành công: gọi drawings.rerun đúng dự án + lượt tải, kèm khoá idempotency', async () => {
    const rerun = vi.fn().mockResolvedValue({ ok: true, data: PENDING });
    const gateway = createPipelineFailureGateway({ client: clientWith(rerun) });

    expect(gateway.supports.rerunUpload).toBe(true);
    await expect(gateway.rerunUpload({ projectId: PROJECT_ID, uploadId: UPLOAD_ID })).resolves.toEqual({ ok: true });
    expect(rerun).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String) as string,
      projectId: PROJECT_ID,
      uploadId: UPLOAD_ID,
    });
  });

  it('không có máy khách: không khai khả năng, và không giả vờ gọi', async () => {
    const gateway = createPipelineFailureGateway();

    expect(gateway.supports.rerunUpload).toBe(false);
    const result = await gateway.rerunUpload({ projectId: PROJECT_ID, uploadId: UPLOAD_ID });
    expect(result.ok).toBe(false);
  });

  it.each([
    [409, 'UPLOAD_NOT_COMPLETE', PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_NOT_COMPLETE],
    [409, 'UPLOAD_SOURCE_GONE', PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_SOURCE_GONE],
    [409, 'UPLOAD_SUPERSEDED', PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_SUPERSEDED],
    [409, 'PIPELINE_RUNNING', PIPELINE_FAILURE_RERUN_ERROR_TEXT.PIPELINE_RUNNING],
    [409, 'PIPELINE_NOT_FAILED', PIPELINE_FAILURE_RERUN_ERROR_TEXT.PIPELINE_NOT_FAILED],
    [410, undefined, PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_SOURCE_GONE],
    [404, 'NOT_FOUND', PIPELINE_FAILURE_RERUN_ERROR_TEXT.notFound],
    [403, 'FORBIDDEN', PIPELINE_FAILURE_RERUN_ERROR_TEXT.forbidden],
    [429, 'RATE_LIMITED', PIPELINE_FAILURE_RERUN_ERROR_TEXT.rateLimited],
    [500, 'INTERNAL', PIPELINE_FAILURE_RERUN_ERROR_TEXT.fallback],
  ])('lỗi %s %s → câu tiếng Việt cụ thể', async (status, code, sentence) => {
    const rerun = vi.fn().mockResolvedValue({ ok: false, error: httpError(status, code) });
    const gateway = createPipelineFailureGateway({ client: clientWith(rerun) });

    const result = await gateway.rerunUpload({ projectId: PROJECT_ID, uploadId: UPLOAD_ID });

    expect(result).toMatchObject({ ok: false, sentence });
  });

  it('chỉ PIPELINE_RUNNING mang isAlreadyRunning', () => {
    expect(describeRerunFailure(httpError(409, 'PIPELINE_RUNNING')).isAlreadyRunning).toBe(true);
    expect(describeRerunFailure(httpError(409, 'UPLOAD_SUPERSEDED')).isAlreadyRunning).toBe(false);
  });

  it('mọi câu lỗi đều chỉ đường tiếp, không nhắc "hỗ trợ" và không có chủ ngữ là người dùng', () => {
    for (const sentence of Object.values(PIPELINE_FAILURE_RERUN_ERROR_TEXT)) {
      expect(sentence).not.toMatch(/hỗ trợ/i);
      expect(sentence).not.toMatch(/\bBạn\b/);
      expect(sentence).toMatch(/[.]$/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Options = Omit<UsePipelineFailureOptions, 'projectId' | 'floorId' | 'stepId' | 'gateway'>;

async function mount(gateway: PipelineFailureGateway, options: Options = { uploadId: UPLOAD_ID }) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const rendered = renderHook(
    () =>
      usePipelineFailure({
        ...options,
        floorId: PIPELINE_FAILURE_SAMPLE_FLOOR_ID,
        gateway,
        projectId: PROJECT_ID,
        stepId: PIPELINE_FAILURE_SAMPLE_STEP_ID,
      }),
    { wrapper },
  );
  await waitFor(() => {
    expect(rendered.result.current.state).not.toBe('loading');
  });
  return rendered.result;
}

const stepsOf = (props: PipelineFailureProps): readonly PipelineFailureNextStep[] => {
  if (props.band.kind !== 'alert' || props.band.nextSteps === null) {
    throw new Error('Các hướng đi tiếp phải có mặt.');
  }
  return props.band.nextSteps;
};

const rerunGateway = (rerunResult?: PipelineFailureRerunResult) =>
  createMockPipelineFailureGateway({
    supports: { retryStep: false, rerunUpload: true },
    ...(rerunResult === undefined ? {} : { rerunResult }),
  });

describe('usePipelineFailure — chạy lại từ bản gốc (K-06)', () => {
  it('có lượt tải + cổng nối: "Chạy lại từ bản gốc" là nút chính, "Tải lại bản vẽ" là nút phụ', async () => {
    const result = await mount(rerunGateway());
    const steps = stepsOf(result.current);

    expect(steps.map((step) => step.id)).toEqual(['rerun-from-original', 'upload-clearer', 'skip-floor']);
    expect(steps.filter((step) => step.isPrimary).map((step) => step.id)).toEqual(['rerun-from-original']);
    expect(steps[0]?.label).toBe(PIPELINE_FAILURE_TEXT.rerunFromOriginalLabel);
    expect(steps[1]?.label).toBe(PIPELINE_FAILURE_TEXT.uploadAgainLabel);
  });

  it('thiếu mã lượt tải hoặc cổng chưa nối: không có nút "Chạy lại từ bản gốc"', async () => {
    const withoutUpload = await mount(rerunGateway(), {});
    expect(stepsOf(withoutUpload.current).map((step) => step.id)).not.toContain('rerun-from-original');

    const unwired = await mount(createMockPipelineFailureGateway({ supports: { retryStep: false } }));
    expect(stepsOf(unwired.current).map((step) => step.id)).not.toContain('rerun-from-original');
  });

  it('lỗi do tệp (reupload) hay lượt đã bị thay (reload): không đưa ra chạy lại từ bản gốc', async () => {
    for (const failureCode of ['FILE_CORRUPT', 'PIPELINE_SUPERSEDED']) {
      const result = await mount(rerunGateway(), { failureCode, uploadId: UPLOAD_ID });
      expect(stepsOf(result.current).map((step) => step.id)).not.toContain('rerun-from-original');
    }
  });

  it('thành công: gọi cổng đúng dự án + lượt tải rồi trả về màn Xử lý qua onResolved', async () => {
    const gateway = rerunGateway();
    const onResolved = vi.fn();
    const result = await mount(gateway, { onResolved, uploadId: UPLOAD_ID });

    act(() => {
      stepsOf(result.current)[0]?.onSelect();
    });

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    expect(gateway.rerunCalls).toEqual([{ projectId: PROJECT_ID, uploadId: UPLOAD_ID }]);
    expect(result.current.band.kind === 'alert' && result.current.band.rerunNotice).toBeFalsy();
  });

  it('thành công mà màn cha không nối onResolved: gỡ dải qua onDismiss', async () => {
    const onDismiss = vi.fn();
    const result = await mount(rerunGateway(), { onDismiss, uploadId: UPLOAD_ID });

    act(() => {
      stepsOf(result.current)[0]?.onSelect();
    });

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['UPLOAD_SUPERSEDED', PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_SUPERSEDED],
    ['UPLOAD_SOURCE_GONE', PIPELINE_FAILURE_RERUN_ERROR_TEXT.UPLOAD_SOURCE_GONE],
    ['rateLimited', PIPELINE_FAILURE_RERUN_ERROR_TEXT.rateLimited],
  ])('lỗi %s: hiện đúng câu, không rời màn, vẫn còn "Tải lại bản vẽ"', async (code, sentence) => {
    const gateway = rerunGateway({ ok: false, code, sentence, isAlreadyRunning: false });
    const onResolved = vi.fn();
    const result = await mount(gateway, { onResolved, uploadId: UPLOAD_ID });

    act(() => {
      stepsOf(result.current)[0]?.onSelect();
    });

    await waitFor(() => {
      expect(result.current.band.kind === 'alert' && result.current.band.rerunNotice).toBe(sentence);
    });
    expect(onResolved).not.toHaveBeenCalled();
    expect(stepsOf(result.current).map((step) => step.id)).toContain('upload-clearer');
    expect(stepsOf(result.current)[0]?.isBusy).toBe(false);
  });

  it('409 PIPELINE_RUNNING (bấm đôi): vẫn đưa về màn Xử lý để thấy lượt đang chạy', async () => {
    const gateway = rerunGateway({
      ok: false,
      code: 'PIPELINE_RUNNING',
      sentence: PIPELINE_FAILURE_RERUN_ERROR_TEXT.PIPELINE_RUNNING,
      isAlreadyRunning: true,
    });
    const onResolved = vi.fn();
    const result = await mount(gateway, { onResolved, uploadId: UPLOAD_ID });

    act(() => {
      stepsOf(result.current)[0]?.onSelect();
    });

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
  });

  it('chống bấm đôi: đang gọi thì nút bận và cú bấm thứ hai không gọi cổng lần nữa', async () => {
    let finish: (value: PipelineFailureRerunResult) => void = () => undefined;
    const pending = new Promise<PipelineFailureRerunResult>((resolve) => {
      finish = resolve;
    });
    const base = rerunGateway();
    const rerunUpload = vi.fn(() => pending);
    const result = await mount({ ...base, rerunUpload }, { onResolved: vi.fn(), uploadId: UPLOAD_ID });
    const rerun = stepsOf(result.current)[0];

    act(() => {
      rerun?.onSelect();
      rerun?.onSelect();
    });

    expect(rerunUpload).toHaveBeenCalledTimes(1);
    expect(stepsOf(result.current)[0]?.isBusy).toBe(true);

    await act(async () => {
      finish({ ok: true });
      await pending;
    });

    expect(stepsOf(result.current)[0]?.isBusy).toBe(false);
  });

  it('cổng ném lỗi lạ: vẫn ra một câu, nút hết bận', async () => {
    const base = rerunGateway();
    const result = await mount(
      { ...base, rerunUpload: () => Promise.reject(httpError(429, 'RATE_LIMITED')) },
      { uploadId: UPLOAD_ID },
    );

    act(() => {
      stepsOf(result.current)[0]?.onSelect();
    });

    await waitFor(() => {
      expect(result.current.band.kind === 'alert' && result.current.band.rerunNotice).toBe(
        PIPELINE_FAILURE_RERUN_ERROR_TEXT.rateLimited,
      );
    });
  });
});
