import { describe, expect, it } from 'vitest';

import { FurnitureSchema } from '../spatial';
import { FloorRevisionSchema } from '../spatialGraph';
import { FloorLayerDocumentSchema, FloorLayerWriteResultSchema } from '../spatialLayer';

/**
 * Stack f14 (vá nóng AppBack M1-01/M2-QL) trả thêm ba khoá lớp đề xuất ở N16 và `floorRevisions` của N15, và
 * cầu thang mang `variant: 'straight'`. Nhánh này phải mở được tầng ấy: nhận rồi bỏ đúng các khoá đó, khoá lạ
 * khác vẫn bị chặn. Ca thật: dự án 2 tầng `prj_01M6TCGQSKT65049EXTHQSRVNX` (96 gợi ý ở tầng 1, 2 cầu thang).
 */

const SUGGESTION_KEYS = {
  suggestions: [{ id: 'DRESS-C1-D-X', rule: 'C1', state: 'active' }],
  suggestionsMeta: { basisRevision: 23, ruleset: '2026.11-1', rulesetSha: 'abc' },
  suggestionsEnabled: true,
} as const;

const document = {
  axes: [],
  dimensions: [],
  layer: { furniture: [], openings: [], rooms: [], walls: [] },
  level: {
    confidence: 1,
    elevationMm: 0,
    heightMm: 3300,
    id: 'L-LEVEL00',
    name: 'Tầng 1',
    order: 0,
    reviewed: false,
    source: 'human',
  },
  revision: 23,
} as const;

const stair = {
  boundingBox: { max: { x: 6650, y: 7500 }, min: { x: 5750, y: 4500 } },
  centre: { x: 6200, y: 6000 },
  confidence: 1,
  id: 'F-STAIR001',
  kind: 'stair',
  levelId: 'L-LEVEL00',
  reviewed: false,
  rotationDeg: 0,
  source: 'human',
} as const;

describe('N16 — khoá lớp đề xuất M2', () => {
  it('nhận rồi bỏ suggestions/suggestionsMeta/suggestionsEnabled', () => {
    const parsed = FloorLayerDocumentSchema.parse({ ...document, ...SUGGESTION_KEYS });
    expect(parsed).toStrictEqual(FloorLayerDocumentSchema.parse(document));
    expect(parsed).not.toHaveProperty('suggestions');
  });

  it('khoá lạ khác vẫn bị chặn', () => {
    expect(FloorLayerDocumentSchema.safeParse({ ...document, ...SUGGESTION_KEYS, suggestionState: [] }).success).toBe(
      false,
    );
  });
});

describe('#35 PUT — phản hồi có khoá lớp đề xuất M2', () => {
  const result = { layer: document.layer, revision: 24 };

  it('nhận rồi bỏ, ra đúng {layer, revision}', () => {
    expect(FloorLayerWriteResultSchema.parse({ ...result, ...SUGGESTION_KEYS })).toStrictEqual(
      FloorLayerWriteResultSchema.parse(result),
    );
    expect(Object.keys(FloorLayerWriteResultSchema.parse({ ...result, ...SUGGESTION_KEYS })).sort()).toEqual([
      'layer',
      'revision',
    ]);
  });

  it('khoá lạ khác vẫn bị chặn', () => {
    expect(FloorLayerWriteResultSchema.safeParse({ ...result, ...SUGGESTION_KEYS, suggestionState: [] }).success).toBe(
      false,
    );
  });
});

describe('N15 floorRevisions — khoá lớp đề xuất M2', () => {
  it('dòng có gợi ý ra đúng {floorId, revision}', () => {
    expect(FloorRevisionSchema.parse({ floorId: 'L-LEVEL00', revision: 23, ...SUGGESTION_KEYS })).toStrictEqual({
      floorId: 'L-LEVEL00',
      revision: 23,
    });
  });

  it('khoá lạ khác vẫn bị chặn', () => {
    expect(FloorRevisionSchema.safeParse({ floorId: 'L-LEVEL00', revision: 0, name: 'x' }).success).toBe(false);
  });
});

describe('Furniture — kiểu cầu thang trên dây', () => {
  it.each(['straight', 'curved', 'spiral'])('cầu thang %s đọc được, kiểu GIỮ nguyên để ghi trả', (variant) => {
    expect(FurnitureSchema.parse({ ...stair, variant })).toStrictEqual({ ...FurnitureSchema.parse(stair), variant });
  });

  it('kiểu thang lạ ngoài hợp đồng BE là lỗi đọc (không mở, không ghi đè)', () => {
    expect(FurnitureSchema.safeParse({ ...stair, variant: 'winder' }).success).toBe(false);
  });

  it('kiểu cầu thang trên món không phải cầu thang là lỗi', () => {
    expect(FurnitureSchema.safeParse({ ...stair, kind: 'table', variant: 'straight' }).success).toBe(false);
  });

  it('kiểu đồ thường vẫn giữ', () => {
    expect(FurnitureSchema.parse({ ...stair, kind: 'table', variant: 'table' })).toMatchObject({ variant: 'table' });
  });
});
