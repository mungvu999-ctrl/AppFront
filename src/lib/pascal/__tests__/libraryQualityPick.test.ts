/**
 * Vòng 13: luật thư viện (mọi món chưa gán mẫu, kể cả đồ AI đã xác nhận) không tự chọn giường dưới chuẩn hoàn thiện
 * (`libraryQuality.json`: completeness ≠ full) khi vai còn giường đủ chăn gối; vai hết giường đạt thì giữ hành vi cũ.
 */
import { describe, expect, it } from 'vitest';

import type { Furniture } from '@/domain/spatial/types';

import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import { LIBRARY_QUALITY } from '../libraryQuality';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { sceneStyleOf } from '../sceneStyles';
import { libraryQcSwaps, modelFolderOf } from '../sceneVariety';

const beds = LIBRARY.roles.doubleBed as string[];
const v = (id: string) => LIBRARY_QUALITY.models[id]?.completeness?.v;
const register = (ids: readonly string[]) => {
  clearServerLibrary();
  registerServerLibrary(ids.map((id) => ({ id, widthMm: 1600, heightMm: 1000, depthMm: 2000, modelUrl: `https://x.test/${id}.glb`, attribution: 'a · CC0' })));
};
const bed = (id: string): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId: 'R-1',
    kind: 'bed',
    centre: { x: 0, y: 0 },
    boundingBox: { min: { x: -800, y: -1000 }, max: { x: 800, y: 1000 } },
    rotationDeg: 0,
    heightMm: 1000,
    source: 'ai',
    reviewed: true,
    confidence: 1,
  }) as Furniture;

describe('luật thư viện — giường dưới chuẩn hoàn thiện', () => {
  const style = sceneStyleOf(undefined);
  it('dữ liệu có cả giường đủ chăn gối và giường chưa đủ', () => {
    expect(beds.some((id) => v(id) === 'full')).toBe(true);
    expect(beds.some((id) => v(id) !== undefined && v(id) !== 'full')).toBe(true);
  });

  it('cả vai giường đôi: mẫu chọn tự động luôn đủ chăn gối', () => {
    register(beds);
    const pick = modelFolderOf(bed('B1'), style, 'bedroom');
    expect(pick === null ? undefined : v(pick)).toBe('full');
  });

  it('chỉ còn giường chưa đủ → giữ hành vi cũ (không thay, không ghi nhận)', () => {
    const notFull = beds.filter((id) => v(id) !== undefined && v(id) !== 'full');
    register(notFull);
    const pick = modelFolderOf(bed('B2'), style, 'bedroom');
    expect(notFull).toContain(pick);
    expect(libraryQcSwaps().has('B2')).toBe(false);
  });
});
