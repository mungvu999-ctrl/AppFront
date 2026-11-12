/**
 * Vòng 17 — món CỠ THẬT (`uniform: 'real'`, phương án cuối roomSet): không kẹp về hộp AI (Codex M17-1 #1); áp lưng tường
 * qua `asset.offset` không làm món nhảy sau nhận-một-món / lưu-tải lại (Codex M17-1 #5).
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { createPascalEditCommand } from '../fromPascal';
import { CATALOG_MODELS } from '../furnitureCatalog';
import { itemFitOf } from '../itemFit';
import { adoptedFurnitureIdOf } from '../sceneDressing';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalScene } from '../types';

/** Bàn làm việc sinh (hộp 1,2 × 0,6 m, mẫu ~1,51 × 0,62 m) dựng CỠ THẬT, vai tựa tường — dựng tay, không phụ thuộc lượt chọn mẫu của roomSet. */
const REAL = vi.hoisted(() => ({ on: false, sofa: false }));
/** Sofa AI thường (không phải món sinh / cặp nhận) dựng CỠ THẬT (Codex M17-2 #3). */
const AI_SOFA = 'F-00000AISOFA7';
vi.mock('../sceneVariety', async (importOriginal) => {
  const real = await importOriginal<{ roomSetUniformOf: (id: string, folder: string) => boolean | 'real' }>();
  return { ...real, roomSetUniformOf: (id: string, folder: string) => ((REAL.on && id.startsWith('DRESS-desk-')) || (REAL.sofa && id === AI_SOFA) ? 'real' : real.roomSetUniformOf(id, folder)) };
});
vi.mock('../libraryQuality', async (importOriginal) => {
  const real = await importOriginal<{ qualityOf: (id: string) => unknown }>();
  return { ...real, qualityOf: (id: string) => real.qualityOf(id) ?? (REAL.on ? { role: 'doubleBed' } : undefined) };
});

describe('itemFitOf cỡ thật', () => {
  it('mẫu dựng sẵn (không dữ liệu chất lượng) áp lưng tường theo vai hiệu lực — Codex M17-3 #2', () => {
    const cd = CATALOG_MODELS['sofa']?.dimensions[2] ?? 0;
    const fit = itemFitOf('sofa', 1.4, 0.5, undefined, 2700, false, 'real', 'sofa');
    expect(fit?.backShiftM).toBeCloseTo(-(0.5 - cd) / 2, 6);
    expect(itemFitOf('sofa', 1.4, 0.5, undefined, 2700, false, 'real')?.backShiftM ?? 0).toBe(0);
  });
  it('#1: hộp AI nhỏ không bóp món cỡ thật (chỉ trần chặn)', () => {
    const [cw, ch, cd] = CATALOG_MODELS['sofa']?.dimensions ?? [0, 0, 0];
    const fit = itemFitOf('sofa', 0.36, 0.41, undefined, 2700, false, 'real');
    expect(fit?.shownM[0]).toBeCloseTo(cw, 6);
    expect(fit?.shownM[1]).toBeCloseTo(ch, 6);
    expect(fit?.shownM[2]).toBeCloseTo(cd, 6);
    // Trần thấp vẫn chặn đều cả ba trục.
    const low = itemFitOf('sofa', 0.36, 0.41, undefined, ch * 500, false, 'real');
    expect(low?.shownM[0]).toBeCloseTo(cw * 0.5, 6);
    // Không phải 'real': vẫn kẹp trong hộp.
    expect(itemFitOf('sofa', 0.36, 0.41, undefined, 2700, false, true)?.shownM[0]).toBeLessThanOrEqual(0.36 + 1e-9);
  });
});

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const ROOM = 'R-0000000REAL7';
const LVL = 'L-0000000REAL7';
const DRESS = `DRESS-desk-${ROOM}`;
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const bedroom = (): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-00000REAL7${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room],
    furniture: [],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

const style: LayerStyle = { ...sceneStyleOf(undefined), roomSet: false, layout: new Set() };
const sceneOf = (graph: SpatialGraph): PascalScene => standardSceneOf(graph, { style }).scene;
interface Change {
  readonly kind: string;
  readonly before?: unknown;
  readonly after?: unknown;
}
const apply = (graph: SpatialGraph, changes: readonly Change[]): SpatialGraph =>
  changes.reduce((g, c) => {
    const after = c.after as { id: string } | null;
    const id = (after ?? (c.before as { id: string })).id;
    if (c.kind === 'room') return { ...g, rooms: g.rooms.map((r) => (r.id === id ? (after as Room) : r)) };
    return { ...g, furniture: [...g.furniture.filter((f) => f.id !== id), ...(after === null ? [] : [after as Furniture])] };
  }, graph);
const commit = (graph: SpatialGraph, scene: PascalScene, changed: readonly string[]): readonly Change[] => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...changed] }, actorId: 'U-1', idBook: new Map() });
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  return result.data.changes as readonly Change[];
};
/** Tâm NHÌN THẤY của mẫu trên mặt bằng, m: vị trí node + R_y(yaw)·(`asset.offset` × `node.scale`). */
const seenCentre = (n: PascalItemNode): [number, number] => {
  const [ox, , oz] = (n.asset.offset ?? [0, 0, 0]).map((v, i) => v * (n.scale[i] as number)) as [number, number, number];
  const yaw = n.rotation[1];
  return [n.position[0] + ox * Math.cos(yaw) + oz * Math.sin(yaw), n.position[2] - ox * Math.sin(yaw) + oz * Math.cos(yaw)];
};
const near = (a: [number, number], b: [number, number]): void =>
  a.forEach((v, i) => expect(Math.abs(v - (b[i] as number)) * 1000, `${a.join(',')} ≠ ${b.join(',')}`).toBeLessThanOrEqual(1));

describe('#5: món cỡ thật áp lưng tường — nhận / lưu-tải lại không nhảy', () => {
  for (const [what, dx, yaw, scale] of [
    ['dời 50 mm', 0.05, 0, [1, 1, 1]],
    ['xoay 90° + kéo sâu ×1,2', 0, Math.PI / 2, [1, 1, 1.2]],
  ] as const) {
    it(what, () => {
      REAL.on = true;
      try {
        const graph = bedroom();
        const scene = sceneOf(graph);
        const bed = scene.nodes[`item_${DRESS}`] as PascalItemNode;
        expect(bed).toBeDefined();
        const box = bed.asset.dimensions;
        // Mẫu sâu hơn hộp → áp lưng ≠ 0 (cỡ thật vượt hộp AI).
        const back = bed.metadata?.appfront?.fields?.['realBackShiftM'];
        expect(Math.abs(back as number), `hộp ${box.join('×')}`).toBeGreaterThan(0.005);
        const edited = {
          ...bed,
          position: [bed.position[0] + dx, bed.position[1], bed.position[2]],
          rotation: [0, bed.rotation[1] + yaw, 0],
          scale: [...scale],
        } as PascalItemNode;
        const before = seenCentre(edited);
        const changes = commit(graph, { ...scene, nodes: { ...scene.nodes, [bed.id]: edited } }, [bed.id]);
        const saved = apply(graph, changes);
        const reloaded = sceneOf(saved);
        const realId = `item_${adoptedFurnitureIdOf(DRESS)}`;
        const real = reloaded.nodes[realId] as PascalItemNode;
        near(seenCentre(real), before);
        expect(real.metadata?.appfront?.fields?.['realBackShiftM']).toBeUndefined();
        // Lưu lại đồ thật vừa tải (dời tiếp 10 mm): tâm đi đúng 10 mm, không trôi thêm.
        const nudged = { ...real, position: [real.position[0] + 0.01, real.position[1], real.position[2]] } as PascalItemNode;
        const again = sceneOf(apply(saved, commit(saved, { ...reloaded, nodes: { ...reloaded.nodes, [realId]: nudged } }, [realId])));
        near(seenCentre(again.nodes[realId] as PascalItemNode), [before[0] + 0.01, before[1]]);
      } finally {
        REAL.on = false;
      }
    });
  }
});

describe('Codex M17-2 #3: món AI thường dựng cỡ thật, người dùng co giãn → lưu-tải lại giữ cỡ hiển thị', () => {
  const withSofa = (): SpatialGraph => {
    const g = bedroom();
    const sofa = {
      source: 'ai',
      reviewed: false,
      confidence: 0.8,
      id: AI_SOFA,
      levelId: LVL,
      roomId: ROOM,
      kind: 'other',
      variant: 'sofa',
      centre: { x: 2500, y: 2000 },
      boundingBox: { min: { x: 2300, y: 1800 }, max: { x: 2700, y: 2200 } },
      rotationDeg: 0,
    } as unknown as Furniture;
    return { ...g, furniture: [sofa] };
  };
  const nodeId = `item_${AI_SOFA}`;
  /** Cỡ mặt bằng nhìn thấy [rộng, sâu] m: cỡ catalog × `asset.scale` (bỏ scale riêng của catalog) × `node.scale`. */
  const seenSize = (n: PascalItemNode, folder: string): [number, number] => {
    const cat = CATALOG_MODELS[folder]!;
    const s = n.asset.scale ?? [1, 1, 1];
    const k = cat.scale ?? [1, 1, 1];
    return [(cat.dimensions[0] * s[0] * n.scale[0]) / k[0], (cat.dimensions[2] * s[2] * n.scale[2]) / k[2]];
  };

  it('co giãn ×1,2 hai trục mặt bằng: tải lại đúng cỡ + tâm nhìn thấy (≤ 1 mm), mở không ghi, lưu lại không trôi', () => {
    REAL.sofa = true;
    try {
      const graph = withSofa();
      const scene = sceneOf(graph);
      const sofa = scene.nodes[nodeId] as PascalItemNode;
      const fit = sofa.metadata?.appfront?.fields?.['realFit'] as { folder: string; shownM: number[] } | undefined;
      expect(fit, 'món AI cỡ thật mang REAL_FIT_FIELD').toBeDefined();
      const folder = fit!.folder;
      // Cỡ thật vượt hộp AI 0,4 × 0,4 m.
      expect(seenSize(sofa, folder)[0]).toBeGreaterThan(0.8);
      // Mở không ghi: node chưa sửa không sinh thay đổi nào cho món.
      expect(() => commit(graph, scene, [nodeId])).toThrow(/không có gì để ghi/);

      const edited = { ...sofa, scale: [1.2, 1, 1.2] } as PascalItemNode;
      const before = { centre: seenCentre(edited), size: seenSize(edited, folder) };
      const saved = apply(graph, commit(graph, { ...scene, nodes: { ...scene.nodes, [nodeId]: edited } }, [nodeId]));
      const stored = saved.furniture.find((f) => f.id === AI_SOFA)!;
      expect(stored.model?.id).toBe('appfront-fit-other');
      const reloaded = sceneOf(saved);
      const real = reloaded.nodes[nodeId] as PascalItemNode;
      near(seenCentre(real), before.centre);
      near(seenSize(real, folder), before.size);
      // Tải lại rồi lưu không sửa: không thay đổi (không trôi, không đổi mẫu).
      expect(() => commit(saved, reloaded, [nodeId])).toThrow(/không có gì để ghi/);
      // Dời tiếp 10 mm: tâm đi đúng 10 mm, cỡ giữ nguyên.
      const nudged = { ...real, position: [real.position[0] + 0.01, real.position[1], real.position[2]] } as PascalItemNode;
      const again = sceneOf(apply(saved, commit(saved, { ...reloaded, nodes: { ...reloaded.nodes, [nodeId]: nudged } }, [nodeId]))).nodes[nodeId] as PascalItemNode;
      near(seenCentre(again), [before.centre[0] + 0.01, before.centre[1]]);
      near(seenSize(again, folder), before.size);
    } finally {
      REAL.sofa = false;
    }
  });
});
