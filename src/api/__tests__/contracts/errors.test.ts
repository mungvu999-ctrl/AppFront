import { describe, expect, it } from 'vitest';

import { PIPELINE_STAGES } from '@/lib/realtime/pipeline';

import {
  ApiErrorBodySchema,
  RemoteFieldChangeSchema,
  VERSION_ENTITY_KINDS,
  VersionConflictBodySchema,
} from '../../schemas/errors';

/**
 * Thân lỗi chung, và thân 409 của mọi lượt ghi có version.
 *
 * Bài kiểm đáng giá nhất ở đây là bài so danh sách `step` với `PIPELINE_STAGES`:
 * file schema cố ý **không** nhập `lib/realtime/pipeline.ts` (nó kéo theo
 * `vi.json` và một lời `throw` lúc nạp), nên bản sao sáu id bước chỉ có một
 * thứ giữ cho khỏi trôi — chính bài kiểm này. Ở tầng test, lời nhập ấy không
 * tốn gì.
 */

const CHANGED_AT = '2026-09-17T05:09:00.123Z';
const USER_ID = 'usr_01J9ZQK7X4N2M8P6R3T5V7W9Y1';

const fullError = {
  code: 'VALIDATION',
  count: 2,
  field: 'body.baseVersion',
  fileName: 'tang-1.pdf',
  floor: 'L-LEVEL00',
  layer: 'walls',
  requestId: 'req-01J9ZQK7X4',
  resource: 'floor',
  step: 'dimensionReading',
} as const;

const minimalError = {
  code: 'VALIDATION',
  requestId: 'req-01J9ZQK7X4',
} as const;

const fullChange = {
  changedAt: CHANGED_AT,
  changedBy: USER_ID,
  changedByName: 'Trần Minh',
  entityId: 'W-WALL0014',
  entityType: 'wall',
  field: 'thickness_mm',
  value: 220,
} as const;

describe('ApiErrorBodySchema', () => {
  it('nhận thân đầy đủ chín trường', () => {
    expect(ApiErrorBodySchema.parse(fullError)).toStrictEqual({ ...fullError });
  });

  it('nhận thân tối thiểu và bỏ hẳn bảy khoá vắng mặt', () => {
    expect(ApiErrorBodySchema.parse(minimalError)).toStrictEqual({ ...minimalError });
  });

  it('từ chối khoá lạ — máy chủ không gửi bí danh errorCode', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, errorCode: 'VALIDATION' }).success).toBe(
      false,
    );
  });

  it.each([
    ['count', { ...minimalError, count: null }],
    ['field', { ...minimalError, field: null }],
    ['fileName', { ...minimalError, fileName: null }],
    ['floor', { ...minimalError, floor: null }],
    ['layer', { ...minimalError, layer: null }],
    ['resource', { ...minimalError, resource: null }],
    ['step', { ...minimalError, step: null }],
  ])('từ chối null ở trường tuỳ chọn %s', (_label, body) => {
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['chữ thường', 'validation'],
    ['mở đầu bằng số', '1VALIDATION'],
    ['ngắn hơn ba ký tự', 'VA'],
    ['có dấu gạch ngang', 'VERSION-CONFLICT'],
  ])('từ chối mã lỗi %s', (_label, code) => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, code }).success).toBe(false);
  });

  it.each([
    ['mở đầu bằng dấu chấm', '.baseVersion'],
    ['có đoạn rỗng', 'body..baseVersion'],
    ['có gạch dưới', 'body.base_version'],
  ])('từ chối đường chấm %s', (_label, field) => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, field }).success).toBe(false);
  });

  it('nhận resource shareLink — link chia sẻ hết hạn hay đã thu hồi trả NOT_FOUND', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, resource: 'shareLink' }).success).toBe(true);
  });

  it('nhận resource lightingBake — dự án chưa nướng ánh sáng lần nào trả NOT_FOUND (N43)', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, resource: 'lightingBake' }).success).toBe(true);
  });

  it('từ chối resource ngoài mười bảy giá trị', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, resource: 'wall' }).success).toBe(false);
  });

  it('từ chối step ngoài sáu bước', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, step: 'export' }).success).toBe(false);
  });

  it('từ chối count âm và count thập phân', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, count: -1 }).success).toBe(false);
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, count: 1.5 }).success).toBe(false);
  });

  it('nhận count bằng 0 — không lỗi con nào vẫn là một con số hợp lệ', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, count: 0 }).success).toBe(true);
  });

  it('từ chối requestId rỗng', () => {
    expect(ApiErrorBodySchema.safeParse({ ...minimalError, requestId: '' }).success).toBe(false);
  });

  it('không có refine — mọi ràng buộc ở đây suy ra được từ kiểu và mẫu', () => {
    expect(ApiErrorBodySchema.safeParse(fullError).success).toBe(true);
  });
});

describe('step — bản sao của PIPELINE_STAGES', () => {
  /**
   * `ApiErrorBodySchema` là `ZodEffects` vì nó có `.transform()`, nên đường
   * xuống tới danh sách enum đi qua `innerType()` rồi `unwrap()` khỏi
   * `.optional()`. Cả ba bước đều có kiểu, không cần một phép ép nào.
   */
  const declaredSteps = ApiErrorBodySchema.innerType().shape.step.unwrap().options;

  it('khai ĐÚNG BẰNG danh sách id của lib/realtime/pipeline.ts, không nhiều không ít', () => {
    expect(declaredSteps).toStrictEqual(PIPELINE_STAGES.map((stage) => stage.id));
  });

  it('và cả sáu id ấy đi qua được schema', () => {
    for (const step of declaredSteps) {
      expect(ApiErrorBodySchema.safeParse({ ...minimalError, step }).success).toBe(true);
    }
  });
});

describe('VERSION_ENTITY_KINDS', () => {
  it('là đúng chín họ của mergeStrategies (thêm mái, đề xuất), đúng thứ tự', () => {
    expect(VERSION_ENTITY_KINDS).toStrictEqual([
      'vertex',
      'wall',
      'door',
      'window',
      'furniture',
      'room',
      'dimension',
      'roof',
      'suggestion',
    ]);
  });
});

describe('RemoteFieldChangeSchema', () => {
  it('nhận một thay đổi đầy đủ', () => {
    expect(RemoteFieldChangeSchema.parse(fullChange)).toStrictEqual({ ...fullChange });
  });

  it('vắng khoá value vẫn ra một khoá value bằng undefined — ngoại lệ duy nhất', () => {
    const withoutValue: Record<string, unknown> = { ...fullChange };
    delete withoutValue.value;

    expect(RemoteFieldChangeSchema.parse(withoutValue)).toStrictEqual({
      ...withoutValue,
      value: undefined,
    });
  });

  it('từ chối value null, và chỉ tại value', () => {
    const parsed = RemoteFieldChangeSchema.safeParse({ ...fullChange, value: null });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues[0]?.path).toStrictEqual(['value']);
  });

  it('nhận value false và value 0 — chỉ null bị chặn', () => {
    expect(RemoteFieldChangeSchema.parse({ ...fullChange, value: false }).value).toBe(false);
    expect(RemoteFieldChangeSchema.parse({ ...fullChange, value: 0 }).value).toBe(0);
  });

  it('nhận changedBy là system:pipeline', () => {
    expect(
      RemoteFieldChangeSchema.safeParse({ ...fullChange, changedBy: 'system:pipeline' }).success,
    ).toBe(true);
  });

  it.each([
    ['thiếu tiền tố', '01J9ZQK7X4N2M8P6R3T5V7W9Y1'],
    ['tiền tố sai', 'prj_01J9ZQK7X4N2M8P6R3T5V7W9Y1'],
    ['có ký tự bị loại khỏi ULID', 'usr_01J9ZQK7X4N2M8P6R3T5V7W9YI'],
    ['ngắn hơn 26 ký tự', 'usr_01J9ZQK7X4'],
    ['một chuỗi khác của hệ thống', 'system:worker'],
  ])('từ chối changedBy %s', (_label, changedBy) => {
    expect(RemoteFieldChangeSchema.safeParse({ ...fullChange, changedBy }).success).toBe(false);
  });

  it('từ chối changedAt lệch múi giờ', () => {
    expect(
      RemoteFieldChangeSchema.safeParse({ ...fullChange, changedAt: '2026-09-17T05:09:00.123+07:00' })
        .success,
    ).toBe(false);
  });

  it('từ chối entityType ngoài bảy họ', () => {
    expect(RemoteFieldChangeSchema.safeParse({ ...fullChange, entityType: 'axis' }).success).toBe(
      false,
    );
  });

  it('từ chối changedByName rỗng — màn in nó ra, nên nó phải có chữ', () => {
    expect(RemoteFieldChangeSchema.safeParse({ ...fullChange, changedByName: '' }).success).toBe(
      false,
    );
  });

  it('từ chối khoá lạ', () => {
    expect(RemoteFieldChangeSchema.safeParse({ ...fullChange, changedByEmail: 'a@b.vn' }).success).toBe(
      false,
    );
  });

  it('không áp dụng phép kiểm null-ở-trường-tuỳ-chọn: schema này không có trường tuỳ chọn', () => {
    expect(RemoteFieldChangeSchema.safeParse(fullChange).success).toBe(true);
  });
});

describe('VersionConflictBodySchema', () => {
  const fullConflict = {
    code: 'VERSION_CONFLICT',
    currentVersion: 7,
    remoteChanges: [fullChange],
    requestId: 'req-01J9ZQK7X4',
  } as const;

  it('nhận thân 409 có entityType "suggestion" (nhật ký thay đổi của lớp đề xuất M2)', () => {
    const change = { ...fullChange, entityId: 'DRESS-R1-R-1-W-2', entityType: 'suggestion', field: 'state', value: 'disabled' } as const;

    expect(VersionConflictBodySchema.parse({ ...fullConflict, remoteChanges: [change] })).toStrictEqual({
      currentVersion: 7,
      remoteChanges: [{ ...change }],
    });
  });

  it('bỏ code và requestId khỏi đầu ra, giữ đúng hai trường bộ trộn cần', () => {
    expect(VersionConflictBodySchema.parse(fullConflict)).toStrictEqual({
      currentVersion: 7,
      remoteChanges: [{ ...fullChange }],
    });
  });

  it('nhận remoteChanges rỗng — rào cho danh sách rỗng ở chỗ gọi, không ở đây', () => {
    expect(VersionConflictBodySchema.parse({ ...fullConflict, remoteChanges: [] })).toStrictEqual({
      currentVersion: 7,
      remoteChanges: [],
    });
  });

  it('nhận currentVersion bằng 0', () => {
    expect(VersionConflictBodySchema.safeParse({ ...fullConflict, currentVersion: 0 }).success).toBe(
      true,
    );
  });

  it('từ chối mã khác VERSION_CONFLICT', () => {
    expect(VersionConflictBodySchema.safeParse({ ...fullConflict, code: 'VALIDATION' }).success).toBe(
      false,
    );
  });

  it('từ chối currentVersion âm và thập phân', () => {
    expect(VersionConflictBodySchema.safeParse({ ...fullConflict, currentVersion: -1 }).success).toBe(
      false,
    );
    expect(VersionConflictBodySchema.safeParse({ ...fullConflict, currentVersion: 1.5 }).success).toBe(
      false,
    );
  });

  it('từ chối khoá lạ ở thân ngoài', () => {
    expect(VersionConflictBodySchema.safeParse({ ...fullConflict, detail: 'x' }).success).toBe(false);
  });

  it('từ chối khoá lạ trong một mục remoteChanges', () => {
    expect(
      VersionConflictBodySchema.safeParse({
        ...fullConflict,
        remoteChanges: [{ ...fullChange, previousValue: 200 }],
      }).success,
    ).toBe(false);
  });

  it('không áp dụng phép kiểm null-ở-trường-tuỳ-chọn: schema này không có trường tuỳ chọn', () => {
    expect(VersionConflictBodySchema.safeParse(fullConflict).success).toBe(true);
  });
});
