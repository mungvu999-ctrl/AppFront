/**
 * Vòng 17 làn B — hợp bộ phòng khách: bảng màu bộ (món ghim + đã chốt + concept còn giữ + đồ ngoài bộ có mẫu) chấm
 * sofa / ghế bành / bàn trà theo màu gần nhất + chất liệu bọc trội; tỉ lệ cặp với sofa. Phòng ngủ / bàn ăn không đổi.
 */
import { describe, expect, it } from 'vitest';

import type { ModelQuality, PartMaterial, QualityPart } from '../libraryQuality';
import { roomSetOf, type Dims, type SetContext, type SetMember, type SetZone } from '../roomSet';

type L = readonly [number, number, number];
const part = (kind: QualityPart['kind'], share: number, lab: L, material?: PartMaterial): QualityPart =>
  ({ kind, share, lab, ...(material === undefined ? {} : { material }), kindBy: 'm' }) as QualityPart;
const q = (role: string, parts: QualityPart[]): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts,
    completeness: { v: 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as unknown as ModelQuality;

const Q: Record<string, ModelQuality> = {
  // Sofa da cam tay gỗ (T1), sofa da nâu (T3), sofa kem (T6).
  'sofa-orange-leather': q('sofa', [part('upholstery', 0.56, [55, 37, 52], 'leather'), part('frame', 0.44, [73, 9, 27], 'wood')]),
  'sofa-brown-leather': q('sofa', [part('upholstery', 1, [42, 4, 16], 'leather')]),
  'sofa-cream-fabric': q('sofa', [part('upholstery', 1, [71, 0, 12], 'fabric')]),
  // T2 neo: xám vải vs kem + be.
  'a-sofa-grey': q('sofa', [part('upholstery', 1, [60, 0, -2], 'fabric')]),
  'b-sofa-cream': q('sofa', [part('upholstery', 0.71, [86, -1, 1], 'fabric'), part('upholstery', 0.29, [77, 2, 27], 'fabric')]),
  // T3: ứng viên sofa thứ hai.
  'a-sofa-cream-fabric': q('sofa', [part('upholstery', 1, [74, 1, 10], 'fabric')]),
  'b-sofa-brown-leather': q('sofa', [part('upholstery', 1, [46, 4, 12], 'leather')]),
  oak: q('diningTable', [part('top', 1, [77, 10, 33], 'wood')]),
  // Ghế bành T1.
  'a-arm-grey': q('armchair', [part('upholstery', 0.91, [63, 0, 1], 'fabric'), part('frame', 0.09, [29, 20, 22], 'wood')]),
  'b-arm-white-leather': q('armchair', [part('upholstery', 0.93, [79, -1, 8], 'leather'), part('metal', 0.07, [15, 0, 0], 'metal')]),
  'c-arm-tan-leather': q('armchair', [part('upholstery', 0.9, [58, 25, 40], 'leather'), part('frame', 0.1, [60, 10, 30], 'wood')]),
  'arm-red-qc': q('armchair', [part('upholstery', 1, [45, 50, 35], 'fabric')]),
  'arm-tall': q('armchair', [part('upholstery', 1, [63, 0, 1], 'fabric')]),
  // Phòng ngủ / bàn ăn.
  'bed-a': q('doubleBed', [part('bedding', 0.6, [85, 0, 3], 'fabric'), part('frame', 0.4, [60, 8, 25], 'wood')]),
  'bed-b': q('doubleBed', [part('bedding', 0.6, [80, 2, 10], 'fabric'), part('frame', 0.4, [40, 12, 20], 'wood')]),
  'ns-a': q('nightstand', [part('frame', 1, [60, 8, 25], 'wood')]),
  'ns-b': q('nightstand', [part('frame', 1, [35, 10, 15], 'wood')]),
  'cl-a': q('closet', [part('frame', 1, [62, 8, 24], 'wood')]),
  'cl-b': q('closet', [part('frame', 1, [85, 0, 2], 'wood')]),
  'tb-a': q('diningTable', [part('top', 1, [62, 8, 24], 'wood')]),
  'ch-a': q('diningChair', [part('frame', 1, [62, 8, 24], 'wood')]),
  'ch-b': q('diningChair', [part('upholstery', 1, [55, 30, 45], 'fabric')]),
  // Đồ ngoài bộ màu lạ (kệ TV đỏ): không được làm đổi phòng ngủ / bàn ăn.
  'tv-red': q('tvStand', [part('frame', 1, [45, 50, 35], 'wood')]),
  'tv-tan': q('tvStand', [part('frame', 1, [58, 25, 40], 'wood')]),
};
const DIMS: Record<string, Dims> = {};
for (const k of Object.keys(Q)) DIMS[k] = Q[k]?.role === 'sofa' ? [2.0, 0.85, 0.9] : [0.8, 0.85, 0.8];
DIMS['arm-tall'] = [0.8, 1.2, 0.8];
// Hạng phong cách: ứng viên hợp bộ đắt hơn chút theo luật cũ, để test phân biệt có/không chấm hợp bộ (tiers 5 → hạng/6).
const TIER: Record<string, number> = { 'b-arm-white-leather': 2, 'c-arm-tan-leather': 2, 'b-sofa-cream': 1, 'b-sofa-brown-leather': 1 };
const ctx: SetContext = { tierOf: (id) => TIER[id] ?? 0, tiers: 5, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => Q[id] };

const mem = (id: string, role: string, pool: string[], extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: 3,
  long: 3,
  current: pool[0] ?? null,
  pool,
  fixed: false,
  ...extra,
});
const pin = (id: string, role: string, folder: string): SetMember => mem(id, role, [], { current: folder, fixed: true });
const run = (members: SetMember[], zones: SetZone[] = []) => roomSetOf('room', members, new Map(), ctx, zones);
const zone = (folder: string): SetZone => ({ cx: 9, cy: 9, w: 0.5, d: 0.5, rotationDeg: 0, folder });

describe('roomSetOf — hợp bộ phòng khách (vòng 17)', () => {
  it('T1: ghế bành bên sofa da cam không ra vải xám; concept thiếu dữ liệu chất lượng không quay lại', () => {
    const arm = mem('arm', 'armchair', ['a-arm-grey', 'b-arm-white-leather', 'c-arm-tan-leather'], { concept: { folder: 'rocker-no-quality' } });
    const d = run([pin('sofa', 'sofa', 'sofa-orange-leather'), arm]).get('arm');
    expect(d?.to).not.toBe('a-arm-grey');
    expect(['b-arm-white-leather', 'c-arm-tan-leather']).toContain(d?.to);
    expect(d?.cause).toBe('selector');
  });

  it('T2: neo chọn khi phòng chưa chốt gì — concept bàn ăn gỗ sồi còn giữ làm bảng màu → sofa kem, không xám', () => {
    const sofa = mem('sofa', 'sofa', ['a-sofa-grey', 'b-sofa-cream'], { concept: { folder: 'sofa-white', reject: 'méo dáng' } });
    const table = mem('table', 'diningTable', ['oak'], { concept: { folder: 'oak' } });
    const out = run([sofa, table]);
    expect(out.get('sofa')?.to).toBe('b-sofa-cream');
    expect(out.get('table')?.cause).toBe('concept');
  });

  it('T3: sofa thứ hai theo bộ da nâu đã ghim (cùng chất liệu, cùng tông) thay vì vải kem', () => {
    const second = mem('sofa2', 'sofa', ['a-sofa-cream-fabric', 'b-sofa-brown-leather']);
    const d3 = run([pin('sofa1', 'sofa', 'sofa-brown-leather'), second]).get('sofa2');
    expect(d3?.to).toBe('b-sofa-brown-leather');
  });

  it('T4: concept bị loại (QC) không góp màu vào bảng màu bộ và không thành `to`', () => {
    const base = [pin('sofa', 'sofa', 'sofa-cream-fabric')];
    const pool = ['a-arm-grey', 'arm-red-qc'];
    const withQc = run([...base, mem('arm', 'armchair', pool, { concept: { folder: 'arm-red-qc', reject: 'có lỗi QC' } })]).get('arm');
    const without = run([...base, mem('arm', 'armchair', pool.slice(0, 1).concat('arm-red-qc'))]).get('arm');
    expect(withQc?.to).toBe(without?.to);
    expect(withQc?.cost).toBe(without?.cost);
    expect(withQc?.cause).not.toBe('concept');
  });

  it('T5: phòng ngủ và nhóm ghế ăn không đổi khi bảng màu bộ có thêm đồ ngoài bộ màu lạ', () => {
    const bedroom = (): SetMember[] => [
      mem('bed', 'doubleBed', ['bed-a', 'bed-b']),
      mem('ns', 'nightstand', ['ns-a', 'ns-b']),
      mem('cl', 'closet', ['cl-a', 'cl-b']),
    ];
    const strip = (m: Map<string, { to: string | null; cost?: number }>) => [...m].map(([id, d]) => [id, d.to, d.cost]);
    expect(strip(run(bedroom(), [zone('tv-red')]))).toEqual(strip(run(bedroom())));
    const box = (cx: number) => ({ cx, cy: 1, w: 0.5, d: 0.5, rot: 0 });
    const dining = (): SetMember[] => [
      pin('sofa', 'sofa', 'sofa-orange-leather'),
      mem('tb', 'diningTable', ['tb-a'], { box: { cx: 1, cy: 1, w: 1.2, d: 0.8, rot: 0 } }),
      mem('c1', 'diningChair', ['ch-a', 'ch-b'], { box: box(0.2) }),
      mem('c2', 'diningChair', ['ch-a', 'ch-b'], { box: box(1.8) }),
    ];
    expect(strip(run(dining(), [zone('tv-red')]))).toEqual(strip(run(dining(), [zone('tv-tan')])));
  });

  it('T6: sofa kem → ghế bành vải xám vẫn được chọn (lệch nhỏ)', () => {
    const arm = mem('arm', 'armchair', ['a-arm-grey', 'c-arm-tan-leather']);
    expect(run([pin('sofa', 'sofa', 'sofa-cream-fabric'), arm]).get('arm')?.to).toBe('a-arm-grey');
  });

  it('L3: ghế bành cao hơn sofa ×1,1 bị phạt tỉ lệ (chi phí, không loại)', () => {
    const arm = mem('arm', 'armchair', ['arm-tall']);
    const tall = run([pin('sofa', 'sofa', 'sofa-cream-fabric'), arm]).get('arm');
    expect(tall?.to).toBe('arm-tall');
    const ln = Math.log(1.2 / 0.85 / 1.1);
    const alone = run([mem('arm', 'armchair', ['arm-tall'])]).get('arm');
    expect((tall?.cost ?? 0) - (alone?.cost ?? 0)).toBeGreaterThanOrEqual(ln - 1e-9);
  });
});
