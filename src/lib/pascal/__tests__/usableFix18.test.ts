/**
 * F9 (vòng 18) — hai lỗi P1 Codex M18-6 (F:/runs/m18/codex/M18-6.out), tái hiện đúng kịch bản.
 * 1) Dải lối cửa rộng bỏ qua tường: phòng 5 × 4 m, cửa đáy x = 1–3,4, tường trong x = 2,12–5 / y = 0,45–0,65, sofa
 *    2 × 0,9 tâm (1,11; 0,56) che dải trái → trước được nhận, sổ lỗi rỗng dù lối từ cửa bị cắt. Sau: tường tính là vật che
 *    dải lối; BFS gieo từ chính ô cửa (không từ cả vùng trước cửa, vốn có ô nằm sau tường).
 * 2) Sofa thẳng không phòng lọt luật cũ: hộp AI 2,2 × 0,9, không roomId, prefer rỗng, thư viện chỉ có mẫu L
 *    `sofa-sectional-light-grey-chaise-a67` → trước ra mẫu L, sau ra mẫu dựng sẵn 'sofa'. Hộp góc vẫn ra mẫu L.
 * Vùng sử dụng/lối đi là TIÊU CHÍ BỐ TRÍ, không phải quy chuẩn xây dựng.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { Furniture, Point } from '@/domain/spatial/types';

import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import { layoutIssuesOf, searchPlacement, type Block, type LayoutRoom, type Piece } from '../layoutSearch';
import type { Rect } from '../placement';
import { sceneStyleOf } from '../sceneStyles';
import { modelFolderOf } from '../sceneVariety';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Phòng 5 × 4 m, tường 0,2 m mọi cạnh, cửa rộng trên tường dưới x = 1–3,4, cộng tường trong `extra`. */
const room = (extra: readonly Block[]): LayoutRoom => {
  const [W, H, from, to] = [5, 4, 1.0, 3.4];
  const outline: Point[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % 4] as Point;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
    const e = { x: (b.x - a.x) / lengthM, y: (b.y - a.y) / lengthM };
    return { a, b, lengthM, e, inward: { x: -e.y, y: e.x }, wallHalfM: HALF, walled: [{ from: 0, to: lengthM }], openings: i === 0 ? [{ from, to }] : [] };
  });
  const walls: Block[] = edges.map((g) => ({
    ...rect((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2, g.lengthM + 2 * HALF, 2 * HALF, (Math.atan2(g.e.y, g.e.x) * 180) / Math.PI),
    origin: 'wall',
  }));
  return {
    id: 'R',
    outline,
    edges: edges.map(({ a, b, lengthM, inward, wallHalfM, walled, openings }) => ({ a, b, lengthM, inward, wallHalfM, walled, openings })),
    doors: [{ at: { x: (from + to) / 2, y: 0 }, inward: { x: 0, y: 1 }, widthM: to - from, wallHalfM: HALF }],
    blocks: [...walls, ...extra],
  };
};
const INNER: Block = { ...rect((2.12 + 5) / 2, 0.55, 5 - 2.12, 0.2), origin: 'wall' };
const SOFA: Piece = { id: 'S', role: 'sofa', dims: [2, 0.8, 0.9], box: rect(1.11, 0.56, 2, 0.9), wallBack: true, movable: false };
const CAB: Piece = { id: 'C', role: 'cabinet', dims: [2, 0.8, 0.9], box: rect(1.11, 0.56, 2, 0.9), wallBack: true, movable: false };

describe('F9 P1-1: dải lối cửa rộng tính cả tường, lối gieo từ ô cửa', () => {
  it('không tường trong: sofa che dải trái, dải phải còn trống → vẫn đặt được (hành vi LD giữ)', () => {
    const res = searchPlacement(room([]), SOFA, [{ modelId: 'sofa-a', dims: SOFA.dims }], []);
    expect('pose' in res, JSON.stringify('unplaced' in res ? res.unplaced : null)).toBe(true);
  });

  it('tường trong che dải giữa + phải, sofa che dải trái → từ chối', () => {
    const res = searchPlacement(room([INNER]), SOFA, [{ modelId: 'sofa-a', dims: SOFA.dims }], []);
    expect('unplaced' in res).toBe(true);
  });

  it('món phụ (không bắt buộc lối) cũng bị từ chối: lý do "chạm vùng trước cửa"', () => {
    const res = searchPlacement(room([INNER]), CAB, [{ modelId: 'cab-a', dims: CAB.dims }], []);
    expect('unplaced' in res).toBe(true);
    if ('unplaced' in res) expect(res.unplaced.reason).toContain('vùng trước cửa');
  });

  it('sổ lỗi: có lỗi chặn cửa (swing) và mất lối (access); không tường trong → sổ rỗng', () => {
    const kinds = layoutIssuesOf(room([INNER]), [{ id: 'S', role: 'sofa', rect: SOFA.box }]).map((i) => i.kind);
    expect(kinds).toContain('swing');
    expect(kinds).toContain('access');
    expect(layoutIssuesOf(room([]), [{ id: 'S', role: 'sofa', rect: SOFA.box }])).toEqual([]);
  });
});

describe('F9 P1-2: lọc dáng L ở đường chọn tự động dùng chung (món không phòng)', () => {
  const L = 'sofa-sectional-light-grey-chaise-a67';
  const style = sceneStyleOf(undefined);
  afterEach(() => clearServerLibrary());
  const register = (): void => {
    clearServerLibrary();
    registerServerLibrary([{ id: L, widthMm: 2400, heightMm: 850, depthMm: 1700, modelUrl: `https://x.test/${L}.glb`, attribution: 'a · CC0' }]);
  };
  const sofa = (id: string, w: number, d: number, reviewed = false): Furniture =>
    ({
      id,
      levelId: 'L-1',
      kind: 'chair',
      centre: { x: 0, y: 0 },
      boundingBox: { min: { x: -w / 2, y: -d / 2 }, max: { x: w / 2, y: d / 2 } },
      rotationDeg: 0,
      heightMm: 850,
      source: 'ai',
      reviewed,
      confidence: 1,
    }) as Furniture;

  it('hộp thẳng 2,2 × 0,9 AI chưa xác nhận, không phòng, thư viện chỉ có mẫu L → mẫu dựng sẵn "sofa"', () => {
    register();
    expect(style.prefer.sofa ?? []).toEqual([]);
    expect(modelFolderOf(sofa('S1', 2200, 900), style, 'livingRoom')).toBe('sofa');
  });

  // CORNER_SOFA_PREFER TẮT: hộp góc cũng KHÔNG nhận mẫu L ở đường luật cũ (xem roomSet.ts, chấm mù vòng 18).
  it('hộp góc 2,2 × 1,6 AI chưa xác nhận, không phòng → KHÔNG nhận mẫu L', () => {
    register();
    expect(modelFolderOf(sofa('S2', 2200, 1600), style, 'livingRoom')).not.toBe(L);
  });

  it('hộp góc của món người dùng đã xác nhận → không nhận mẫu L', () => {
    register();
    expect(modelFolderOf(sofa('S3', 2200, 1600, true), style, 'livingRoom')).not.toBe(L);
  });

  it('mẫu concept dáng L ở hộp thẳng (đường luật cũ) → không chọn', () => {
    register();
    const withConcept = { ...style, prefer: { ...style.prefer, sofa: [L] } };
    expect(modelFolderOf(sofa('S4', 2200, 900), withConcept, 'livingRoom')).not.toBe(L);
  });
});
