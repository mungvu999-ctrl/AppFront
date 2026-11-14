/**
 * M19 — hai lỗi khiến món chồng món nằm nguyên trong cảnh (3 va chạm còn lại sau vòng 18: cn17/cn18 bàn trà + sofa,
 * m17sb ghế băng + bàn ăn).
 * 1. `tucked` của roomSet đi theo `Furniture.kind`: 'chair' gom cả SOFA và ghế bành, 'table' gom cả BÀN TRÀ và tủ đầu
 *    giường, nên sofa được coi là "kê dưới" bàn trà — hai món không bao giờ chặn nhau ở bất kỳ phép kiểm nào.
 * 2. Đường bộ chọn (`pick` qua `evalOf`) chỉ so va chạm TƯƠNG ĐỐI (mọi ứng viên đều chồng thì cái ít chồng nhất vẫn
 *    "đạt") và KHÔNG đi qua `fallbackOf`, nên thang dời T1–T3 chưa bao giờ chạy cho món vẫn chọn được mẫu.
 * Sau: chồng ≥ 10 % mặt bằng của chính món thì vào thang dời; dời được thì dời, không dời được thì GIỮ NGUYÊN (không
 * biến va chạm sẵn có trong dữ liệu thành món bị ẩn), và chỉ nhận lượt dời gần ≤ 1,5 m.
 */
import { describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutRoomOf, type LayoutRoom } from '../layoutSearch';
import type { ModelQuality } from '../libraryQuality';
import { LAYOUT_BUDGET, roomSetOf, type Dims, type SetContext, type SetLayout, type SetMember } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
const roomOf = (w: number, h: number): LayoutRoom => {
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const walls = outline.map(
    (start, i) =>
      ({ ...HUMAN, id: `W-0000000WALL${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
  );
  const door = { ...HUMAN, id: 'O-0000000DOOR1', wallId: 'W-0000000WALL1', kind: 'door', offsetMm: 200, widthMm: 800, heightMm: 2100, sillHeightMm: 0, swing: 'sliding' } as unknown as Opening;
  const graph = { walls, openings: [door], rooms: [] } as unknown as SpatialGraph;
  return layoutRoomOf({ id: 'R-1', levelId: LVL, outline } as never, graph);
};

const q = (role: string, useMm: readonly [number, number, number]): ModelQuality =>
  ({
    role,
    useMm,
    front: { axis: '+z', check: 'ok' },
    parts: [{ kind: 'frame', share: 0.5, lab: [62, 8, 24], material: 'wood', kindBy: 'm' }],
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as ModelQuality;

const DIMS: Record<string, Dims> = { sofa1: [2.0, 0.85, 0.9], coffee1: [1.0, 0.4, 0.6], table1: [1.4, 0.75, 0.8], chair1: [0.45, 0.9, 0.45], bench1: [1.4, 0.46, 0.6] };
const QUAL: Record<string, ModelQuality> = {
  sofa1: q('sofa', [2000, 850, 900]),
  coffee1: q('coffeeTable', [1000, 400, 600]),
  table1: q('diningTable', [1400, 750, 800]),
  chair1: q('diningChair', [450, 900, 450]),
  bench1: q('bench', [1400, 460, 600]),
};
const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => QUAL[id] };

interface Box {
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot: number;
}
/** Món AI chưa xác nhận: mẫu dựng đúng cỡ thật (shownOf = dimsOf) nên mặt bằng hiển thị = cỡ mẫu, không bị bóp vào hộp. */
const member = (id: string, role: string, kind: string, model: string, box: Box): SetMember => ({
  id,
  role,
  kind,
  short: Math.min(box.w, box.d),
  long: Math.max(box.w, box.d),
  current: model,
  pool: [model],
  fixed: false,
  sizeFrom: 'ai',
  box,
  shownOf: (f) => DIMS[f],
});
const run = (members: SetMember[], room: LayoutRoom) =>
  roomSetOf('room', members, new Map(), ctx, [], { room, run: { left: LAYOUT_BUDGET, ms: 0 } } satisfies SetLayout);

/** Hộp sofa và hộp bàn trà chồng nhau 0,45 m² (75 % mặt bằng bàn trà) — đúng dạng dữ liệu AI của cn17/cn18. */
const SOFA_BOX: Box = { cx: 1.2, cy: 1.0, w: 2.0, d: 0.9, rot: 0 };
const COFFEE_BOX: Box = { cx: 1.2, cy: 1.3, w: 1.0, d: 0.6, rot: 0 };

describe('M19 — sofa không "kê dưới" bàn trà', () => {
  it('phòng rộng: bàn trà chồng 75 % lên sofa đã chốt → được dời ra, vẫn là bàn trà', () => {
    const d = run([member('F-sofa', 'sofa', 'chair', 'sofa1', SOFA_BOX), member('F-coffee', 'coffeeTable', 'table', 'coffee1', COFFEE_BOX)], roomOf(5000, 4000)).get('F-coffee');
    expect(d?.to, JSON.stringify(d?.why)).not.toBeNull();
    expect(d?.at, JSON.stringify(d?.why)).toBeDefined();
    expect(d?.role ?? 'coffeeTable').toBe('coffeeTable');
  });

  it('bàn trà sau khi dời không còn nằm trong mặt bằng sofa', () => {
    const set = run([member('F-sofa', 'sofa', 'chair', 'sofa1', SOFA_BOX), member('F-coffee', 'coffeeTable', 'table', 'coffee1', COFFEE_BOX)], roomOf(5000, 4000));
    const at = set.get('F-coffee')?.at;
    expect(at).toBeDefined();
    const sofaY = [SOFA_BOX.cy - 0.45, SOFA_BOX.cy + 0.45] as const;
    const sofaX = [SOFA_BOX.cx - 1.0, SOFA_BOX.cx + 1.0] as const;
    const [w, dep] = (at as { rot: number }).rot % 180 === 0 ? [1.0, 0.6] : [0.6, 1.0];
    const cx = (at as { cx: number }).cx;
    const cy = (at as { cy: number }).cy;
    const apart = cx + w / 2 <= sofaX[0] + 1e-9 || cx - w / 2 >= sofaX[1] - 1e-9 || cy + dep / 2 <= sofaY[0] + 1e-9 || cy - dep / 2 >= sofaY[1] - 1e-9;
    expect(apart, JSON.stringify(at)).toBe(true);
  });

  it('phòng chật, không còn chỗ: bàn trà vẫn HIỆN ở chỗ cũ, không bị ẩn', () => {
    const d = run([member('F-sofa', 'sofa', 'chair', 'sofa1', SOFA_BOX), member('F-coffee', 'coffeeTable', 'table', 'coffee1', COFFEE_BOX)], roomOf(2400, 1800)).get('F-coffee');
    expect(d?.to, JSON.stringify(d?.why)).not.toBeNull();
    expect(d?.unplaced).toBeUndefined();
  });
});

describe('M19 — lượt gỡ chồng không cướp ngân sách của món sắp bị ẩn (Codex M19-1)', () => {
  it('bàn trà chồng sofa tiêu ngân sách `fix`, `left` còn nguyên cho lượt dời bắt buộc', () => {
    const run2: SetLayout['run'] = { left: LAYOUT_BUDGET, ms: 0 };
    roomSetOf(
      'room',
      [member('F-sofa', 'sofa', 'chair', 'sofa1', SOFA_BOX), member('F-coffee', 'coffeeTable', 'table', 'coffee1', COFFEE_BOX)],
      new Map(),
      ctx,
      [],
      { room: roomOf(5000, 4000), run: run2 } satisfies SetLayout,
    );
    expect(run2.left).toBe(LAYOUT_BUDGET);
    expect(run2.fix).toBeLessThan(LAYOUT_BUDGET);
  });
});

describe('M19 — ghế băng nằm dưới mặt bàn ăn là va chạm, không phải "kê dưới bàn"', () => {
  it('ghế băng chồng 64 % hộp bàn ăn → được dời ra (m17sb)', () => {
    const table: Box = { cx: 1.5, cy: 1.5, w: 1.76, d: 1.24, rot: 0 };
    const bench: Box = { cx: 0.85, cy: 1.5, w: 1.4, d: 0.61, rot: 90 };
    const d = run([member('F-table', 'diningTable', 'table', 'table1', table), member('F-bench', 'bench', 'chair', 'bench1', bench)], roomOf(5000, 4000)).get('F-bench');
    expect(d?.to, JSON.stringify(d?.why)).not.toBeNull();
    expect(d?.at, JSON.stringify(d?.why)).toBeDefined();
  });
});

describe('M19 — ghế ăn vẫn kê được dưới bàn ăn', () => {
  it('ghế ăn chồng hộp bàn ăn: không dời, không coi là va chạm', () => {
    const table: Box = { cx: 1.5, cy: 1.5, w: 1.4, d: 0.8, rot: 0 };
    const chair: Box = { cx: 1.5, cy: 1.95, w: 0.45, d: 0.45, rot: 0 };
    const set = run([member('F-table', 'diningTable', 'table', 'table1', table), member('F-chair', 'diningChair', 'chair', 'chair1', chair)], roomOf(5000, 4000));
    expect(set.get('F-chair')?.at, JSON.stringify(set.get('F-chair')?.why)).toBeUndefined();
    expect(set.get('F-chair')?.to).not.toBeNull();
  });
});
