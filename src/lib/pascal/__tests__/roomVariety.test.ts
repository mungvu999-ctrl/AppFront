/**
 * Biến thể theo phòng + bộ ghế (`roomVariety.ts` + `sceneVariety.ts`, vòng 11 b1): không cờ = như cũ; tất định theo id
 * phòng; không chọn mẫu to hơn chỗ; ghế quanh một bàn một mẫu; đồ dò/người dùng giữ mẫu (trừ `varietyai`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Furniture, RoomUsage } from '@/domain/spatial/types';

import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { chairSetFolderOf, fitsSpot, roomVarietyPickOf, varietyFlagsOf, workChairsOf, type VarietyFlag } from '../roomVariety';
import { sceneStyleOf } from '../sceneStyles';
import { contextRolesOf, modelFolderOf, roomVarietyReport, type LayerStyle } from '../sceneVariety';

const roles = LIBRARY.roles as Record<string, string[]>;
// Cỡ mẫu (mm): giường đôi đủ cỡ, trừ MỘT mẫu quá to (2,4 × 2,6 m) để kiểm luật "không to hơn chỗ".
const BIG_BED = (roles.doubleBed ?? [])[1] as string;
const dimsOf = (role: string, id: string): [number, number, number] =>
  role === 'doubleBed' ? (id === BIG_BED ? [2400, 900, 2600] : [1600, 900, 2000]) : role === 'desk' ? [1200, 750, 600] : [450, 850, 450];

const base = sceneStyleOf(undefined);
const styleWith = (variety: VarietyFlag[]): LayerStyle => ({ ...base, libraryStyles: ['scandinavian'], rulesOff: new Set(), layout: new Set(), variety: new Set(variety) });

const piece = (id: string, roomId: string, kind: Furniture['kind'], x: number, y: number, w: number, d: number, extra: Partial<Furniture> = {}): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId,
    kind,
    centre: { x: x + w / 2, y: y + d / 2 },
    boundingBox: { min: { x, y }, max: { x: x + w, y: y + d } },
    rotationDeg: 0,
    heightMm: kind === 'bed' ? 500 : kind === 'table' ? 750 : 850,
    source: 'ai',
    reviewed: false,
    confidence: 0.9,
    ...extra,
  }) as Furniture;

const bedrooms = ['R-a', 'R-b', 'R-c', 'R-d', 'R-e', 'R-f'];
const genBeds = bedrooms.map((r) => piece(`DRESS-bed-${r}`, r, 'bed', 0, 0, 1600, 2000));
const detBeds = bedrooms.map((r) => piece(`F-bed-${r}`, r, 'bed', 0, 0, 1600, 2000));

beforeAll(() => {
  registerServerLibrary(
    ['doubleBed', 'desk', 'diningChair'].flatMap((role) =>
      (roles[role] ?? []).map((id) => {
        const [w, h, d] = dimsOf(role, id);
        return { id, widthMm: w, heightMm: h, depthMm: d, modelUrl: `https://x.test/${id}.glb` };
      }),
    ),
  );
});
afterAll(() => clearServerLibrary());

const picks = (items: readonly Furniture[], flags: VarietyFlag[], ctx: readonly Furniture[] = items, u: RoomUsage = 'bedroom') => {
  contextRolesOf(ctx, () => u);
  const style = styleWith(flags);
  return items.map((f) => modelFolderOf(f, style, u));
};

describe('roomVariety — hàm thuần', () => {
  it('cờ ?enable= bật, ?disable= tắt, giá trị lạ bỏ; mặc định rỗng', () => {
    expect([...varietyFlagsOf('?enable=roomvariety,chairset,xyz')].sort()).toEqual(['chairset', 'roomvariety']);
    expect(varietyFlagsOf('?enable=roomvariety&disable=roomvariety').size).toBe(0);
    expect([...varietyFlagsOf('?disable=chairset', new Set(['roomvariety', 'chairset']))]).toEqual(['roomvariety']);
    expect(varietyFlagsOf('').size).toBe(0);
  });

  it('không to hơn chỗ: từng cạnh ≤ hộp × 1,1', () => {
    expect(fitsSpot([1.6, 0.9, 2.0], 1.6, 2.0)).toBe(true);
    expect(fitsSpot([2.0, 0.9, 1.6], 1.6, 2.0)).toBe(true);
    expect(fitsSpot([2.4, 0.9, 2.6], 1.6, 2.0)).toBe(false);
  });

  it('rút tất định; lọc tông + họ màu của phòng, lọc rỗng thì bỏ lọc', () => {
    const cands = [
      { folder: 'a', t: 'l', h: 'cream' },
      { folder: 'b', t: 'd', h: 'grey' },
      { folder: 'c', t: 'l', h: 'green' },
      { folder: 'd', t: 'l', h: 'blue' },
    ];
    const one = roomVarietyPickOf(cands, 'R-1', 'doubleBed', 'l', ['green']);
    expect(one).toBe(roomVarietyPickOf(cands, 'R-1', 'doubleBed', 'l', ['green']));
    expect(['a', 'c']).toContain(one);
    expect(roomVarietyPickOf([{ folder: 'b', t: 'd' }], 'R-1', 'doubleBed', 'l', [])).toBe('b');
  });

  it('bộ ghế: mẫu phổ biến nhất của ghế cố định, không có thì ghế id nhỏ nhất', () => {
    expect(chairSetFolderOf([{ id: 'c', folder: 'x', fixed: true }, { id: 'a', folder: 'y', fixed: true }, { id: 'b', folder: 'x', fixed: true }, { id: 'd', folder: 'z', fixed: false }])).toBe('x');
    expect(chairSetFolderOf([{ id: 'b', folder: 'x', fixed: false }, { id: 'a', folder: 'y', fixed: false }])).toBe('y');
  });

  it('ghế làm việc: chỉ mẫu có từ loại trong tên', () => {
    const work = workChairsOf(roles);
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((f) => /(desk|office|task|swivel)/.test(f))).toBe(true);
  });
});

describe('roomVariety — chọn mẫu', () => {
  it('không cờ: mọi phòng một mẫu giường (hành vi cũ)', () => {
    expect(new Set(picks(genBeds, [])).size).toBe(1);
    expect(Object.keys(roomVarietyReport().changes)).toHaveLength(0);
  });

  it('roomvariety: đồ sinh các phòng rút mẫu khác nhau, tất định, không mẫu to hơn chỗ', () => {
    const first = picks(genBeds, ['roomvariety']);
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(first).not.toContain(BIG_BED);
    expect(picks([...genBeds].reverse(), ['roomvariety']).reverse()).toEqual(first);
    const report = roomVarietyReport();
    expect(report.byRole.doubleBed?.models).toBe(new Set(first).size);
    expect(Object.values(report.changes).every((c) => c.rule === 'room')).toBe(true);
  });

  it('roomvariety: đồ dò giữ mẫu; varietyai mới mở', () => {
    expect(new Set(picks(detBeds, ['roomvariety'])).size).toBe(1);
    expect(new Set(picks(detBeds, ['roomvariety', 'varietyai'])).size).toBeGreaterThan(1);
    const pinned = detBeds.map((f) => ({ ...f, reviewed: true }));
    expect(new Set(picks(pinned, ['roomvariety', 'varietyai'])).size).toBe(1);
  });

  it('roomvariety: ghế bàn học sinh dùng mẫu ghế làm việc', () => {
    const chair = piece('DRESS-deskChair-R-a', 'R-a', 'chair', 0, 0, 500, 500);
    const [plain] = picks([chair], []);
    const [work] = picks([chair], ['roomvariety']);
    expect(workChairsOf(roles)).not.toContain(plain);
    expect(workChairsOf(roles)).toContain(work);
    expect(roomVarietyReport().changes['DRESS-deskChair-R-a']).toEqual({ from: plain, to: work, rule: 'deskchair' });
  });

  it('chairset: mọi ghế quanh một bàn một mẫu (ghế dò cần varietyai); ghế xa bàn không vào bộ', () => {
    const table = piece('F-tbl', 'R-a', 'table', 0, 0, 1400, 800, { heightMm: 750 });
    // Ghế khác cỡ → không cờ thì lẫn mẫu như ca thật (4/7 phòng ăn).
    const chairs = [
      piece('F-c1', 'R-a', 'chair', 100, -500, 420, 420),
      piece('F-c2', 'R-a', 'chair', 700, -520, 520, 470),
      piece('F-c3', 'R-a', 'chair', 100, 850, 460, 400),
      piece('F-c4', 'R-a', 'chair', 700, 850, 380, 500),
    ];
    const far = piece('F-far', 'R-a', 'chair', 5000, 5000, 450, 450);
    const all = [table, ...chairs, far];
    const flags: VarietyFlag[] = ['chairset', 'varietyai'];
    const set = picks(chairs, flags, all, 'kitchen');
    expect(new Set(set).size).toBe(1);
    const report = roomVarietyReport();
    expect(report.tables['F-tbl']).toMatchObject({ chairs: 4, models: 1 });
    // Không varietyai: ghế dò giữ mẫu riêng.
    const kept = picks(chairs, ['chairset'], all, 'kitchen');
    expect(kept).toEqual(picks(chairs, [], all, 'kitchen'));
    expect(roomVarietyReport().tables['F-tbl']?.chairs).toBe(4);
  });
});
