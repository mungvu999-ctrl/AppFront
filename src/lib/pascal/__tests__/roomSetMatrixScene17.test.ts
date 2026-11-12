/**
 * Vòng 17 làn D — tương tác luật ở mức DỰNG CẢNH (harness như realFit17): bộ chọn bật (`roomSet: true`), phòng ngủ / phòng
 * khách trống được bày đồ sinh. Nhận MỘT món (sửa một món đồ sinh rồi lưu) → chỉ món đó có `model`; tải lại → mọi món giữ
 * cùng mẫu + cùng tâm hiển thị (≤ 1 mm); lưu lại không sửa → không ghi gì (không tự ghim món khác).
 */
import { describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { createPascalEditCommand } from '../fromPascal';
import { adoptedFurnitureIdOf } from '../sceneDressing';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalScene } from '../types';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-0000000MTX17';
const roomGraph = (usage: string, wMm: number, dMm: number): SpatialGraph => {
  const room = `R-0000MTX${usage === 'bedroom' ? 'B' : 'L'}${String(wMm).slice(0, 2)}7`;
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: wMm, y: 0 },
    { x: wMm, y: dMm },
    { x: 0, y: dMm },
  ];
  return {
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-0000MTX17${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: room, levelId: LVL, name: 'Phòng', usage, outline, areaM2: (wMm * dMm) / 1e6, wallIds: [] } as Room],
    furniture: [],
    axes: [],
    dimensions: [],
    notes: [],
  } as unknown as SpatialGraph;
};

const style: LayerStyle = { ...sceneStyleOf(undefined), roomSet: true, layout: new Set() };
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
const seenCentre = (n: PascalItemNode): [number, number] => {
  const [ox, , oz] = (n.asset.offset ?? [0, 0, 0]).map((v, i) => v * (n.scale[i] as number)) as [number, number, number];
  const yaw = n.rotation[1];
  return [n.position[0] + ox * Math.cos(yaw) + oz * Math.sin(yaw), n.position[2] - ox * Math.sin(yaw) + oz * Math.cos(yaw)];
};
const items = (scene: PascalScene): PascalItemNode[] =>
  Object.values(scene.nodes).filter((n): n is PascalItemNode => (n as { type?: string }).type === 'item');
const generated = (scene: PascalScene): PascalItemNode[] => items(scene).filter((n) => n.id.startsWith('item_DRESS-'));

describe('vòng 17 làn D — nhận một món / lưu-tải lại (bộ chọn bật)', () => {
  for (const [usage, w, d] of [
    ['bedroom', 4000, 3500],
    ['bedroom', 2500, 3000],
    ['livingRoom', 6000, 5000],
  ] as const) {
    const gen0 = generated(sceneOf(roomGraph(usage, w, d)));
    it(`${usage} ${w}×${d}: có đồ sinh (${gen0.length})`, () => expect(gen0.length).toBeGreaterThan(0));
    for (const pick of gen0.map((n) => n.id)) {
      it(`${usage} ${w}×${d}: nhận ${pick.replace('item_', '')}`, () => {
        const graph = roomGraph(usage, w, d);
        const scene = sceneOf(graph);
        // Tất định: dựng hai lần cùng kết quả.
        expect(JSON.stringify(sceneOf(graph).nodes)).toBe(JSON.stringify(scene.nodes));
        const node = scene.nodes[pick] as PascalItemNode;
        const edited = { ...node, position: [node.position[0] + 0.05, node.position[1], node.position[2]] } as PascalItemNode;
        const before = { ...scene, nodes: { ...scene.nodes, [pick]: edited } };
        const saved = apply(graph, commit(graph, before, [pick]));
        const dressId = pick.replace('item_', '');
        const adopted = adoptedFurnitureIdOf(dressId);
        // Chỉ món được nhận có model; không món nào khác tự ghim.
        const withModel = saved.furniture.filter((f) => f.model !== undefined).map((f) => f.id);
        expect(withModel.filter((id) => id !== adopted), `món tự ghim: ${withModel.join(', ')}`).toEqual([]);
        const reloaded = sceneOf(saved);
        // Mọi món: cùng mẫu + cùng tâm hiển thị (món nhận dưới id thật).
        const errs: string[] = [];
        for (const n of items(before)) {
          const id = n.id === pick ? `item_${adopted}` : n.id;
          const r = reloaded.nodes[id] as PascalItemNode | undefined;
          if (r === undefined) {
            errs.push(`${id}: mất sau tải lại`);
            continue;
          }
          if (r.asset.src !== n.asset.src) errs.push(`${id}: mẫu ${n.asset.src} → ${r.asset.src}`);
          // Đồ trang trí của món được nhận (thảm dưới giường, đèn trên tủ đầu giường, bình trên bàn) đi theo chủ: dời đúng 50 mm.
          const follows = n.id !== pick && n.id.includes(`-${dressId}`);
          const [a, b] = [seenCentre(n), seenCentre(r)];
          // Đồ trang trí lớp bày (thảm phòng theo sofa, tranh tường theo giường — tranh kẹp trong nhịp tường ở phòng hẹp): được
          // theo chủ HOẶC đứng yên; mẫu vẫn phải giữ. Ngoài phạm vi bộ chọn (sceneDressing), ghi trong KET-QUA.
          const loose = /^item_DRESS-(rug|frame|throw|vase|tableLamp)-/.test(n.id);
          const gapOf = (dx: number): number => Math.hypot(a[0] + dx - b[0], a[1] - b[1]) * 1000;
          const gap = loose ? Math.min(gapOf(0), gapOf(0.05)) : gapOf(follows ? 0.05 : 0);
          if (gap > 1) errs.push(`${id}: tâm lệch ${gap.toFixed(2)} mm`);
        }
        expect(errs, errs.join('\n')).toEqual([]);
        // Lưu lại không sửa gì: không ghi (không tự ghim / không trôi).
        expect(() => commit(saved, reloaded, items(reloaded).map((n) => n.id))).toThrow(/không có gì để ghi/);
      });
    }
  }
});
