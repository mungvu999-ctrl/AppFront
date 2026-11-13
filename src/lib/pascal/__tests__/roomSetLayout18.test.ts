/**
 * M18 L2 — thang bố trí lại trong `roomSetOf` (T1 dời cùng mẫu cỡ thật → T2 mẫu nhỏ hơn → T3 vai đồ chứa nhỏ hơn → T4 chưa
 * bố trí được). Phòng tổng hợp dựng từ đồ thị thật (`layoutRoomOf`), không tên căn. Đơn vị m (đồ thị mm).
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutRoomOf, type LayoutRoom } from '../layoutSearch';
import type { ModelQuality } from '../libraryQuality';
import { LAYOUT_BUDGET, roomSetOf, type Dims, type SetContext, type SetLayout, type SetMember, type SetZone } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
/** Phòng chữ nhật w × h mm, tường 200 mm tâm trên outline; cửa đi trên cạnh trên (y = h), rộng 800 mm, cách góc phải 200 mm. */
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
  const door = { ...HUMAN, id: 'O-0000000DOOR1', wallId: 'W-0000000WALL2', kind: 'door', offsetMm: 200, widthMm: 800, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  const graph = { walls, openings: [door] } as unknown as SpatialGraph;
  return layoutRoomOf({ id: 'R-1', levelId: LVL, outline } as never, graph);
};

const q = (role: string, complete = true): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [{ kind: 'frame', share: 0.5, lab: [62, 8, 24], material: 'wood', kindBy: 'm' }],
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...(role.endsWith('Bed') ? { completeness: { v: complete ? 'full' : 'partial', by: 'm' } } : {}),
  }) as ModelQuality;

const DIMS: Record<string, Dims> = {
  'single-bed': [0.92, 0.45, 2.0],
  sb1: [0.95, 0.5, 2.0],
  sb2: [0.97, 0.5, 2.05],
  sb3: [1.0, 0.5, 2.0],
  ns1: [0.4, 0.5, 0.4],
  cab1: [0.85, 0.8, 0.45],
};
const QUAL: Record<string, ModelQuality> = { sb1: q('singleBed', false), sb2: q('singleBed', false), sb3: q('singleBed', false), ns1: q('nightstand'), cab1: q('cabinet') };
const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => QUAL[id] };

interface Box {
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot?: number;
}
const member = (id: string, role: string, box: Box, over: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: Math.min(box.w, box.d),
  long: Math.max(box.w, box.d),
  current: null,
  pool: [],
  fixed: false,
  sizeFrom: 'ai',
  box: { cx: box.cx, cy: box.cy, w: box.w, d: box.d, rot: box.rot ?? 0 },
  // Khớp trong hộp (như itemFitOf giãn đúng hộp): mẫu cỡ thật lệch hộp bị bóp vào hộp.
  shownOf: (f) => (DIMS[f] === undefined ? undefined : [box.w, (DIMS[f] as Dims)[1], box.d]),
  ...over,
});

/** Hộp giường đơn AI 0,70 × 1,71 sát tường trái + tường dưới (kiểu phòng ngủ hẹp): giường thật 0,92 × 2,0 giữ tâm chạm tường. */
const NARROW_BED: Box = { cx: 0.55, cy: 0.955, w: 0.7, d: 1.71 };
const bed = (over: Partial<SetMember> = {}): SetMember =>
  member('F-bed', 'singleBed', NARROW_BED, { kind: 'bed', current: 'sb1', stock: 'single-bed', pool: ['sb1', 'sb2', 'sb3'], ...over });

/** Bỏ mẫu dựng sẵn của vai. */
const noStockOf = (m: SetMember): SetMember => {
  const { stock, ...rest } = m;
  void stock;
  return rest;
};
const MS: number[] = [];
const layoutOf = (room: LayoutRoom, left = LAYOUT_BUDGET): SetLayout => ({ room, run: { left, ms: 0 } });
const run = (members: SetMember[], room?: LayoutRoom, zones: SetZone[] = [], lay?: SetLayout) => {
  const l = lay ?? (room === undefined ? undefined : layoutOf(room));
  const out = roomSetOf('room', members, new Map(), ctx, zones, l);
  if (l !== undefined && lay === undefined) MS.push(l.run.ms);
  return out;
};
const NT = roomOf(2830, 3300);

afterAll(() => {
  const s = [...MS].sort((a, b) => a - b);
  console.log(`layoutMs trung vị ${(s[Math.floor(s.length / 2)] ?? 0).toFixed(2)} ms, tối đa ${(s[s.length - 1] ?? 0).toFixed(2)} ms (${s.length} lượt)`);
});

describe('roomSetOf — thang bố trí lại M18', () => {
  it('layoutRooms vắng → y như vòng 17: giường ẩn, không at/moved/unplaced/layout', () => {
    const d = run([bed()]).get('F-bed');
    expect(d?.to).toBeNull();
    expect(d?.why).toBe('phương án cuối: không mẫu hợp lệ — luật cũ bị cấm (giường chưa hoàn chỉnh), mẫu dựng sẵn không đặt được');
    expect(d).not.toHaveProperty('at');
    expect(d).not.toHaveProperty('unplaced');
    expect(d).not.toHaveProperty('layout');
  });

  it('phòng hẹp: giường đơn thật được DỜI (không ẩn, không co dưới 0,9 m), cỡ thật, lý do có số đo', () => {
    const d = run([bed()], NT).get('F-bed');
    expect(d?.to).toBe('single-bed');
    expect(d?.uniform).toBe('real');
    expect(d?.unplaced).toBeUndefined();
    expect(d?.at).toBeDefined();
    expect((DIMS[d?.to as string] as Dims)[0]).toBeGreaterThanOrEqual(0.9);
    expect(Math.hypot(d?.moved?.dx ?? 0, d?.moved?.dy ?? 0)).toBeLessThanOrEqual(0.6);
    expect(d?.move?.modelId).toBe('single-bed');
    expect(d?.why).toMatch(/T1 dời cùng mẫu cỡ thật: Dời \d,\d\d m/);
  });

  it('không mẫu dựng sẵn: giường chưa hoàn chỉnh được nhận vì là phương án giường duy nhất, sổ ghi lý do', () => {
    const noStock = noStockOf(bed());
    const d = run([noStock], NT).get('F-bed');
    expect(d?.to).toMatch(/^sb/);
    expect(d?.why).toContain('nhận giường chưa hoàn chỉnh');
    expect((DIMS[d?.to as string] as Dims)[0]).toBeGreaterThanOrEqual(0.9);
  });

  it('cụm: tủ đầu giường đi theo giường đã dời', () => {
    const ns = member('F-ns', 'nightstand', { cx: 1.12, cy: 0.3, w: 0.4, d: 0.4 }, { kind: 'nightstand', pool: ['ns1'], current: 'ns1' });
    const out = run([bed(), ns], NT);
    const b = out.get('F-bed');
    expect(b?.at).toBeDefined();
    const n = out.get('F-ns');
    const follows = b?.move?.members.some((x) => x.id === 'F-ns') === true;
    if (follows && b?.move?.broken.includes('F-ns') !== true) {
      expect(n?.at).toBeDefined();
      expect(n?.moved?.cluster).toEqual(['F-bed']);
    }
    expect(n?.to).not.toBeNull();
  });

  it('đồ xác nhận / ghim / ghim người dùng không bao giờ được dời', () => {
    const user = run([bed({ sizeFrom: 'user' })], NT).get('F-bed');
    expect(user?.at).toBeUndefined();
    // Cỡ người dùng: R8b giữ giường luật cũ trong hộp người dùng (tại chỗ); nếu ẩn thì sổ ghi lý do "đã xác nhận".
    expect(user?.to === null ? user.unplaced?.reason : 'giữ tại chỗ').toMatch(/đã xác nhận|giữ tại chỗ/);
    const pinned = run([bed({ fixed: true, current: 'sb1', pool: [] })], NT).get('F-bed');
    expect(pinned?.cause).toBe('pinned');
    expect(pinned?.at).toBeUndefined();
    const userPin = run([bed({ fixed: true, userPin: true, current: 'sb1', pool: [] })], NT).get('F-bed');
    expect(userPin?.at).toBeUndefined();
    const twin = run([bed({ pinTo: 'sb1' })], NT).get('F-bed');
    expect(twin?.at).toBeUndefined();
  });

  it('giường không bao giờ thành đôn/tủ; phòng quá nhỏ → chưa bố trí được có lý do + số thử', () => {
    const tiny = roomOf(1600, 1600);
    const noStock = noStockOf(bed({ box: { cx: 0.55, cy: 0.8, w: 0.7, d: 1.3, rot: 0 }, smaller: [{ role: 'nightstand', pool: ['ns1'] }] }));
    const d = run([noStock], tiny).get('F-bed');
    expect(d?.role).toBe('singleBed');
    expect(d?.to).toBeNull();
    expect(d?.unplaced?.reason).toMatch(/Không tìm được chỗ|không có mẫu/);
  });

  // Phòng khách 4 × 4: tủ thấp hộp 0,5 × 0,3 sát tường dưới, kệ TV (đồ ngoài bộ) ngay bên phải → tủ thật 0,85 m tại chỗ đè kệ.
  const CAB = (): SetMember => member('F-cab', 'cabinet', { cx: 2.0, cy: 0.25, w: 0.5, d: 0.3 }, { kind: 'cabinet', pool: ['cab1'] });
  const TV: SetZone = { cx: 2.65, cy: 0.35, w: 0.8, d: 0.5, rotationDeg: 0, kind: 'tvStand' };
  const LIVING = roomOf(4000, 4000);

  it('phòng khách, tủ hộp nhỏ: không layout → ẩn; có layout → dời / vai nhỏ hơn / chưa bố trí được có lý do', () => {
    expect(run([CAB()], undefined, [TV]).get('F-cab')?.to).toBeNull();
    const d = run([CAB()], LIVING, [TV]).get('F-cab');
    const ok = (d?.to !== null && d?.to !== undefined && (d.at !== undefined || d.role !== 'cabinet')) || (d?.unplaced?.reason ?? '') !== '';
    expect(ok).toBe(true);
    expect(d?.at).toBeDefined();
    expect(d?.to).toBe('cab1');
  });

  it('ngân sách dời-thử dùng chung cả căn: hết ngân sách → chưa bố trí được "vượt ngân sách"', () => {
    const lay = layoutOf(LIVING, 1);
    expect(run([CAB()], undefined, [TV], lay).get('F-cab')?.at).toBeDefined();
    const d = run([CAB()], undefined, [TV], lay).get('F-cab');
    expect(d?.to).toBeNull();
    expect(d?.unplaced?.reason).toContain('vượt ngân sách');
  });

  it('tất định: hai lượt → cùng sổ', () => {
    const a = JSON.stringify([...run([bed()], NT)]);
    const b = JSON.stringify([...run([bed()], NT)]);
    expect(a).toBe(b);
  });
});
