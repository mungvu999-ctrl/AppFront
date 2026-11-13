import { describe, expect, it } from 'vitest';

import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import type { ModelQuality } from '../libraryQuality';
import { isCornerSofaBox, roomSetOf, type Dims, type SetContext, type SetMember } from '../roomSet';
import { repairScene } from '../sceneRepair';

/**
 * LSA vòng 18 — sofa góc/chữ L: hộp AI vai sofa cạnh ngắn ≥ 1,30 m, dài/ngắn ≤ 1,8 (19 hộp / 15 căn ở F:/runs/m18/LS)
 * nhận mẫu dáng L; hộp sofa thẳng không bao giờ nhận mẫu L; món người dùng giữ nguyên; sceneRepair không kẹp sâu hộp góc.
 */
describe('LSA vòng 18 — isCornerSofaBox', () => {
  it('19 hộp góc đo ở LS là hộp góc; sofa thẳng / hộp dài không phải', () => {
    const corner: [number, number][] = [
      [2.15, 1.73], [2.13, 1.51], [2.48, 1.89], [1.59, 2.38], [2.21, 1.96], [2.02, 1.84], [2.75, 1.9], [1.57, 1.89], [1.92, 2.07],
      [2.79, 1.63], [2.92, 1.69], [1.82, 2.16], [1.31, 1.6], [2.46, 1.7], [1.64, 2.24], [1.92, 2.06], [1.62, 1.87], [1.87, 1.56],
    ];
    for (const [w, d] of corner) expect(isCornerSofaBox(w, d), `${w}×${d}`).toBe(true);
    expect(isCornerSofaBox(2.15, 0.9)).toBe(false);
    expect(isCornerSofaBox(2.15, 1.29)).toBe(false);
    expect(isCornerSofaBox(3.0, 1.45)).toBe(false); // dài/ngắn 2,07
    expect(isCornerSofaBox(2.63, 2.21)).toBe(false); // sâu hơn dải công năng sofa L 2,2 m
  });
});

describe('LSA vòng 18 — bộ chọn theo dáng (roomSetOf)', () => {
  // 'line': sofa thẳng 2,0 × 0,85 × 0,9 m; 'ell': sofa chữ L 2,04 × 0,86 × 1,53 m. 'line' rẻ hơn (hạng phong cách 0 < 50).
  const DIMS: Record<string, Dims> = { line: [2.0, 0.85, 0.9], ell: [2.04, 0.86, 1.53] };
  const q = (x: string): ModelQuality =>
    ({
      role: 'sofa',
      useMm: DIMS[x]?.map((v) => v * 1000),
      front: { axis: '+z', check: 'ok' },
      parts: [{ kind: 'upholstery', share: 1, lab: [60, 2, 8], material: 'fabric', kindBy: 'm' }],
      detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
      licence: 'CC0',
      source: 't',
      ...(x === 'ell' ? { shape: 'L' } : {}),
    }) as unknown as ModelQuality;
  const ctx: SetContext = {
    tierOf: (x) => (x === 'line' ? 0 : 50),
    tiers: 99,
    dimsOf: (x) => DIMS[x],
    palette: { light: true, tone: 'l' },
    qualityOf: (x) => (x in DIMS ? q(x) : undefined),
  };
  /** Món sofa hộp `w × d`; cỡ hiển thị = cỡ thật của mẫu (phương án cỡ thật), luôn trong hộp. */
  const sofa = (w: number, d: number, extra: Partial<SetMember> = {}): SetMember => ({
    id: 's',
    role: 'sofa',
    kind: 'chair',
    short: Math.min(w, d),
    long: Math.max(w, d),
    current: 'line',
    pool: ['line', 'ell'],
    fixed: false,
    sizeFrom: 'ai',
    box: { cx: 0, cy: 0, w, d, rot: 0 },
    shownOf: (x) => DIMS[x],
    ...extra,
  });
  const pick = (m: SetMember): string | null | undefined => roomSetOf('R', [m], new Map(), ctx).get('s')?.to;

  // CORNER_SOFA_PREFER TẮT (chấm mù vòng 18 hai lượt đều âm): hộp góc cũng đi đường sofa thẳng.
  it('hộp góc 2,15 × 1,73 (ch13 F1Q9LO) của món AI → mẫu thẳng, KHÔNG nhận mẫu L', () => {
    expect(pick(sofa(2.15, 1.73))).toBe('line');
  });
  it('hộp góc: concept dáng thẳng được giữ (mẫu L không giành chỗ)', () => {
    expect(pick(sofa(2.15, 1.73, { concept: { folder: 'line' } }))).toBe('line');
  });
  it('bật ưu tiên dáng L thì hình học vẫn nhận đúng hộp góc (isCornerSofaBox không bị tắt theo)', () => {
    expect(isCornerSofaBox(2.15, 1.73)).toBe(true);
    expect(isCornerSofaBox(2.2, 1.2)).toBe(false);
  });
  it('hộp sofa thẳng 2,2 × 1,2 không bao giờ nhận mẫu L, kể cả mẫu L rẻ hơn / là concept', () => {
    const cheapL: SetContext = { ...ctx, tierOf: (x) => (x === 'ell' ? 0 : 50) };
    const m = sofa(2.2, 1.2);
    expect(roomSetOf('R', [m], new Map(), cheapL).get('s')?.to).toBe('line');
    expect(roomSetOf('R', [sofa(2.2, 1.2, { concept: { folder: 'ell' } })], new Map(), cheapL).get('s')?.to).toBe('line');
    // Mẫu luật cũ là mẫu L (luật cũ xếp hạng cả thư viện) mà hộp thẳng: không fail-keep / fallback về mẫu L.
    expect(roomSetOf('R', [sofa(2.2, 1.2, { current: 'ell', pool: ['ell'] })], new Map(), cheapL).get('s')?.to).not.toBe('ell');
  });
  it('hộp người dùng xác nhận (cn13 PXAJ19) / ghim: không đổi sang mẫu L', () => {
    expect(pick(sofa(2.63, 2.21, { sizeFrom: 'user' }))).not.toBe('ell');
    const pinned = roomSetOf('R', [sofa(2.15, 1.73, { fixed: true, pool: [] })], new Map(), ctx).get('s');
    expect(pinned?.to ?? 'line').toBe('line');
  });
  it('hộp góc mà không mẫu L nào qua ràng buộc cứng → pool thẳng như cũ', () => {
    const noL: SetContext = { ...ctx, qualityOf: (x) => (x === 'ell' ? { ...q(x), front: { axis: '+z', check: 'suspect' } } : x in DIMS ? q(x) : undefined) as ModelQuality };
    expect(roomSetOf('R', [sofa(2.15, 1.73)], new Map(), noL).get('s')?.to).toBe('line');
  });
});

describe('LSA vòng 18 — sceneRepair fit không kẹp sâu hộp sofa góc', () => {
  const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
  const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 5000 },
    { x: 0, y: 5000 },
  ];
  const LIVING = { ...HUMAN, id: 'R-LIV', levelId: 'L-1', name: 'Phòng khách', usage: 'living', outline, areaM2: 30, wallIds: [] } as unknown as Room;
  const walls = outline.map(
    (start, i) =>
      ({ ...HUMAN, id: `W-${i}`, levelId: 'L-1', centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] }) as Wall,
  );
  const sofaAt = (id: string, w: number, d: number, x: number, y: number): Furniture =>
    ({
      ...AI,
      id,
      levelId: 'L-1',
      roomId: 'R-LIV',
      kind: 'chair',
      centre: { x, y },
      boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
      rotationDeg: 0.01,
    }) as unknown as Furniture;
  const graphOf = (furniture: Furniture[]): SpatialGraph =>
    ({
      building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
      levels: [{ ...HUMAN, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
      walls,
      openings: [],
      furniture,
      rooms: [LIVING],
      axes: [],
      dimensions: [],
      notes: [],
    }) as unknown as SpatialGraph;
  const sides = (f: Furniture | undefined) => (f === undefined ? [] : [f.boundingBox.max.x - f.boundingBox.min.x, f.boundingBox.max.y - f.boundingBox.min.y]);

  it('hộp góc 2,15 × 1,73 giữ sâu 1,73 m; hộp sofa thẳng 3,0 × 1,45 vẫn kẹp sâu về hồ sơ sofa thẳng', () => {
    const { graph, repairs } = repairScene(graphOf([sofaAt('F-L', 2150, 1730, 1600, 1500), sofaAt('F-I', 3000, 1450, 3500, 4000)]));
    expect(repairs.filter((r) => r.furnitureId === 'F-L' && r.rule === 'fit')).toEqual([]);
    expect(sides(graph.furniture.find((f) => f.id === 'F-L'))).toEqual([2150, 1730]);
    const line = sides(graph.furniture.find((f) => f.id === 'F-I'));
    expect(line[1]).toBeLessThan(1450);
  });
});
