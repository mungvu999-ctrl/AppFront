/**
 * M18 LT4 — sổ bộ chọn (`at`/`to`) và node dựng KHÔNG BAO GIỜ lệch nhau. Trước đây phòng được lập lười ở món đầu tiên hỏi
 * mẫu (`modelFolderOf`, thường trong `itemNodeOf`), SAU khi món ấy đã áp tư thế (`layoutPlacedOf`) → món dựng ở hộp đã
 * lưu trong khi sổ ghi nó đã dời; anh em chọn trên giả định sai (7 va chạm mới set17/18). Phòng tổng hợp, không tên căn.
 */
import { describe, expect, it } from 'vitest';

import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { CATALOG_MODELS } from '../furnitureCatalog';
import { roomSetReport } from '../sceneVariety';
import { sceneStyleOf } from '../sceneStyles';
import { toPascalScene } from '../toPascal';
import type { PascalItemNode } from '../types';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.9 } as const;
const LVL = 'L-00000000LAG1';
const ROOM = 'R-00000000LAG1';
/** Phòng ngủ hẹp 2,83 × 3,30 m, tường 200 mm tâm trên outline. */
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 2830, y: 0 },
  { x: 2830, y: 3300 },
  { x: 0, y: 3300 },
];
const box = (cx: number, cy: number, w: number, d: number) => ({
  centre: { x: cx, y: cy },
  boundingBox: { min: { x: cx - w / 2, y: cy - d / 2 }, max: { x: cx + w / 2, y: cy + d / 2 } },
});
/** Giường đơn AI 0,70 × 1,71 m sát hai tường (giường thật 0,92 × 2,0 cắt tường tại chỗ → T1 dời) + tủ áo sát tường đối diện. */
const graphOf = (rotationDeg = 0): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 2700 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-0000000LAG${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng ngủ', usage: 'bedroom', outline, areaM2: 9.3, wallIds: [] } as Room],
    furniture: [
      { ...AI, id: 'F-0000000LAGBED', levelId: LVL, roomId: ROOM, kind: 'bed', rotationDeg, ...box(550, 955, 700, 1710) },
      { ...AI, id: 'F-0000000LAGWR1', levelId: LVL, roomId: ROOM, kind: 'wardrobe', rotationDeg: 0, ...box(2000, 2900, 1200, 600) },
    ] as unknown as Furniture[],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

/**
 * Tâm mặt bằng CỠ THẬT của mẫu, m: vị trí node + áp lưng tường (`realBackShiftM`, theo z cục bộ). `asset.offset` còn gồm độ
 * lệch gốc GLB của catalog (canh tâm hình) — không phải dời chỗ, nên không cộng.
 */
const seenCentre = (n: PascalItemNode): [number, number] => {
  const k = (n.metadata?.appfront?.fields?.['realBackShiftM'] as number | undefined) ?? 0;
  const yaw = n.rotation[1];
  return [n.position[0] + k * Math.sin(yaw), n.position[2] + k * Math.cos(yaw)];
};
const folderOf = (n: PascalItemNode): string | undefined => {
  const src = String(n.asset.src);
  return Object.keys(CATALOG_MODELS).find((f) => src.includes(`/${f}/`) || src.endsWith(`/${f}.glb`));
};

describe('sổ bộ chọn ↔ node: món đã dời dựng đúng tư thế cuối', () => {
  for (const rot of [0, 90]) {
    it(`mọi món có tư thế (at) dựng tại đúng tư thế ≤ 1 mm, cùng mẫu, hộp theo cạnh dài của mẫu (góc lưu ${rot}°)`, () => {
      const { scene } = toPascalScene(graphOf(rot), { style: sceneStyleOf(undefined) });
      const entries = Object.values(roomSetReport()).flatMap((r) => r.items);
      const moved = entries.filter((d) => d.at !== undefined && d.to !== null);
      // Tiền đề: kịch bản thật sự có món dời (không thì test rỗng).
      expect(moved.length, JSON.stringify(entries.map((d) => [d.id, d.to, d.why]))).toBeGreaterThan(0);
      for (const d of moved) {
        const n = scene.nodes[`item_${d.id}`] as PascalItemNode | undefined;
        expect(n, d.id).toBeDefined();
        const node = n as PascalItemNode;
        const at = d.at as NonNullable<typeof d.at>;
        const [x, y] = seenCentre(node);
        expect(Math.hypot(x - at.cx, y - at.cy) * 1000, `${d.id} node (${x},${y}) ≠ sổ (${at.cx},${at.cy})`).toBeLessThanOrEqual(1);
        // Góc: node quay đúng góc sổ (yaw = −rot).
        const rotOf = (r: number) => ((Math.round((-r * 180) / Math.PI) % 360) + 360) % 360;
        expect(rotOf(node.rotation[1]), d.id).toBe(((at.rot % 360) + 360) % 360);
        // Mẫu + cỡ: đúng mẫu sổ, dựng cỡ thật (asset.scale 1) → mặt bằng thấy = cỡ catalog của `to`.
        expect(folderOf(node), d.id).toBe(d.to);
        for (const s of node.asset.scale ?? [1, 1, 1]) expect(s).toBeCloseTo(1, 6);
        // Hộp (khung chọn, lượt lưu) cùng hướng với mẫu: cạnh dài hộp theo cạnh dài mẫu.
        const dims = CATALOG_MODELS[d.to as string]?.dimensions as readonly number[];
        const [bw, , bd] = node.asset.dimensions;
        expect(bw >= bd, `${d.id} hộp ${bw}×${bd} vs mẫu ${dims[0]}×${dims[2]}`).toBe((dims[0] as number) >= (dims[2] as number));
      }
      // Không có cặp chồng nhau MỚI do luật (so hình học đã lưu).
      const ruleOverlaps = entries.flatMap((d) => (d.layout ?? []).filter((i) => i.origin === 'rule' && i.with !== undefined));
      expect(ruleOverlaps).toEqual([]);
    });
  }
});
