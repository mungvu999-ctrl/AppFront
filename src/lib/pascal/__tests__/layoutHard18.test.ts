/**
 * Vòng 18 — ba luật được Codex (lượt soát M18-8) chỉ ra là còn hở, kèm ca tái hiện:
 *  1. Lượt NỚI chỉ nới vùng sử dụng: lối từ cửa tới món vẫn là ràng buộc CỨNG cho MỌI vai (trước đó vai phụ
 *     được nhận ở chỗ không vào được, chỉ ghi "chỉ phạt").
 *  2. Lượt nới phải thử TƯ THẾ GẦN trước tường xa: `far` chỉ lấy đầu/giữa/cuối đoạn tường nên bỏ sót chỗ đặt
 *     được ngay cạnh hộp cũ → giường vẫn bị ẩn.
 *  3. Mẫu sofa L của LUẬT CŨ ở hộp góc chỉ được giữ khi phần bọc nằm trong dải L* của bảng màu phòng; lệch dải
 *     (xám đậm trong phòng sáng — f06, f19 thua cả hai phiếu chấm mù) thì bộ chọn phải chọn lại trong pool L.
 */
import { describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutRoomOf, searchPlacement, type LayoutRoom, type Piece } from '../layoutSearch';
import type { ModelQuality } from '../libraryQuality';
import type { Rect } from '../placement';
import { LAYOUT_BUDGET, roomSetOf, type Dims, type SetContext, type SetLayout, type SetMember } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
const roomOf = (w: number, h: number, edge = 2, offMm = 200): LayoutRoom => {
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const walls = outline.map(
    (start, i) =>
      ({
        ...HUMAN,
        id: `W-0000000WALL${i}`,
        levelId: LVL,
        centreline: { start, end: outline[(i + 1) % 4] as Point },
        thicknessMm: 200,
        heightMm: 2700,
        kind: 'envelope',
        openingIds: [],
      }) as Wall,
  );
  const door = {
    ...HUMAN,
    id: 'O-0000000DOOR1',
    wallId: `W-0000000WALL${edge}`,
    kind: 'door',
    offsetMm: offMm,
    widthMm: 800,
    heightMm: 2100,
    sillHeightMm: 0,
    swing: 'left',
  } as unknown as Opening;
  const graph = { walls, openings: [door], rooms: [] } as unknown as SpatialGraph;
  return layoutRoomOf({ id: 'R-1', levelId: LVL, outline } as never, graph);
};

const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Thêm một vật CỐ ĐỊNH vào phòng (vào cả `blocks` nên lượt kiểm lối đi cũng thấy). */
const withFixed = (room: LayoutRoom, r: Rect): LayoutRoom =>
  ({ ...room, blocks: [...room.blocks, { ...r, id: 'F-fix', origin: 'fixed' as const }] }) as LayoutRoom;

describe('M18-8 P1 — lượt nới KHÔNG nới lối từ cửa (mọi vai)', () => {
  // Phòng 1,4 × 4,0 m lọt lòng, cửa ở cạnh dưới; vật cố định 1,2 × 0,4 m chắn ngang ở y = 2,3 m.
  // Nửa trên phòng không có lối vào → kệ sách 1 × 1 m ở nửa trên phải "chưa bố trí được", kể cả khi nới.
  const ROOM = withFixed(roomOf(1600, 4200, 0, 400), rect(0.7, 2.3, 1.2, 0.4));
  const SHELF: Piece = { id: 'F-shelf', role: 'bookshelf', dims: [1.0, 1.8, 0.4], box: rect(0.7, 3.4, 1.0, 0.4), wallBack: true, movable: true };
  const CANDS = [{ modelId: 'sh1', dims: SHELF.dims }];

  it('lượt thường: vai phụ vẫn được nhận kèm phạt (hành vi cũ, không đổi)', () => {
    expect('pose' in searchPlacement(ROOM, SHELF, CANDS, [])).toBe(true);
  });

  it('lượt nới: KHÔNG nhận chỗ không có lối từ cửa, lý do ghi đúng lối đi', () => {
    const res = searchPlacement(ROOM, SHELF, CANDS, [], { relax: true });
    expect('unplaced' in res, JSON.stringify('pose' in res ? res.pose : null)).toBe(true);
    if ('unplaced' in res) expect(res.unplaced.reason).toContain('lối từ cửa');
  });
});

describe('M18-8 P2 — lượt nới thử tư thế GẦN trước tường xa', () => {
  // Phòng 2,6 × 3,5 m lọt lòng; giường 1,6 × 2,0 m, hộp giữa phòng. Chỉ tư thế GẦN mới đặt được khi nới.
  const ROOM = withFixed(roomOf(2800, 3700, 0, 200), rect(0.5, 1.4, 0.12, 0.12));
  const BED: Piece = { id: 'F-bed', role: 'doubleBed', dims: [1.6, 0.5, 2.0], box: rect(1.3, 2.0, 1.6, 2.0), wallBack: true, movable: true };
  const CANDS = [{ modelId: 'db1', dims: BED.dims }];

  it('nới + tư thế gần: đặt được', () => {
    expect('pose' in searchPlacement(ROOM, BED, CANDS, [], { relax: true })).toBe(true);
  });

  it('nới + tường xa dời xa hơn hẳn → phải thử gần TRƯỚC', () => {
    const near = searchPlacement(ROOM, BED, CANDS, [], { relax: true });
    const far = searchPlacement(ROOM, BED, CANDS, [], { relax: true, far: true });
    expect('pose' in near && 'pose' in far).toBe(true);
    if (!('pose' in near) || !('pose' in far)) return;
    expect(near.pose.shiftM).toBeLessThan(far.pose.shiftM);
  });
});

describe('LSA — mẫu L của luật cũ ở hộp góc phải hợp bảng màu phòng', () => {
  const sofaQ = (lab: readonly [number, number, number], share = 1): ModelQuality =>
    ({
      role: 'sofa',
      shape: 'L',
      useMm: [2200, 860, 1500],
      front: { axis: '+z', check: 'ok' },
      parts: [{ kind: 'upholstery', share, lab, material: 'fabric', kindBy: 'm' }],
      detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
      licence: 'CC0',
      source: 'test',
    }) as unknown as ModelQuality;

  // Cùng cỡ, chỉ khác độ sáng phần bọc: tối L* 35 (ngoài dải sáng [45, 95]), vừa L* 58, sáng L* 67.
  const DIMS: Record<string, Dims> = { lDark: [2.2, 0.86, 1.5], lMid: [2.2, 0.86, 1.5], lLight: [2.2, 0.86, 1.5] };
  const QUAL: Record<string, ModelQuality> = { lDark: sofaQ([35, 0, 0]), lMid: sofaQ([58, 1, 1]), lLight: sofaQ([67, 0, 1]) };
  const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => QUAL[id] };
  /** Hộp góc thật (cạnh ngắn 1,52 m, tỉ lệ 1,45) như f06/f19. */
  const BOX = { cx: 2.5, cy: 2.5, w: 2.21, d: 1.52, rot: 0 };
  const sofa = (current: string, pool: string[]): SetMember => ({
    id: 'F-sofa',
    role: 'sofa',
    kind: 'chair',
    short: 1.52,
    long: 2.21,
    current,
    pool,
    fixed: false,
    sizeFrom: 'ai',
    box: BOX,
  });
  const run = (m: SetMember) => {
    const lay: SetLayout = { room: roomOf(5200, 5200, 0, 200), run: { left: LAYOUT_BUDGET, ms: 0 } };
    return roomSetOf('room', [m], new Map(), ctx, [], lay).get('F-sofa');
  };

  // Mặc định CORNER_SOFA_PREFER TẮT ⇒ mẫu L bị loại khỏi MỌI hộp, kể cả hộp góc; luật bảng màu dưới đây
  // chỉ có hiệu lực khi bật lại ưu tiên dáng L.
  it('mặc định: hộp góc KHÔNG nhận mẫu L nào (cả mẫu luật cũ)', () => {
    const d = run(sofa('lDark', ['lDark', 'lLight']));
    expect(d?.to ?? null, JSON.stringify(d?.why)).not.toBe('lDark');
    expect(d?.to ?? null).not.toBe('lLight');
  });
});
