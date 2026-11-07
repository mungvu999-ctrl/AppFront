/**
 * Tự bày đồ dùng mẫu đẹp của thư viện máy chủ (khi đã nạp) thay mẫu Pascal low-poly cùng loại,
 * và đồ sinh ra đứng sàn không bao giờ chồng khung bao lên nhau (trừ đồ trang trí nâng lên mặt bàn).
 */
import { describe, expect, it } from 'vitest';

import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';

import { fixtureF1, fixtureF2, fixtureF5 } from '../__fixtures__';
import { registerServerLibrary } from '../furnitureCatalog';
import LIBRARY_ROLES from '../libraryRoles.json' with { type: 'json' };
import { rectOfFurniture, rectsOverlap } from '../placement';
import { dressingOf } from '../sceneDressingRules';
import { furnishEmptyRooms } from '../sceneFurnish';
import { sceneStyleOf } from '../sceneStyles';
import { modelFolderOf, withoutOverlaps } from '../sceneVariety';
import { furnishingUsageOf } from '../structureFixes';

const style = sceneStyleOf(undefined);

const piece = (id: string, variant: Furniture['variant'], x: number, w: number, d: number, liftMm?: number): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId: 'R-1',
    kind: 'other',
    variant,
    ...(liftMm === undefined ? {} : { liftMm }),
    centre: { x, y: 0 },
    boundingBox: { min: { x: x - w / 2, y: -d / 2 }, max: { x: x + w / 2, y: d / 2 } },
    rotationDeg: 0,
    source: 'ai',
    reviewed: false,
    confidence: 1,
  }) as Furniture;

describe('mẫu thư viện cho đồ tự bày', () => {
  it('chưa nạp thư viện: giữ mẫu Pascal; đã nạp: sofa dùng mẫu thư viện vừa cỡ nhất', () => {
    const sofa = piece('S', 'sofa', 0, 2000, 900);
    expect(modelFolderOf(sofa, style, 'livingRoom')).toBe('sofa');
    const [near, far] = LIBRARY_ROLES.sofa as [string, string];
    registerServerLibrary([
      { id: near, widthMm: 2050, heightMm: 800, depthMm: 920, modelUrl: 'https://x.test/a.glb', attribution: 'a · CC0' },
      { id: far, widthMm: 3200, heightMm: 800, depthMm: 1600, modelUrl: 'https://x.test/b.glb', attribution: 'b · CC0' },
    ]);
    expect(modelFolderOf(sofa, style, 'livingRoom')).toBe(near);
  });

  it('bản vẽ mẫu, mọi phòng trống: đồ đứng sàn tự bày không chồng nhau, lưới chặn không phải bỏ món nào', () => {
    for (const fx of [fixtureF1({ ext: true }), fixtureF2(), fixtureF5()]) {
      const g0 = SpatialGraphDocumentSchema.parse(fx.doc).graph as unknown as SpatialGraph;
      const graph = { ...g0, furniture: [], rooms: g0.rooms.map((r) => ({ ...r, usage: furnishingUsageOf(r) })) };
      const furnished = furnishEmptyRooms(graph, style);
      const all = [...furnished, ...dressingOf({ ...graph, furniture: furnished }, style)];
      expect(withoutOverlaps(all, [])).toHaveLength(all.length);
    }
  });

  it('lưới chặn: bỏ món đứng sàn chồng lên đồ khác, giữ bình hoa nâng lên mặt bàn', () => {
    const table = piece('T', 'table', 0, 1400, 800);
    const chair = piece('C', 'chair', 300, 450, 450);
    const vase = piece('V', 'vase', 0, 200, 200, 750);
    const plant = piece('P', 'plant', 2000, 600, 600);
    const kept = withoutOverlaps([chair, vase, plant], [table]);
    expect(kept.map((f) => f.id)).toEqual(['V', 'P']);
    expect(rectsOverlap(rectOfFurniture(plant), rectOfFurniture(table))).toBe(false);
  });
});
