import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DimensionSchema } from '../../schemas/spatial';
import {
  FloorLayerDocumentSchema,
  FloorLayerWriteBodySchema,
  FloorLayerWriteResultSchema,
  FloorLayerWriteSchema,
} from '../../schemas/spatialLayer';

/**
 * N16 và #35 — đọc và ghi lớp không gian của **một** tầng.
 *
 * Hai refine ở đây canh hai lỗi rất khác nhau. Refine của tài liệu canh một
 * mâu thuẫn **trong dữ liệu máy chủ gửi về**: nói "tỉ lệ chưa ai xác nhận" mà
 * lại không có tỉ lệ nào. Refine của thân ghi canh một request **rỗng** mà
 * client sắp gửi đi — nó tiêu một `baseVersion`, sinh một `revision` mới, và
 * không đổi gì.
 */

const AI_REVIEW = { confidence: 0.82, reviewed: false, source: 'ai' } as const;
const HUMAN_REVIEW = { confidence: 1, reviewed: true, source: 'human' } as const;

const wall = {
  ...AI_REVIEW,
  centreline: { end: { x: 4800, y: 0 }, start: { x: 0, y: 0 } },
  heightMm: 3900,
  id: 'W-WALL000',
  kind: 'partition',
  levelId: 'L-LEVEL00',
  openingIds: [],
  thicknessMm: 220,
} as const;

const layer = {
  furniture: [],
  openings: [],
  rooms: [],
  walls: [wall],
} as const;

const calibratedLevel = {
  ...HUMAN_REVIEW,
  elevationMm: 0,
  heightMm: 3900,
  id: 'L-LEVEL00',
  name: 'Tầng trệt',
  order: 0,
  scaleMillimetresPerPixel: 12.5,
} as const;

const uncalibratedLevel = {
  ...HUMAN_REVIEW,
  elevationMm: 0,
  heightMm: 3900,
  id: 'L-LEVEL00',
  name: 'Tầng trệt',
  order: 0,
} as const;

const dimension = {
  ...AI_REVIEW,
  id: 'M-DIMN000',
  kind: 'linear',
  levelId: 'L-LEVEL00',
  line: { end: { x: 4800, y: -500 }, start: { x: 0, y: -500 } },
  referenceIds: ['W-WALL000'],
  valueMm: 4800,
} as const;

const fullDocument = {
  axes: [],
  dimensions: [dimension],
  layer,
  level: calibratedLevel,
  revision: 7,
  scaleStatus: 'unresolved',
} as const;

const minimalDocument = {
  axes: [],
  dimensions: [],
  layer,
  level: uncalibratedLevel,
  revision: 0,
} as const;

describe('FloorLayerDocumentSchema', () => {
  it('FIX-P0-01: Dimension mang edited giữ nguyên giá trị', () => {
    const parsed = DimensionSchema.parse({ ...dimension, edited: true });

    expect(parsed.edited).toBe(true);
    expect(DimensionSchema.safeParse(dimension).success).toBe(true);
  });

  it('FIX-P0-02: readiness có thì giữ nguyên qua transform, vắng thì không có khoá', () => {
    const readiness = { reasons: ['scaleUnresolved', 'fallbackWallModel'], state: 'needsReview' } as const;

    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, readiness })).toStrictEqual({
      ...minimalDocument,
      readiness,
    });
    expect('readiness' in FloorLayerDocumentSchema.parse(minimalDocument)).toBe(false);
    expect(
      FloorLayerDocumentSchema.parse({ ...minimalDocument, readiness: { reasons: [], state: 'ready' } }).readiness,
    ).toStrictEqual({ reasons: [], state: 'ready' });
  });

  it('FIX-P0-02: state lạ, lý do lạ hoặc khoá lạ trong readiness bị từ chối', () => {
    const parse = (readiness: unknown) =>
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, readiness }).success;

    expect(parse({ reasons: [], state: 'broken' })).toBe(false);
    expect(parse({ reasons: ['unknownReason'], state: 'needsReview' })).toBe(false);
    expect(parse({ extra: 1, reasons: [], state: 'ready' })).toBe(false);
    expect(parse({ state: 'ready' })).toBe(false);
  });

  it('BENCH3D-11: geometrySuspect + checks (cả mã lạ) và scaleBasis được nhận; bản cũ không có chúng vẫn qua', () => {
    const readiness = {
      checks: ['OPEN_ENVELOPE', 'ROTATED_PLAN', 'SOME_FUTURE_CHECK'],
      reasons: ['geometrySuspect', 'scaleUnresolved'],
      state: 'needsReview',
    } as const;
    const parsed = FloorLayerDocumentSchema.parse({ ...fullDocument, readiness, scaleBasis: 'door' });

    expect(parsed.readiness).toStrictEqual(readiness);
    expect(parsed.scaleBasis).toBe('door');
    // `checks: []` coi như vắng; tài liệu không có trường mới không sinh khoá nào.
    expect(
      FloorLayerDocumentSchema.parse({ ...minimalDocument, readiness: { checks: [], reasons: [], state: 'ready' } })
        .readiness,
    ).toStrictEqual({ reasons: [], state: 'ready' });
    expect('scaleBasis' in FloorLayerDocumentSchema.parse(minimalDocument)).toBe(false);
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, scaleBasis: 'guess' }).success).toBe(false);
    expect(
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, readiness: { checks: [''], reasons: [], state: 'ready' } })
        .success,
    ).toBe(false);
  });

  it('BENCH3D-11: phòng có clearAreaM2 thì giữ, không có thì không sinh khoá', () => {
    const room = {
      ...AI_REVIEW,
      areaM2: 16,
      id: 'R-ROOM000',
      levelId: 'L-LEVEL00',
      name: 'Phòng ngủ',
      outline: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
      ],
      usage: 'bedroom',
      wallIds: [],
    } as const;
    const parse = (rooms: readonly unknown[]) =>
      FloorLayerDocumentSchema.parse({ ...minimalDocument, layer: { ...layer, rooms } }).layer.rooms[0];

    expect(parse([{ ...room, clearAreaM2: 14.62 }])?.clearAreaM2).toBe(14.62);
    expect(parse([room])).not.toHaveProperty('clearAreaM2');
    expect(
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, layer: { ...layer, rooms: [{ ...room, clearAreaM2: -1 }] } })
        .success,
    ).toBe(false);
  });

  it('nhận tài liệu đầy đủ', () => {
    expect(FloorLayerDocumentSchema.parse(fullDocument)).toStrictEqual({ ...fullDocument });
  });

  it('gốc toạ độ: có thì giữ, null hoặc vắng thì bỏ khoá; số lẻ bị từ chối (G4b-17)', () => {
    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, origin: { x: 1200, y: -300 } })).toStrictEqual({
      ...minimalDocument,
      origin: { x: 1200, y: -300 },
    });
    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, origin: null })).toStrictEqual({ ...minimalDocument });
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, origin: { x: 1.5, y: 0 } }).success).toBe(false);
  });

  it('sourceDpi (U01): số dương giữ lại, null hoặc vắng thì bỏ khoá; 0 bị từ chối', () => {
    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, sourceDpi: 150 })).toStrictEqual({
      ...minimalDocument,
      sourceDpi: 150,
    });
    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, sourceDpi: null })).toStrictEqual({ ...minimalDocument });
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, sourceDpi: 0 }).success).toBe(false);
  });

  it('nhận tài liệu tối thiểu và bỏ hẳn khoá scaleStatus', () => {
    expect(FloorLayerDocumentSchema.parse(minimalDocument)).toStrictEqual({ ...minimalDocument });
  });

  it('từ chối khoá lạ — notes bị bỏ khỏi N16 vì không màn QC nào đọc', () => {
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, notes: [] }).success).toBe(
      false,
    );
  });

  it('từ chối khoá lạ trong layer lồng', () => {
    expect(
      FloorLayerDocumentSchema.safeParse({
        ...minimalDocument,
        layer: { ...layer, axes: [] },
      }).success,
    ).toBe(false);
  });

  it('từ chối null ở trường tuỳ chọn scaleStatus', () => {
    expect(
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, scaleStatus: null }).success,
    ).toBe(false);
  });

  it('từ chối scaleStatus ngoài giá trị duy nhất unresolved', () => {
    expect(
      FloorLayerDocumentSchema.safeParse({ ...fullDocument, scaleStatus: 'resolved' }).success,
    ).toBe(false);
  });

  it('từ chối revision âm và revision thập phân', () => {
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, revision: -1 }).success).toBe(
      false,
    );
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, revision: 1.5 }).success).toBe(
      false,
    );
  });

  it('refine tỉ lệ: có scaleStatus mà tầng không có tỉ lệ thì hỏng, đúng path', () => {
    const parsed = FloorLayerDocumentSchema.safeParse({
      ...minimalDocument,
      scaleStatus: 'unresolved',
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues[0]?.path).toStrictEqual([
      'level',
      'scaleMillimetresPerPixel',
    ]);
  });

  it('refine tỉ lệ: tầng đã hiệu chỉnh, vắng scaleStatus — đạt', () => {
    expect(
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, level: calibratedLevel }).success,
    ).toBe(true);
  });

  it('giữ scaleSource đi cùng scaleStatus, từ chối scaleSource đứng một mình (UX-R1 K12)', () => {
    const missing = FloorLayerDocumentSchema.parse({
      ...minimalDocument,
      level: calibratedLevel,
      scaleStatus: 'unresolved',
      scaleSource: 'project_default',
    });

    expect(missing.scaleSource).toBe('project_default');
    expect(
      FloorLayerDocumentSchema.safeParse({ ...minimalDocument, level: calibratedLevel, scaleSource: 'pipeline' })
        .success,
    ).toBe(false);
  });

  it('R9: nhận scaleState + scaleReasons (mã lạ vẫn qua); vắng thì không sinh khoá; trạng thái lạ đọc là estimated', () => {
    const estimated = FloorLayerDocumentSchema.parse({
      ...minimalDocument,
      level: calibratedLevel,
      scaleStatus: 'unresolved',
      scaleSource: 'pipeline',
      scaleState: 'estimated',
      scaleReasons: ['door', 'futureCode'],
    });
    expect(estimated.scaleState).toBe('estimated');
    expect(estimated.scaleReasons).toEqual(['door', 'futureCode']);

    const legacy = FloorLayerDocumentSchema.parse({ ...minimalDocument, level: calibratedLevel, scaleStatus: 'unresolved' });
    expect(legacy).not.toHaveProperty('scaleState');
    expect(legacy).not.toHaveProperty('scaleReasons');

    // Trạng thái lạ của máy chủ tương lai không làm vỡ trang: đọc là `estimated`; chuỗi rỗng vẫn bị từ chối.
    expect(FloorLayerDocumentSchema.parse({ ...minimalDocument, scaleState: 'futureState' }).scaleState).toBe('estimated');
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, scaleState: '' }).success).toBe(false);
    expect(FloorLayerDocumentSchema.safeParse({ ...minimalDocument, scaleReasons: [''] }).success).toBe(false);
    expect(
      FloorLayerDocumentSchema.parse({ ...minimalDocument, level: calibratedLevel, scaleState: 'userCalibrated', scaleReasons: [] })
        .scaleState,
    ).toBe('userCalibrated');
  });
});

describe('FloorLayerWriteBodySchema', () => {
  it('nhận thân chỉ mang trục hoặc chỉ mang gốc toạ độ (G4b-17)', () => {
    expect(FloorLayerWriteBodySchema.parse({ axes: [] })).toStrictEqual({ axes: [] });
    expect(FloorLayerWriteBodySchema.parse({ origin: { x: 0, y: 0 } })).toStrictEqual({ origin: { x: 0, y: 0 } });
  });

  it('nhận thân chỉ mang lớp', () => {
    expect(FloorLayerWriteBodySchema.parse({ layer })).toStrictEqual({ layer });
  });

  it('nhận thân chỉ mang tỉ lệ — đó là cách áp tỉ lệ cho mọi tầng', () => {
    expect(FloorLayerWriteBodySchema.parse({ scaleMillimetresPerPixel: 12.5 })).toStrictEqual({
      scaleMillimetresPerPixel: 12.5,
    });
  });

  it('nhận thân mang cả hai', () => {
    expect(
      FloorLayerWriteBodySchema.parse({ layer, scaleMillimetresPerPixel: 12.5 }),
    ).toStrictEqual({ layer, scaleMillimetresPerPixel: 12.5 });
  });

  it('từ chối khoá lạ', () => {
    expect(FloorLayerWriteBodySchema.safeParse({ layer, force: true }).success).toBe(false);
  });

  it.each(['measured', 'machineAccepted'] as const)('thân PUT nhận scaleEvidence %s kèm tỉ lệ (K4)', (scaleEvidence) => {
    expect(FloorLayerWriteBodySchema.parse({ scaleEvidence, scaleMillimetresPerPixel: 12.5 })).toStrictEqual({
      scaleEvidence,
      scaleMillimetresPerPixel: 12.5,
    });
  });

  it.each([
    ['giá trị lạ', { scaleEvidence: 'userCalibrated', scaleMillimetresPerPixel: 12.5 }],
    ['không kèm tỉ lệ', { layer, scaleEvidence: 'measured' }],
    ['null', { scaleEvidence: null, scaleMillimetresPerPixel: 12.5 }],
  ])('từ chối scaleEvidence lạ: %s', (_label, body) => {
    expect(FloorLayerWriteBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['layer', { layer: null }],
    ['scaleMillimetresPerPixel', { scaleMillimetresPerPixel: null }],
  ])('từ chối null ở trường tuỳ chọn %s', (_label, body) => {
    expect(FloorLayerWriteBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['0', 0],
    ['âm', -12.5],
    ['vô cực', Number.POSITIVE_INFINITY],
  ])('từ chối tỉ lệ %s', (_label, scaleMillimetresPerPixel) => {
    expect(FloorLayerWriteBodySchema.safeParse({ scaleMillimetresPerPixel }).success).toBe(false);
  });

  it.each([
    ['thân rỗng', {}],
    ['khoá có mặt nhưng mang undefined: layer', { layer: undefined }],
    ['khoá có mặt nhưng mang undefined: tỉ lệ', { scaleMillimetresPerPixel: undefined }],
    ['cả hai khoá mang undefined', { layer: undefined, scaleMillimetresPerPixel: undefined }],
  ])('refine ít nhất một giá trị: %s hỏng, path rỗng', (_label, body) => {
    const parsed = FloorLayerWriteBodySchema.safeParse(body);

    expect(parsed.success).toBe(false);
    expect(parsed.success ? ['chưa hỏng'] : parsed.error.issues[0]?.path).toStrictEqual([]);
  });

  /**
   * Ghim lại chỗ mà phép đếm khoá từng lọt.
   *
   * `zod` 3 giữ khoá có mặt mà mang `undefined`, nên `{ layer: undefined }` có
   * `Object.keys().length === 1` — đủ qua một refine đếm khoá, rồi
   * `JSON.stringify` biến nó thành `{}` trên dây. Bài kiểm này đọc thẳng cái
   * hình dạng ấy để lần sau ai viết lại refine bằng `Object.keys` sẽ thấy đỏ.
   */
  it('khoá mang undefined VẪN có mặt sau khi zod phân tích — nên không được đếm khoá', () => {
    const passthrough = z.object({ layer: z.unknown() }).safeParse({ layer: undefined });

    expect(passthrough.success && Object.keys(passthrough.data)).toStrictEqual(['layer']);
    expect(JSON.stringify({ layer: undefined })).toBe('{}');
  });
});

describe('FloorLayerWriteSchema', () => {
  it('nhận thân ghi có version', () => {
    expect(
      FloorLayerWriteSchema.parse({ baseVersion: 7, body: { scaleMillimetresPerPixel: 12.5 } }),
    ).toStrictEqual({ baseVersion: 7, body: { scaleMillimetresPerPixel: 12.5 } });
  });

  it('gắn tiền tố body vào path của refine thân trong', () => {
    const parsed = FloorLayerWriteSchema.safeParse({ baseVersion: 7, body: {} });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? ['chưa hỏng'] : parsed.error.issues[0]?.path).toStrictEqual(['body']);
  });

  it('từ chối thiếu baseVersion', () => {
    expect(FloorLayerWriteSchema.safeParse({ body: { layer } }).success).toBe(false);
  });

  it('từ chối khoá lạ ở thân ngoài', () => {
    expect(
      FloorLayerWriteSchema.safeParse({ baseVersion: 7, body: { layer }, floorId: 'L-LEVEL00' })
        .success,
    ).toBe(false);
  });

  it('không áp dụng phép kiểm null-ở-trường-tuỳ-chọn: hai khoá ngoài đều bắt buộc', () => {
    expect(FloorLayerWriteSchema.safeParse({ baseVersion: 7, body: { layer } }).success).toBe(true);
  });
});

describe('FloorLayerWriteResultSchema', () => {
  it('nhận phản hồi của PUT', () => {
    expect(FloorLayerWriteResultSchema.parse({ layer, revision: 8 })).toStrictEqual({
      layer,
      revision: 8,
    });
  });

  it('không áp dụng phép kiểm null-ở-trường-tuỳ-chọn: hai khoá đều bắt buộc', () => {
    expect(FloorLayerWriteResultSchema.safeParse({ layer, revision: 8 }).success).toBe(true);
  });

  it('từ chối khoá lạ — level và scaleStatus thuộc đường đọc', () => {
    expect(
      FloorLayerWriteResultSchema.safeParse({ layer, level: calibratedLevel, revision: 8 }).success,
    ).toBe(false);
  });

  it('từ chối revision âm', () => {
    expect(FloorLayerWriteResultSchema.safeParse({ layer, revision: -1 }).success).toBe(false);
  });
});
