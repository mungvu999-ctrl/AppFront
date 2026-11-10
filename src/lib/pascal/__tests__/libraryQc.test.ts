/**
 * Kiểm chất lượng thư viện (`libraryQc.json`): mẫu lỗi thật không được chọn TỰ ĐỘNG (luật thư viện, mẫu AI chọn),
 * mẫu thay là ứng viên kế tiếp theo xếp hạng sẵn có; món người dùng đã chỉ định giữ nguyên; QC rỗng = như trước.
 */
import { describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { registerServerLibrary } from '../furnitureCatalog';
import QC from '../libraryQc.json' with { type: 'json' };
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { sceneStyleOf } from '../sceneStyles';
import { libraryQcSwaps, modelFolderOf } from '../sceneVariety';
import { toPascalScene } from '../toPascal';
import type { PascalItemNode } from '../types';

const BAD = 'table-nightstand-walnut';
const models = LIBRARY.models as Record<string, { s: string[] }>;
const wanted = models[BAD]?.s[0] ?? 'zz-none';
// Hai mẫu cùng vai, không trùng mã phong cách của mẫu xấu → mẫu xấu đứng đầu xếp hạng khi chưa lọc.
const [alt1, alt2] = LIBRARY.roles.nightstand.filter((id) => id !== BAD && !(models[id]?.s ?? []).includes(wanted)) as [
  string,
  string,
];
const base = sceneStyleOf(undefined);
const style = { ...base, libraryStyles: [wanted] };
const register = (ids: readonly string[], reg = registerServerLibrary) =>
  reg(ids.map((id) => ({ id, widthMm: 450, heightMm: 550, depthMm: 400, modelUrl: `https://x.test/${id}.glb`, attribution: 'a · CC0' })));
const stand = (id: string): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId: 'R-1',
    kind: 'table',
    centre: { x: 0, y: 0 },
    boundingBox: { min: { x: -225, y: -200 }, max: { x: 225, y: 200 } },
    rotationDeg: 0,
    heightMm: 550,
    source: 'ai',
    reviewed: false,
    confidence: 1,
  }) as Furniture;

describe('libraryQc — loại mẫu lỗi khỏi chọn tự động', () => {
  it('tệp QC có mẫu xấu, mẫu ấy thuộc vai nightstand', () => {
    expect(Object.keys(QC.excluded)).toContain(BAD);
    expect(LIBRARY.roles.nightstand).toContain(BAD);
  });

  it('vai chỉ còn mẫu bị loại → giữ hành vi cũ (không có gì thay)', () => {
    register([BAD]);
    expect(modelFolderOf(stand('N0'), style, 'bedroom')).toBe(BAD);
    expect(libraryQcSwaps().has('N0')).toBe(false);
  });

  it('mẫu bị loại không được tự chọn; thay bằng ứng viên kế tiếp, xác định; có ghi nhận', () => {
    register([alt1, alt2]);
    const pick = modelFolderOf(stand('N1'), style, 'bedroom');
    expect(pick).not.toBe(BAD);
    expect([alt1, alt2]).toContain(pick);
    expect(modelFolderOf(stand('N1'), style, 'bedroom')).toBe(pick);
    expect(libraryQcSwaps().get('N1')).toEqual({ from: BAD, to: pick, role: 'nightstand' });
  });

  it('mẫu AI chọn bị loại → mẫu hợp lệ cùng vai, có ghi nhận', () => {
    const ai = { ...base, prefer: { ...base.prefer, nightstand: [BAD] } };
    const pick = modelFolderOf(stand('N2'), ai, 'bedroom');
    expect(pick).not.toBe(BAD);
    expect(libraryQcSwaps().get('N2')?.from).toBe(BAD);
  });

  it('món người dùng đã chỉ định mẫu bị loại → giữ nguyên', () => {
    const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
    const [first] = graph.furniture as [Furniture];
    const model = { id: BAD, src: `/items/${BAD}/model.glb` };
    const withModel = { ...graph, furniture: graph.furniture.map((f) => (f.id === first.id ? { ...f, model } : f)) };
    const node = toPascalScene(withModel, { furnish: 'on' }).scene.nodes[`item_${first.id}`] as PascalItemNode;
    // Mẫu máy chủ đã nạp: src đổi sang URL tệp của CHÍNH mẫu ấy — không bị thay mẫu khác.
    expect(node.asset.src).toContain(BAD);
  });

  it('QC rỗng → kết quả y như không có bộ lọc', async () => {
    vi.resetModules();
    vi.doMock('../libraryQc.json', () => ({ default: { rev: 1, generatedFrom: 'test', excluded: {} } }));
    const catalog = await import('../furnitureCatalog');
    const variety = await import('../sceneVariety');
    register([BAD, alt1, alt2], catalog.registerServerLibrary);
    expect(variety.modelFolderOf(stand('N3'), style, 'bedroom')).toBe(BAD);
    expect(variety.libraryQcSwaps().size).toBe(0);
    vi.doUnmock('../libraryQc.json');
  });

  it('danh sách AI có mẫu bị loại: món băm vào mẫu tốt giữ đúng mẫu, chỉ món băm vào mẫu bị loại đổi sang mẫu tốt của danh sách', async () => {
    const load = async () => {
      const catalog = await import('../furnitureCatalog');
      const variety = await import('../sceneVariety');
      register([BAD, alt1, alt2], catalog.registerServerLibrary);
      return variety;
    };
    vi.resetModules();
    vi.doMock('../libraryQc.json', () => ({ default: { rev: 1, generatedFrom: 'test', excluded: {} } }));
    const off = await load();
    vi.doUnmock('../libraryQc.json');
    vi.resetModules();
    const on = await load();
    const ai = { ...base, prefer: { ...base.prefer, nightstand: [alt1, alt2, BAD] } };
    const items = Array.from({ length: 24 }, (_, i) => ({ ...stand(`P${i}`), roomId: `R-${i}` }) as Furniture);
    let kept = 0;
    let swapped = 0;
    for (const f of items) {
      const before = off.modelFolderOf(f, ai, 'bedroom');
      const after = on.modelFolderOf(f, ai, 'bedroom');
      if (before === BAD) {
        swapped++;
        expect([alt1, alt2]).toContain(after);
        expect(on.libraryQcSwaps().get(f.id)).toEqual({ from: BAD, to: after, role: 'nightstand' });
      } else {
        kept++;
        expect(after).toBe(before);
        expect(on.libraryQcSwaps().has(f.id)).toBe(false);
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(swapped).toBeGreaterThan(0);
    // Danh sách [tốt, bị loại]: luôn ra mẫu tốt của danh sách, không rơi sang luật thư viện.
    const pair = { ...base, prefer: { ...base.prefer, nightstand: [alt1, BAD] } };
    for (const f of items) expect(on.modelFolderOf(f, pair, 'bedroom')).toBe(alt1);
    // Lượt dựng cảnh mới (`contextRolesOf` — điểm vào của `toPascalScene`) xoá sổ thay của lượt trước.
    expect(on.libraryQcSwaps().size).toBeGreaterThan(0);
    on.contextRolesOf([], () => undefined);
    expect(on.libraryQcSwaps().size).toBe(0);
  });
});
