import { describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Wall } from '@/domain/spatial/types';

import { WALL_LAYER_FIXTURE_BUILDING, WALL_LAYER_FIXTURE_LEVEL, WALL_LAYER_FIXTURE_WALLS } from './wallLayerReviewFixture';
import {
  buildUnapproveWallCommand,
  toWallInspector,
  geometrySuspectIdsOf,
  isLowConfidence,
  isStandardThickness,
  wallLengthNumberOf,
  wallStatusCode,
  WALL_UNAPPROVE_COMMAND_TYPE,
} from './wallLayerReviewGateway';
import { approveAllLabelOf, confidentWallsOf, rowExtraOf, sortByReviewQueue } from './wallReviewQueue';

const first = (): Wall => {
  const wall = WALL_LAYER_FIXTURE_WALLS[0];
  if (wall === undefined) throw new Error('fixture rỗng');
  return wall;
};

describe('R-7: độ dày so trong dung sai, không so bằng đúng', () => {
  it('116 mm (bội 23,13 mm của chuẩn 110) không bị ⚠', () => {
    expect(isStandardThickness(116)).toBe(true);
    const wall: Wall = { ...first(), thicknessMm: 116, reviewed: false, confidence: 1 };
    expect(wallStatusCode(wall)).not.toBe('attention');
  });

  it('260 mm lệch quá 30 mm khỏi mọi băng vẫn ⚠', () => {
    expect(isStandardThickness(260)).toBe(false);
  });
});

describe('S2-5: bỏ duyệt', () => {
  it('lệnh bỏ duyệt hạ reviewed về false, giữ nguyên phần còn lại', () => {
    const before: Wall = { ...first(), reviewed: true, source: 'human' };
    const command = buildUnapproveWallCommand(before, 'nguoi-duyet');
    const after = command.changes[0]?.after as Wall;

    expect(command.type).toBe(WALL_UNAPPROVE_COMMAND_TYPE);
    expect(after.reviewed).toBe(false);
    expect(after.thicknessMm).toBe(before.thicknessMm);
    expect(command.description).toContain('Bỏ duyệt');
  });
});

describe('K16: một quy tắc chiều dài cho danh sách và thanh tra', () => {
  it('tỷ lệ thật: số mm nguyên; tỷ lệ máy đo chưa xác nhận: số như thường (dải tạm đã nói); không đo được tỷ lệ: không có số', () => {
    expect(wallLengthNumberOf(5757.4)).toBe('5.757');
    expect(wallLengthNumberOf(5757.4, 'unresolved', 'pipeline')).toBe('5.757');
    expect(wallLengthNumberOf(5757.4, 'unresolved')).toBe('5.757');
    expect(wallLengthNumberOf(5757.4, 'unresolved', 'project_default')).toBeNull();
  });

  it('độ tin cậy của panel cùng bậc với thẻ: tường sai hình là "Máy chưa chắc" dù điểm cao (K21)', () => {
    const textOf = (confidence: number, suspect = false, reviewed = false) =>
      toWallInspector({ ...first(), confidence, reviewed }, WALL_LAYER_FIXTURE_LEVEL, undefined, undefined, 'mm', undefined, undefined, suspect ? new Set([first().id]) : undefined).confidenceText;

    expect(textOf(0.5)).toBe('Máy chưa chắc');
    expect(textOf(0.95)).toBe('Máy chắc chắn');
    expect(textOf(0.95, true)).toBe('Máy chưa chắc');
    expect(textOf(0.95, true, true)).toBe('Đã duyệt');
  });
});

describe('K15: máy chưa chắc lên đầu nhóm', () => {
  it('trong cùng nhóm, tường chưa duyệt dưới ngưỡng đứng trước; nhóm vẫn giữ thứ tự', () => {
    const sure: Wall = { ...first(), id: 'W-sure', thicknessMm: 220, reviewed: false, confidence: 0.95 };
    const unsure: Wall = { ...first(), id: 'W-unsure', thicknessMm: 220, reviewed: false, confidence: 0.5 };
    const odd: Wall = { ...first(), id: 'W-odd', thicknessMm: 260, reviewed: false, confidence: 0.95 };
    const done: Wall = { ...first(), id: 'W-done', thicknessMm: 220, reviewed: true, confidence: 0.4 };

    expect(sortByReviewQueue([done, sure, unsure, odd]).map((wall) => wall.id)).toEqual(['W-odd', 'W-unsure', 'W-sure', 'W-done']);
  });
});

describe('UX-R2 K21/K26: "máy chưa chắc" theo hình', () => {
  const at = (id: string, start: Wall['centreline']['start'], end: Wall['centreline']['end'], thicknessMm = 110): Wall => ({
    ...first(),
    /* Mã đúng khuôn của bộ mẫu (`W-000901…`): luật hình học chỉ đọc thực thể có tiền tố hợp lệ. */
    id: first().id.replace(/^W-\d+/u, `W-000${id.slice(2)}`) as Wall['id'],
    centreline: { start, end },
    thicknessMm,
    confidence: 0.99,
    reviewed: false,
  });

  it('gắn cờ hai tường cắt chéo (chữ X) và tường vụn ngắn hơn bề dày; tường lưới sạch không bị gắn', () => {
    const extra = [
      at('W-901', { x: 0, y: 2200 }, { x: 2500, y: 4400 }),
      at('W-902', { x: 0, y: 4400 }, { x: 2500, y: 2200 }),
      at('W-903', { x: 2500, y: 3000 }, { x: 2550, y: 3000 }),
    ];
    const graph = normalizeSpatial({
      building: WALL_LAYER_FIXTURE_BUILDING,
      levels: [WALL_LAYER_FIXTURE_LEVEL],
      walls: [...WALL_LAYER_FIXTURE_WALLS, ...extra],
      openings: [],
      furniture: [],
      rooms: [],
      axes: [],
      dimensions: [],
      notes: [],
    });
    const suspects = geometrySuspectIdsOf(graph, WALL_LAYER_FIXTURE_LEVEL.id);

    expect([...suspects].sort()).toEqual(extra.map((wall) => wall.id).sort());
    expect(isLowConfidence(at('W-901', { x: 0, y: 0 }, { x: 1, y: 0 }), undefined, suspects)).toBe(true);
    expect(isLowConfidence(first(), 0.5, suspects)).toBe(false);
  });

  it('không có đồ thị hay tầng thì không gắn cờ gì', () => {
    expect(geometrySuspectIdsOf(null, null).size).toBe(0);
  });
});

describe('U17: duyệt hết đoạn máy chắc chắn', () => {
  it('chỉ lấy đoạn chưa duyệt, đúng chuẩn, đủ tin cậy, không lý do nghi', () => {
    const base = first();
    const sure: Wall = { ...base, id: 'W-A' as Wall['id'], thicknessMm: 220, reviewed: false, confidence: 1 };
    const done: Wall = { ...sure, id: 'W-B' as Wall['id'], reviewed: true };
    const odd: Wall = { ...sure, id: 'W-C' as Wall['id'], thicknessMm: 260 };
    const unsure: Wall = { ...sure, id: 'W-D' as Wall['id'], confidence: 0.1 };
    const suspect: Wall = { ...sure, id: 'W-E' as Wall['id'] };
    const short: Wall = { ...sure, id: 'W-F' as Wall['id'] };

    const ids = confidentWallsOf(
      [sure, done, odd, unsure, suspect, short],
      new Set(['W-E']),
      (wall) => (wall.id === 'W-F' ? 'short' : null),
    ).map((wall) => wall.id);

    expect(ids).toEqual(['W-A']);
    expect(approveAllLabelOf(12)).toBe('Duyệt 12 đoạn máy chắc chắn');
  });
});

/* -------------------------------------------------------------------------- */
/* R10 làn S: cột "Dài, mm" tự mang dấu, không ỷ vào dải cảnh báo trên đầu màn. */
/* -------------------------------------------------------------------------- */

describe('R10: cột "Dài, mm" của hàng đợi theo trạng thái tỷ lệ', () => {
  const wall = first();
  const level = WALL_LAYER_FIXTURE_LEVEL;

  it('tầng đo được tỷ lệ thì số để trần', () => {
    expect(rowExtraOf(wall, level, undefined, undefined, null, 'determined').lengthText).not.toContain('≈');
  });

  it('tầng tỷ lệ ước lượng thì mỗi hàng mang dấu ≈ và chữ ước lượng', () => {
    const text = rowExtraOf(wall, level, 'unresolved', undefined, null, 'estimated').lengthText;

    expect(text).toContain('≈');
    expect(text).toContain('(ước lượng)');
  });

  it('R10: tầng đã chấp nhận số máy (hết scaleStatus) vẫn phải mang dấu', () => {
    const text = rowExtraOf(wall, level, undefined, undefined, null, 'estimated').lengthText;

    expect(text).toContain('(ước lượng)');
  });
});
