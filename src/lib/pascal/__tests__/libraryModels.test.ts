/**
 * Tự bày đồ dùng mẫu đẹp của thư viện máy chủ (khi đã nạp) thay mẫu Pascal low-poly cùng loại,
 * và đồ sinh ra đứng sàn không bao giờ chồng khung bao lên nhau (trừ đồ trang trí nâng lên mặt bàn).
 */
import { describe, expect, it } from 'vitest';

import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';

import { fixtureF1, fixtureF2, fixtureF5 } from '../__fixtures__';
import { registerServerLibrary } from '../furnitureCatalog';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
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
  it('chưa nạp thư viện: giữ mẫu Pascal; đã nạp: cả căn theo phong cách, rồi màu dịu, rồi vừa cỡ', () => {
    const sofa = piece('S', 'sofa', 0, 2000, 900);
    expect(modelFolderOf(sofa, style, 'livingRoom')).toBe('sofa');
    const models = LIBRARY.models as Record<string, { s: string[]; c: number }>;
    const ofStyle = (code: string) => LIBRARY.roles.sofa.filter((id) => models[id]?.s.includes(code));
    const [japandi] = ofStyle('japandi') as [string];
    const [lux] = ofStyle('modern-lux').filter((id) => !models[id]?.s.includes('japandi')) as [string];
    const huge = LIBRARY.roles.sofa.find((id) => id !== japandi && id !== lux) as string;
    registerServerLibrary(
      [japandi, lux, huge].map((id, i) => ({
        id,
        widthMm: i === 2 ? 4000 : 2050,
        heightMm: 800,
        depthMm: i === 2 ? 2000 : 920,
        modelUrl: `https://x.test/${id}.glb`,
        attribution: 'a · CC0',
      })),
    );
    expect(modelFolderOf(sofa, { ...style, libraryStyles: ['japandi'] }, 'livingRoom')).toBe(japandi);
    expect(modelFolderOf(sofa, { ...style, libraryStyles: ['modern-lux'] }, 'livingRoom')).toBe(lux);
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
