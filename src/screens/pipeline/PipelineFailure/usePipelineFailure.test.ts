/**
 * Nửa "suy nghĩ" của màn S-11 "Một bước AI hỏng", kiểm không cần DOM của màn.
 *
 * Hook được lái qua `renderHook`, và tầng dữ liệu là
 * `createMockPipelineFailureGateway()` của `pipelineFailureGateway.ts` — cùng bộ
 * mẫu story sẽ dùng, nên test không dựng một bảng dữ liệu thứ hai bịa tại chỗ
 * (R-70). Mọi con số khẳng định ở đây đều đọc ra từ bộ mẫu đó.
 *
 * ## Phép kiểm quan trọng nhất của cả file
 *
 * `chạy lại ĐÚNG một bước` — `retryStep` bấm ở bước hai phải làm bước hai chạy
 * lại và **không** làm bước một chạy lại. Nó được khẳng định bằng
 * `gateway.stepRunCounts`, tức bằng SỐ LẦN CỔNG DỮ LIỆU ĐƯỢC GỌI cho từng bước,
 * chứ không bằng một bình luận nói rằng chuyện đó đúng.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatNumber } from '@/lib/format/number';
import { AMBIENT_LOOP_MS, MOTION_DURATIONS_MS } from '@/lib/motion';
import { createTestQueryClient } from '@/lib/testing/render';
import { SEVEN_STATES } from '@/lib/testing/sevenStateScenarios';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import { ROUTES } from '@/routes/paths';

import {
  createMockPipelineFailureGateway,
  createPipelineFailureGateway,
  PIPELINE_FAILURE_MISSING_CAPABILITIES,
  PIPELINE_FAILURE_MISSING_ENDPOINTS,
  PIPELINE_FAILURE_SAMPLE_DETAIL,
  PIPELINE_FAILURE_SAMPLE_FLOOR_ID,
  PIPELINE_FAILURE_SAMPLE_LOG,
  PIPELINE_FAILURE_SAMPLE_STEP_ID,
  unsupported,
  type MockPipelineFailureGateway,
  type PipelineFailureGateway,
} from './pipelineFailureGateway';
import { PIPELINE_FAILURE_TEXT } from './pipelineFailureText';
import { usePipelineFailure, type UsePipelineFailureOptions } from './usePipelineFailure';
import type { PipelineFailureProps } from './types';

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — đọc ra, không viết tay lại.                                        */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 'project-1';
const FLOOR_ID = PIPELINE_FAILURE_SAMPLE_FLOOR_ID;
const FAILED_STEP_ID = PIPELINE_FAILURE_SAMPLE_STEP_ID;
const FIRST_STEP_ID = 'preprocess';

/** Nhãn tiếng Việt của một bước, tra đúng một nguồn với hook (R-61). */
const labelOf = (stepId: string): string =>
  getPipelineStages().find((stage) => stage.id === stepId)?.label ?? stepId;

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

/* jsdom không có `matchMedia`; `matches: false` là "không giảm chuyển động". */
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Dựng hook.                                                                  */
/* -------------------------------------------------------------------------- */

type MountOptions = Omit<UsePipelineFailureOptions, 'projectId' | 'floorId' | 'stepId' | 'gateway'> &
  Partial<Pick<UsePipelineFailureOptions, 'projectId' | 'floorId' | 'stepId'>>;

interface Mounted {
  readonly result: { current: PipelineFailureProps };
  readonly unmount: () => void;
}

function mountHook(gateway: PipelineFailureGateway, options: MountOptions = {}): Mounted {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      usePipelineFailure({
        ...options,
        projectId: options.projectId ?? PROJECT_ID,
        floorId: options.floorId ?? FLOOR_ID,
        stepId: options.stepId ?? FAILED_STEP_ID,
        gateway,
      }),
    { wrapper },
  );

  return { result: rendered.result, unmount: rendered.unmount };
}

/** Chờ lượt đọc mồi xong — trước đó `state` là `'loading'` cho mọi kịch bản. */
async function mountSettled(
  gateway: PipelineFailureGateway,
  options: MountOptions = {},
): Promise<Mounted> {
  const mounted = mountHook(gateway, options);
  await waitFor(() => {
    expect(mounted.result.current.state).not.toBe('loading');
  });
  return mounted;
}

/* -------------------------------------------------------------------------- */
/* Cổng dữ liệu — bản kê nợ.                                                   */
/* -------------------------------------------------------------------------- */

describe('pipelineFailureGateway', () => {
  it('bản thật trả nhánh supported:false CÓ KIỂU cho cả bốn khả năng chưa có endpoint', async () => {
    const gateway = createPipelineFailureGateway();

    expect(gateway.supports).toEqual({
      retryStep: false,
      stepFailureDetail: false,
      technicalLog: false,
      // Bật thì phải có hoãn A8 trước — B-V4-09.
      skipFloor: false,
      copyLog: true,
      reportFailure: true,
    });

    const results = await Promise.all([
      gateway.readStepFailure({ floorId: FLOOR_ID, projectId: PROJECT_ID, stepId: FAILED_STEP_ID }),
      gateway.readTechnicalLog({ floorId: FLOOR_ID, projectId: PROJECT_ID, stepId: FAILED_STEP_ID }),
      gateway.retryStep({ floorId: FLOOR_ID, projectId: PROJECT_ID, stepId: FAILED_STEP_ID }),
      gateway.skipFloor({ floorId: FLOOR_ID, projectId: PROJECT_ID }),
    ]);

    expect(results.map((result) => result.supported)).toEqual([false, false, false, false]);
  });

  it('mỗi khả năng còn thiếu có đúng một dòng nói ra endpoint còn thiếu', () => {
    for (const capability of PIPELINE_FAILURE_MISSING_CAPABILITIES) {
      const result = unsupported(capability);

      expect(result.capability).toBe(capability);
      expect(result.missing).toBe(PIPELINE_FAILURE_MISSING_ENDPOINTS[capability]);
      expect(result.missing.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Chạy lại ĐÚNG một bước — điều kiện nghiệm thu trung tâm.                    */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — chạy lại đúng một bước', () => {
  it('thử lại bước 2 thì bước 1 KHÔNG chạy lại, đếm bằng số lần gọi cổng dữ liệu', async () => {
    const gateway = createMockPipelineFailureGateway();
    const mounted = await mountSettled(gateway);

    // Chưa bấm gì: chưa bước nào được yêu cầu chạy lại.
    expect(gateway.stepRunCounts.size).toBe(0);

    const band = mounted.result.current.band;
    expect(band.kind).toBe('alert');

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert trước khi thử lại.');
    }

    // Nút mang đúng mã bước đã hỏng — không phải mã của cả lượt xử lý.
    expect(band.retryAction.stepId).toBe(FAILED_STEP_ID);

    await act(async () => {
      band.retryAction.onRetry();
    });

    await waitFor(() => {
      expect(gateway.stepRunCounts.get(FAILED_STEP_ID)).toBe(1);
    });

    // ĐÂY là lời hứa của màn, khẳng định bằng bộ đếm chứ không bằng bình luận:
    // bước một chưa từng được yêu cầu chạy lại, và không bước nào khác cũng vậy.
    expect(gateway.stepRunCounts.get(FIRST_STEP_ID)).toBeUndefined();
    expect([...gateway.stepRunCounts.keys()]).toEqual([FAILED_STEP_ID]);
    expect([...gateway.stepRunCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('sau lượt chạy lại, bước 1 vẫn ở trạng thái đã xong — tiến độ cũ không bị xoá', async () => {
    const gateway = createMockPipelineFailureGateway();
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert trước khi thử lại.');
    }

    await act(async () => {
      band.retryAction.onRetry();
    });

    await waitFor(() => {
      expect(mounted.result.current.state).toBe('success');
    });

    // Khối "Kết quả đã có" vẫn đứng nguyên: nó nằm NGOÀI band nên lượt chạy lại
    // không cuốn nó đi.
    expect(mounted.result.current.keptWork.kind).toBe('list');
  });

  it('lượt chạy lại đang chạy thì dải đổi TẠI CHỖ sang stepper, không đổi trang', async () => {
    let release: (() => void) | undefined;
    const base = createMockPipelineFailureGateway();
    const gateway: MockPipelineFailureGateway = {
      ...base,
      retryStep: (input) =>
        new Promise((resolve) => {
          release = () => {
            resolve(base.retryStep(input));
          };
        }),
    };

    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert trước khi thử lại.');
    }

    act(() => {
      band.retryAction.onRetry();
    });

    await waitFor(() => {
      expect(mounted.result.current.state).toBe('loading');
    });

    const retrying = mounted.result.current.band;
    expect(retrying.kind).toBe('retrying');

    if (retrying.kind !== 'retrying') {
      throw new Error('Dải phải là retrying khi lượt chạy lại đang chạy.');
    }

    expect(retrying.steps).toHaveLength(PIPELINE_FAILURE_SAMPLE_DETAIL.steps.length);
    expect(retrying.steps.find((step) => step.id === FAILED_STEP_ID)?.status).toBe('running');
    // Bước một vẫn "xong" ngay trong lúc bước hai chạy lại.
    expect(retrying.steps.find((step) => step.id === FIRST_STEP_ID)?.status).toBe('done');
    expect(retrying.liveMessage).toContain(labelOf(FAILED_STEP_ID));

    await act(async () => {
      release?.();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11).                                                       */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — bảy trạng thái', () => {
  it('trạng thái chính là partial, và không nhánh nào để màn trắng', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());

    expect(mounted.result.current.state).toBe('partial');
    expect(SEVEN_STATES).toContain(mounted.result.current.state);
    expect(mounted.result.current.band.kind).toBe('alert');
    expect(mounted.result.current.floors).toHaveLength(4);
    expect(mounted.result.current.collapsedSummaryLine.length).toBeGreaterThan(0);
  });

  it('người không có quyền: nextSteps và technicalDetails cùng biến mất', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway(), { roles: ['viewer'] });

    expect(mounted.result.current.state).toBe('forbidden');
    expect(mounted.result.current.technicalDetails).toBeNull();

    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('forbidden vẫn dựng dải alert, chỉ ẩn ba hướng đi tiếp.');
    }

    expect(band.nextSteps).toBeNull();
    // Vẫn còn câu tóm tắt: màn trắng là thất bại duy nhất A11 tồn tại để chặn.
    expect(band.reason.summarySentence.length).toBeGreaterThan(0);
  });

  it('không bước nào hỏng: band idle, không phải màn trắng', async () => {
    const gateway = createMockPipelineFailureGateway({
      detail: {
        ...PIPELINE_FAILURE_SAMPLE_DETAIL,
        steps: PIPELINE_FAILURE_SAMPLE_DETAIL.steps.map((step) => ({
          stepId: step.stepId,
          status: 'done' as const,
        })),
      },
    });

    const mounted = await mountSettled(gateway);

    expect(mounted.result.current.state).toBe('empty');
    expect(mounted.result.current.band).toEqual({
      kind: 'idle',
      messageSentence: PIPELINE_FAILURE_TEXT.idleMessage,
    });
  });

  it('cả bốn tầng hỏng: state error, khối kết quả rút thành một dòng, hành động chính đổi sang tải lại ảnh', async () => {
    const gateway = createMockPipelineFailureGateway({
      detail: {
        ...PIPELINE_FAILURE_SAMPLE_DETAIL,
        floors: PIPELINE_FAILURE_SAMPLE_DETAIL.floors.map((floor) => ({
          ...floor,
          status: 'failed' as const,
        })),
      },
    });

    const mounted = await mountSettled(gateway);

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.keptWork).toEqual({
      kind: 'line',
      line: PIPELINE_FAILURE_TEXT.keptWorkLine,
    });

    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('error vẫn còn ba hướng đi tiếp.');
    }

    const primary = band.nextSteps.filter((step) => step.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.id).toBe('upload-clearer');
  });

  it('thu gọn: còn câu tóm tắt và nhãn mở lại', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());

    expect(mounted.result.current.collapseToggleLabel).toBe(PIPELINE_FAILURE_TEXT.collapseLabel);

    act(() => {
      mounted.result.current.onToggleCollapse();
    });

    expect(mounted.result.current.state).toBe('collapsed');
    expect(mounted.result.current.collapseToggleLabel).toBe(PIPELINE_FAILURE_TEXT.expandLabel);
    expect(mounted.result.current.collapsedSummaryLine).toContain(labelOf(FAILED_STEP_ID));
  });

  it('chạy lại xong: band resolved, và nút đi tiếp gọi onResolved của màn cha', async () => {
    const onResolved = vi.fn();
    const mounted = await mountSettled(createMockPipelineFailureGateway(), { onResolved });
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert trước khi thử lại.');
    }

    await act(async () => {
      band.retryAction.onRetry();
    });

    await waitFor(() => {
      expect(mounted.result.current.state).toBe('success');
    });

    const resolved = mounted.result.current.band;

    if (resolved.kind !== 'resolved') {
      throw new Error('Chạy lại xong thì dải hoà tan thành toast.');
    }

    act(() => {
      resolved.onContinue();
    });

    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Ba câu lỗi, mã lỗi, mã yêu cầu (L-03).                                      */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — khối lỗi', () => {
  it('mã lỗi và mã yêu cầu đọc ra từ AppError, không gõ tay', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(band.reason.codeLabel).toBe('SEG-2041 · yêu cầu 8f2a-41');
    expect(band.reason.summarySentence).toBe(
      `Bước ${labelOf(FAILED_STEP_ID)} ở Tầng 03 không hoàn tất được.`,
    );
    expect(band.reason.causeSentence.length).toBeGreaterThan(0);
  });

  it('không câu lỗi nào lấy người dùng làm chủ ngữ', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    const sentences = [
      band.reason.summarySentence,
      band.reason.causeSentence,
      PIPELINE_FAILURE_TEXT.supportAfterAttempts,
      PIPELINE_FAILURE_TEXT.supportRetryUnsupported,
    ];

    for (const sentence of sentences) {
      // Không câu nào MỞ ĐẦU bằng "Bạn" — chủ ngữ là bước xử lý, bản vẽ, mô hình
      // hoặc hệ thống. Đây là điều kiện nghiệm thu cứng, nên nó là một phép kiểm.
      expect(sentence.startsWith('Bạn')).toBe(false);
      expect(sentence).not.toContain('bạn đã');
      expect(sentence).not.toContain('lỗi của bạn');
    }
  });

  it('mã lỗi luôn có mặt, kể cả khi lượt đọc chi tiết chưa có endpoint', async () => {
    const gateway = createMockPipelineFailureGateway({ supports: { stepFailureDetail: false } });
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(band.reason.summarySentence).toContain('Chưa đọc được chi tiết bước hỏng');
    expect(band.reason.causeSentence).toBe(PIPELINE_FAILURE_TEXT.detailUnsupportedCause);
    expect(band.reason.codeLabel.length).toBeGreaterThan(0);
    // Vẫn còn ít nhất hai đường đi tiếp.
    expect(band.nextSteps?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('usePipelineFailure — mã máy chủ (F-05b)', () => {
  const alertBand = (mounted: Mounted) => {
    const band = mounted.result.current.band;
    if (band.kind !== 'alert') throw new Error('Dải phải là alert.');
    return band;
  };
  const noDetail = () => createMockPipelineFailureGateway({ supports: { stepFailureDetail: false } });
  const primaryIds = (mounted: Mounted) =>
    (alertBand(mounted).nextSteps ?? []).filter((step) => step.isPrimary).map((step) => step.id);

  it('không có failureCode: giữ hành vi cũ', async () => {
    const mounted = await mountSettled(noDetail());
    expect(alertBand(mounted).reason.causeSentence).toBe(PIPELINE_FAILURE_TEXT.detailUnsupportedCause);
    expect(primaryIds(mounted)).toEqual(['retry-lower-threshold']);
  });

  it('có failureCode: câu theo bảng, mã thật, tên tầng N7', async () => {
    const mounted = await mountSettled(noDetail(), {
      failureCode: 'PIPELINE_STEP_TIMEOUT',
      failureFloorName: 'Tầng 3',
    });
    const { reason } = alertBand(mounted);
    expect(reason.summarySentence).toBe(`Bước ${labelOf(FAILED_STEP_ID)} ở Tầng 3 không hoàn tất được.`);
    expect(reason.causeSentence).toBe('Bước xử lý chạy quá thời gian cho phép.');
    expect(reason.codeLabel).toBe('PIPELINE_STEP_TIMEOUT');
    expect(reason.codeLabel).not.toContain('UNKNOWN');
  });

  it('reupload: bước tải lên là chính', async () => {
    const mounted = await mountSettled(noDetail(), { failureCode: 'FILE_CORRUPT' });
    expect(primaryIds(mounted)).toEqual(['upload-clearer']);
  });

  it('reupload: lỗi của tệp không đếm lần thử, không mời hỗ trợ (U48)', async () => {
    const mounted = await mountSettled(noDetail(), { failureCode: 'NOT_A_FLOOR_PLAN' });
    expect(alertBand(mounted).retryNotice.kind).toBe('none');
  });

  it('retry: bước tải lên là chính, nhãn chạy lượt mới', async () => {
    const mounted = await mountSettled(noDetail(), { failureCode: 'WORKER_LOST' });
    expect(primaryIds(mounted)).toEqual(['upload-clearer']);
    expect(alertBand(mounted).nextSteps?.find((step) => step.id === 'upload-clearer')?.label).toBe(
      'Tải lại bản vẽ để chạy lượt mới',
    );
  });

  it.each(['INTERNAL', 'FOO_BAR'])('contactAdmin / mã lạ (%s): không bước nào chính', async (code) => {
    const mounted = await mountSettled(noDetail(), { failureCode: code });
    expect(primaryIds(mounted)).toEqual([]);
    expect(alertBand(mounted).reason.codeLabel).toBe(code);
  });
});

/* -------------------------------------------------------------------------- */
/* Bộ đếm lần thử (R-71).                                                      */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — bộ đếm lần thử', () => {
  it('dưới ngưỡng: chế độ đếm, nhãn đã ghép sẵn', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());
    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(band.retryNotice.kind).toBe('attempt');
    expect(band.retryNotice.kind === 'attempt' && band.retryNotice.attemptLabel).toBe(
      `Lần thử ${formatNumber(PIPELINE_FAILURE_SAMPLE_DETAIL.attemptCount, { fractionDigits: 0 })}`,
    );
  });

  it('từ ngưỡng trở lên: chế độ hỗ trợ, kèm chép toàn bộ nhật ký và liên kết điền sẵn mã', async () => {
    const gateway = createMockPipelineFailureGateway({
      detail: { ...PIPELINE_FAILURE_SAMPLE_DETAIL, attemptCount: 3 },
    });
    const onNavigate = vi.fn();
    const mounted = await mountSettled(gateway, { onNavigate });
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.retryNotice.kind !== 'support') {
      throw new Error('Từ lần thử thứ ba, bộ đếm đổi sang chế độ hỗ trợ.');
    }

    band.retryNotice.uploadLink.onOpen();
    expect(onNavigate).toHaveBeenCalledWith(ROUTES.project.upload(PROJECT_ID));

    expect(band.retryNotice.suggestionSentence).toBe(PIPELINE_FAILURE_TEXT.supportAfterAttempts);
    expect(band.retryNotice.uploadLink.label).toBe('Tải lại bản vẽ');
    expect(`${PIPELINE_FAILURE_TEXT.supportAfterAttempts}${PIPELINE_FAILURE_TEXT.supportRetryUnsupported}`).not.toMatch(
      /hỗ trợ|Báo lỗi/,
    );
    expect(band.retryNotice.copyAllLogs.label).toBe(PIPELINE_FAILURE_TEXT.copyLabel);
  });

  it('retryStep chưa có endpoint: chế độ hỗ trợ ngay, và câu nói ra sự thật đó', async () => {
    const gateway = createMockPipelineFailureGateway({ supports: { retryStep: false } });
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.retryNotice.kind !== 'support') {
      throw new Error('Khả năng chưa có phải có một nhánh giao diện thật.');
    }

    expect(band.retryNotice.suggestionSentence).toBe(PIPELINE_FAILURE_TEXT.supportRetryUnsupported);

    // Bấm thử lại vẫn ghi lại một sự kiện lỗi (O-01) chứ không im lặng.
    await act(async () => {
      band.retryAction.onRetry();
    });

    await waitFor(() => {
      expect(gateway.reportedFailures.length).toBeGreaterThanOrEqual(2);
    });

    expect(gateway.stepRunCounts.size).toBe(0);
  });

  it('mỗi lượt chạy lại thành công cộng đúng một vào bộ đếm', async () => {
    const gateway = createMockPipelineFailureGateway({ retryStatus: 'failed' });
    const mounted = await mountSettled(gateway);
    const first = mounted.result.current.band;

    if (first.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    await act(async () => {
      first.retryAction.onRetry();
    });

    await waitFor(() => {
      const band = mounted.result.current.band;
      expect(band.kind === 'alert' && band.retryNotice.kind === 'attempt' && band.retryNotice.attemptLabel).toBe(
        `Lần thử ${formatNumber(PIPELINE_FAILURE_SAMPLE_DETAIL.attemptCount + 1, { fractionDigits: 0 })}`,
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Nút sao chép — hook giữ đồng hồ, view không đếm.                            */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — sao chép', () => {
  it('nhãn đổi thành "Đã sao chép" rồi tự trở về sau đúng 700 ms', async () => {
    const gateway = createMockPipelineFailureGateway();
    const mounted = await mountSettled(gateway);
    vi.useFakeTimers();

    const band = mounted.result.current.band;

    if (band.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(band.reason.copyCode.label).toBe(PIPELINE_FAILURE_TEXT.copyLabel);
    expect(band.reason.copyCode.isCopied).toBe(false);

    act(() => {
      band.reason.copyCode.onCopy();
    });

    const copied = mounted.result.current.band;

    if (copied.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(copied.reason.copyCode.label).toBe(PIPELINE_FAILURE_TEXT.copiedLabel);
    expect(copied.reason.copyCode.isCopied).toBe(true);
    expect(gateway.copiedTexts).toEqual(['SEG-2041 · yêu cầu 8f2a-41']);

    // 700 ms là giá trị thứ NĂM mục B cho phép — `AMBIENT_LOOP_MS` của
    // `src/lib/motion/tokens.ts`, cùng con số `COPY_FLASH_MS` của `useShareLinks.ts`.
    expect(AMBIENT_LOOP_MS).toBe(700);

    act(() => {
      vi.advanceTimersByTime(700);
    });

    const settled = mounted.result.current.band;

    if (settled.kind !== 'alert') {
      throw new Error('Dải phải là alert.');
    }

    expect(settled.reason.copyCode.label).toBe(PIPELINE_FAILURE_TEXT.copyLabel);
    expect(settled.reason.copyCode.isCopied).toBe(false);
  });

  it('chép nhật ký lấy đúng những dòng đang hiện, chép toàn bộ thì có thêm mã lỗi', async () => {
    const gateway = createMockPipelineFailureGateway({
      detail: { ...PIPELINE_FAILURE_SAMPLE_DETAIL, attemptCount: 3 },
    });
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;
    const technical = mounted.result.current.technicalDetails;

    if (band.kind !== 'alert' || band.retryNotice.kind !== 'support' || technical === null) {
      throw new Error('Chế độ hỗ trợ phải có cả hai nút chép.');
    }

    act(() => {
      technical.copyLog.onCopy();
    });

    act(() => {
      band.retryNotice.kind === 'support' && band.retryNotice.copyAllLogs.onCopy();
    });

    expect(gateway.copiedTexts).toHaveLength(2);
    const [logText, allText] = gateway.copiedTexts;
    expect(logText).toContain(PIPELINE_FAILURE_SAMPLE_LOG[0]?.text);
    expect(logText).not.toContain('SEG-2041 · yêu cầu');
    expect(allText).toContain('SEG-2041 · yêu cầu 8f2a-41');
  });
});

/* -------------------------------------------------------------------------- */
/* Nhật ký kỹ thuật và ba hướng đi tiếp.                                       */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — khối gấp và ba hướng đi tiếp', () => {
  it('khối gấp đóng mặc định và mở được', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());
    const technical = mounted.result.current.technicalDetails;

    if (technical === null) {
      throw new Error('Khối gấp chỉ biến mất ở forbidden.');
    }

    expect(technical.isOpen).toBe(false);
    expect(technical.logLines).toHaveLength(PIPELINE_FAILURE_SAMPLE_LOG.length);

    act(() => {
      technical.onToggle();
    });

    expect(mounted.result.current.technicalDetails?.isOpen).toBe(true);
  });

  it('technicalLog chưa có endpoint: khối gấp còn nguyên và nói ra sự thật đó', async () => {
    const gateway = createMockPipelineFailureGateway({ supports: { technicalLog: false } });
    const mounted = await mountSettled(gateway);
    const technical = mounted.result.current.technicalDetails;

    if (technical === null) {
      throw new Error('Khối gấp chỉ biến mất ở forbidden.');
    }

    expect(technical.logLines).toHaveLength(1);
    expect(technical.logLines[0]?.text).toBe(PIPELINE_FAILURE_TEXT.logUnsupportedLine);
  });

  it('"Bỏ qua tầng đó" luôn mang câu cảnh báo mất mát (A8/A9)', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('Ba hướng đi tiếp phải có mặt.');
    }

    const skip = band.nextSteps.find((step) => step.id === 'skip-floor');
    expect(skip?.warningSentence).toBe(PIPELINE_FAILURE_TEXT.skipFloorWarning);
    expect(band.nextSteps.map((step) => step.id)).toEqual([
      'retry-lower-threshold',
      'upload-clearer',
      'skip-floor',
    ]);
  });

  it('skipFloor chưa có endpoint: không có nút "Bỏ qua tầng đó" (bản Z, không nút chết), vẫn ≥ 2 lối ra', async () => {
    const gateway = createMockPipelineFailureGateway({ supports: { skipFloor: false } });
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('Ba hướng đi tiếp phải có mặt.');
    }

    expect(band.nextSteps.find((step) => step.id === 'skip-floor')).toBeUndefined();
    expect(band.nextSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('retryStep chưa có endpoint: không có "Thử lại với ngưỡng thấp hơn", tải lại bản vẽ là nút chính (FIX-P0-13)', async () => {
    const gateway = createMockPipelineFailureGateway({ supports: { retryStep: false } });
    const mounted = await mountSettled(gateway);
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('Các hướng đi tiếp phải có mặt.');
    }

    expect(band.nextSteps.map((step) => step.id)).toEqual(['upload-clearer', 'skip-floor']);
    expect(band.nextSteps.filter((step) => step.isPrimary).map((step) => step.id)).toEqual(['upload-clearer']);
  });

  it('retryStep có endpoint: "Thử lại với ngưỡng thấp hơn" có mặt (FIX-P0-13)', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway({ supports: { retryStep: true } }));
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('Các hướng đi tiếp phải có mặt.');
    }

    expect(band.nextSteps.map((step) => step.id)).toContain('retry-lower-threshold');
  });

  it('"Tải lên bản vẽ rõ hơn" đẩy đường dẫn dựng từ bảng đường dẫn, không phải chuỗi viết tay', async () => {
    const onNavigate = vi.fn();
    const mounted = await mountSettled(createMockPipelineFailureGateway(), { onNavigate });
    const band = mounted.result.current.band;

    if (band.kind !== 'alert' || band.nextSteps === null) {
      throw new Error('Ba hướng đi tiếp phải có mặt.');
    }

    act(() => {
      band.nextSteps?.find((step) => step.id === 'upload-clearer')?.onSelect();
    });

    expect(onNavigate).toHaveBeenCalledWith(ROUTES.project.upload(PROJECT_ID));
  });
});

/* -------------------------------------------------------------------------- */
/* O-01 và chuyển động.                                                        */
/* -------------------------------------------------------------------------- */

describe('usePipelineFailure — O-01 và chuyển động', () => {
  it('ghi sự kiện lỗi đúng một lần cho một bước hỏng', async () => {
    const gateway = createMockPipelineFailureGateway();
    const mounted = await mountSettled(gateway);

    act(() => {
      mounted.result.current.onToggleCollapse();
    });

    expect(gateway.reportedFailures).toHaveLength(1);
    expect(gateway.reportedFailures[0]).toEqual({
      error: PIPELINE_FAILURE_SAMPLE_DETAIL.error,
      floorId: FLOOR_ID,
      stepId: FAILED_STEP_ID,
    });
  });

  it('thời lượng khai bằng token, không bằng con số', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway());

    expect(mounted.result.current.motionDurationName).toBe('standard');
    expect(MOTION_DURATIONS_MS[mounted.result.current.motionDurationName]).toBe(260);
    expect(mounted.result.current.prefersReducedMotion).toBe(false);
  });
});

describe('usePipelineFailure — QA-03e (SCR-12)', () => {
  it('BUG-544: người xem bấm "Thu gọn": thân thu gọn và nhãn đổi cùng lúc', async () => {
    const mounted = await mountSettled(createMockPipelineFailureGateway(), { roles: ['viewer'] });
    expect(mounted.result.current.state).toBe('forbidden');

    act(() => {
      mounted.result.current.onToggleCollapse();
    });

    expect(mounted.result.current.state).toBe('collapsed');
    expect(mounted.result.current.collapseToggleLabel).toBe(PIPELINE_FAILURE_TEXT.expandLabel);

    act(() => {
      mounted.result.current.onToggleCollapse();
    });
    // Mở lại: vẫn là người xem — nút và nhật ký vẫn ẩn.
    expect(mounted.result.current.state).toBe('forbidden');
    expect(mounted.result.current.technicalDetails).toBeNull();
  });

  it('BUG-545: chưa đọc được chi tiết (bản thật): dải tầng lấy từ các tầng màn Xử lý đã đọc', async () => {
    const failureFloors = [
      { floorId: 'L1', floorName: 'Tầng 1', status: 'done' as const },
      { floorId: FLOOR_ID, floorName: 'Tầng 2', status: 'failed' as const },
    ];
    const mounted = await mountSettled(createPipelineFailureGateway(), { failureFloors });

    expect(mounted.result.current.floors.map((floor) => [floor.label, floor.statusLabel, floor.isFailedFloor])).toEqual([
      ['Tầng 1', 'đã xong', false],
      ['Tầng 2', 'hỏng', true],
    ]);
    expect(mounted.result.current.state).not.toBe('error');
  });

  it('BUG-546: cấp "Dự án" của breadcrumb về danh sách dự án', async () => {
    const onNavigate = vi.fn();
    const mounted = await mountSettled(createMockPipelineFailureGateway(), { onNavigate });

    mounted.result.current.onBackToProjects?.();
    expect(onNavigate).toHaveBeenCalledWith(ROUTES.dashboard);
  });
});
