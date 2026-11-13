/**
 * Bài kiểm của cổng thật `MeasurementTool`: đọc #16 qua schema, ghim #17 thử lại
 * đúng một lần khi 409 đổi mã, và nhớ mã đã xoá trong phiên.
 *
 * Thân phản hồi dựng bằng dữ liệu DÂY (literal) và được schema kiểm một lần —
 * không dùng đầu ra sau transform làm thân. `save` giả ném `toAppError(httpError)`
 * giống `mutateAsync` thật (`createOptimisticMutation`).
 */

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorBodySchema } from '@/api/schemas/errors';
import { MeasurementRecordSchema } from '@/api/schemas/measurements';
import { millimetres } from '@/domain/units/types';
import { toAppError } from '@/lib/errors/toAppError';
import type { HttpClient, HttpError, Result } from '@/lib/http';
import { createUndoTicket } from '@/lib/mutations/undoTicket';
import { measurementKeys } from '@/lib/query/queryKeys';
import type { MeasurementRecord } from '@/types/measurement';

import {
  createMeasurementToolGateway,
  formatMeasurementRow,
  measurementErrorCodeOf,
  toMeasurementRowCore,
} from './measurementToolGateway';

const PROJECT = 'P-1';

/** Bản ghi dây hợp lệ; schema kiểm một lần để thân giả không lệch hợp đồng. */
function wireRecord(id: string): Record<string, unknown> {
  const body = {
    id,
    mode: 'pointToPoint',
    name: `Phép đo ${id}`,
    points: [
      { x: 0, y: 0 },
      { x: 3450, y: 0 },
    ],
    rawValueMm: 3450,
  };

  expect(() => MeasurementRecordSchema.parse(body)).not.toThrow();

  return body;
}

function httpError(status: number, code: string, resource?: string): HttpError {
  const body = { code, requestId: 'req-1', ...(resource !== undefined ? { resource } : {}) };

  expect(() => ApiErrorBodySchema.parse(body)).not.toThrow();

  return { kind: 'http', status, code, requestId: 'req-1', retryable: false, raw: body };
}

const idTaken = (): Error => toAppErrorThrown(httpError(409, 'MEASUREMENT_ID_TAKEN'));

/** `toAppError` trả một giá trị, nhưng `mutateAsync` ném nó — bọc lại cho `mockRejectedValue`. */
function toAppErrorThrown(error: HttpError): Error {
  return Object.assign(new Error('app error'), toAppError(error));
}

function httpWithLists(...lists: readonly unknown[]): { readonly http: HttpClient; readonly get: ReturnType<typeof vi.fn> } {
  const get = vi.fn();
  lists.forEach((list) => get.mockResolvedValueOnce({ ok: true, data: list }));

  const unused = (): Promise<Result<never, HttpError>> => Promise.reject(new Error('không dùng'));

  return {
    get,
    http: {
      delete: unused,
      events: { emit: () => undefined, on: () => () => undefined },
      get: <T>(path: string): Promise<Result<T, HttpError>> => get(path),
      getRecentRequests: () => [],
      patch: unused,
      post: unused,
      put: unused,
    },
  };
}

function pinned(id: `MS-${string}`) {
  const record = MeasurementRecordSchema.parse(wireRecord(id));

  return formatMeasurementRow(
    toMeasurementRowCore({
      id,
      mode: record.mode,
      name: record.name,
      points: [],
      rawValueMm: millimetres(record.rawValueMm),
    }),
    'm',
  );
}

function build(http: HttpClient, save: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient();
  const gateway = createMeasurementToolGateway({
    http,
    queryClient,
    save: (variables) => save(variables),
    remove: () => Promise.resolve(createUndoTicket({ description: 'x', undo: () => undefined })),
  });

  return { gateway, queryClient };
}

describe('measurementToolGateway — ghim gặp 409 đổi mã', () => {
  it('đọc lại danh sách một lần rồi ghim lần hai bằng mã lớn nhất + 1', async () => {
    const { http, get } = httpWithLists([wireRecord('MS-0001'), wireRecord('MS-0002'), wireRecord('MS-0003')]);
    const save = vi.fn().mockRejectedValueOnce(idTaken()).mockResolvedValueOnce(undefined);
    const { gateway, queryClient } = build(http, save);

    const saved = await gateway.saveMeasurement(PROJECT, pinned('MS-0002'));

    expect(get).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].measurement.id).toBe('MS-0004');
    expect(saved.id).toBe('MS-0004');
    expect(saved.name).toBe('Phép đo 4');
    expect(queryClient.getQueryData<readonly MeasurementRecord[]>(measurementKeys.all(PROJECT))).toHaveLength(3);
  });

  it('409 hai lần thì ném lại lỗi gốc và đã ghim đúng hai lần', async () => {
    const { http } = httpWithLists([wireRecord('MS-0001')]);
    const first = idTaken();
    const second = toAppErrorThrown(httpError(422, 'MEASUREMENT_LIMIT_REACHED'));
    const save = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    const { gateway } = build(http, save);

    // Đúng đối tượng lỗi LẦN MỘT, không phải lỗi lần hai.
    await expect(gateway.saveMeasurement(PROJECT, pinned('MS-0001'))).rejects.toBe(first);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('422 hết hạn mức ném ngay, không đọc lại danh sách', async () => {
    const { http, get } = httpWithLists();
    const save = vi
      .fn()
      .mockRejectedValue(toAppErrorThrown(httpError(422, 'MEASUREMENT_LIMIT_REACHED')));
    const { gateway } = build(http, save);

    await expect(gateway.saveMeasurement(PROJECT, pinned('MS-0001'))).rejects.toMatchObject({
      code: 'MEASUREMENT_LIMIT_REACHED',
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('danh sách có quá 20 % phần tử sai schema thì lượt đọc ném', async () => {
    const { http } = httpWithLists([
      wireRecord('MS-0001'),
      wireRecord('MS-0002'),
      { id: 'hỏng' },
      { id: 'hỏng' },
      { id: 'hỏng' },
    ]);
    const { gateway } = build(http, vi.fn());

    await expect(gateway.listMeasurements(PROJECT)).rejects.toMatchObject({ code: 'CONTRACT_VALIDATION' });
  });
});

describe('measurementToolGateway — mã đã xoá không quay lại trong phiên', () => {
  it('ghim bằng mã vừa xoá thì sinh lại mã và tên trước khi gửi', async () => {
    const { http, get } = httpWithLists();
    const save = vi.fn().mockResolvedValue(undefined);
    const { gateway, queryClient } = build(http, save);
    queryClient.setQueryData(measurementKeys.all(PROJECT), [
      MeasurementRecordSchema.parse(wireRecord('MS-0001')),
      MeasurementRecordSchema.parse(wireRecord('MS-0002')),
    ]);

    await gateway.deleteMeasurement(PROJECT, 'MS-0002');
    queryClient.setQueryData(measurementKeys.all(PROJECT), [MeasurementRecordSchema.parse(wireRecord('MS-0001'))]);

    const saved = await gateway.saveMeasurement(PROJECT, pinned('MS-0002'));

    expect(saved.id).toBe('MS-0003');
    expect(save.mock.calls[0]?.[0].measurement.id).toBe('MS-0003');
    expect(get).not.toHaveBeenCalled();
  });

  it('resolveUndoConflict cấp mã mới trên danh sách vừa đọc', async () => {
    const { http } = httpWithLists([wireRecord('MS-0001'), wireRecord('MS-0002')]);
    const { gateway } = build(http, vi.fn());

    const record = MeasurementRecordSchema.parse(wireRecord('MS-0002'));
    const resolved = await gateway.resolveUndoConflict(PROJECT, {
      id: 'MS-0002',
      mode: record.mode,
      name: record.name,
      points: [],
      rawValueMm: millimetres(pinned('MS-0002').rawValueMm),
    });

    expect(resolved.id).toBe('MS-0003');
  });
});

describe('measurementErrorCodeOf', () => {
  it('reads the code from an HttpError and from an AppError', () => {
    expect(measurementErrorCodeOf(httpError(404, 'NOT_FOUND', 'measurement'))).toEqual({
      code: 'NOT_FOUND',
      resource: 'measurement',
    });
    expect(measurementErrorCodeOf(toAppError(httpError(409, 'MEASUREMENT_ID_TAKEN'))).code).toBe(
      'MEASUREMENT_ID_TAKEN',
    );
    expect(measurementErrorCodeOf(toAppError(httpError(404, 'NOT_FOUND', 'measurement'))).resource).toBe(
      'measurement',
    );
    expect(measurementErrorCodeOf('lạ')).toEqual({ code: null, resource: null });
  });

  it('does not read a raw code that fails the UPPER_SNAKE pattern on an HttpError', () => {
    const odd: HttpError = { kind: 'http', status: 500, code: 'lỗi lạ', requestId: 'r', retryable: false, raw: { code: 'lỗi lạ', requestId: 'r' } };

    expect(measurementErrorCodeOf(odd).code).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R10 làn S: số đo 3D mang trạng thái tỷ lệ.                                  */
/* -------------------------------------------------------------------------- */

describe('R10: thước đo 3D theo trạng thái tỷ lệ', () => {
  const coreOf = () =>
    toMeasurementRowCore({
      id: 'MS-r10',
      mode: 'pointToPoint',
      name: 'Phép đo R10',
      points: [],
      rawValueMm: millimetres(3600),
    });

  it('không truyền trạng thái thì số để trần, giữ nguyên hành vi cũ', () => {
    expect(formatMeasurementRow(coreOf(), 'mm').valueLabel).not.toContain('≈');
  });

  it('mô hình đã đo được tỷ lệ thì số để trần', () => {
    expect(formatMeasurementRow(coreOf(), 'mm', 'measured').valueLabel).not.toContain('≈');
  });

  it('còn tầng tỷ lệ ước lượng thì số đo mang dấu, vì thước không nói được nó thuộc tầng nào', () => {
    const label = formatMeasurementRow(coreOf(), 'mm', 'estimated').valueLabel;

    expect(label).toContain('≈');
    expect(label).toContain('(ước lượng)');
  });
});
