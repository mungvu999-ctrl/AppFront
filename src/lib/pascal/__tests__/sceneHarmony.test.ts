/**
 * Thí nghiệm phối đồ `?layout=toneall|hue` (`sceneHarmony.ts` + `sceneVariety.ts`): không cờ = như cũ; chỉ đồ tự động
 * đổi mẫu; tất định; mẫu thiếu metadata không phạt không thưởng. Vòng 14: các cờ này là cờ của LUẬT CŨ — khi bộ chọn
 * (`roomset`) bật, mọi món vai bộ chưa ghim lấy mẫu từ một đánh giá; test chạy luật cũ (`roomSet: false`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Furniture, RoomUsage } from '@/domain/spatial/types';

import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { ACCENT_CHROMA, accentKeyOf, harmonyKeyOf, layoutFlagsOf, roomHarmonyPlanOf, type LayoutFlag } from '../sceneHarmony';
import { sceneStyleOf } from '../sceneStyles';
import { contextRolesOf, harmonyReport, modelFolderOf, type LayerStyle } from '../sceneVariety';

const models = LIBRARY.models as Record<string, { s: string[]; c: number; t?: string; h?: string }>;
const roles = LIBRARY.roles as Record<string, string[]>;
// Mọi mẫu cùng vai một cỡ → chi phí cỡ bằng nhau, chỉ khoá màu/tông quyết định.
const DIMS: Record<string, [number, number, number]> = { sofa: [2200, 800, 900], armchair: [800, 800, 800], coffeeTable: [1000, 420, 600] };

const base = sceneStyleOf(undefined);
const styleWith = (layout: LayoutFlag[], woodTone?: 'l' | 'd'): LayerStyle => ({
  ...base,
  libraryStyles: [],
  rulesOff: new Set(),
  layout: new Set(layout),
  roomSet: false,
  ...(woodTone === undefined ? {} : { woodTone }),
});

const piece = (id: string, kind: Furniture['kind'], w: number, d: number, h: number, extra: Partial<Furniture> = {}): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId: 'R-live',
    kind,
    centre: { x: 0, y: 0 },
    boundingBox: { min: { x: 0, y: 0 }, max: { x: w, y: d } },
    rotationDeg: 0,
    heightMm: h,
    source: 'ai',
    reviewed: false,
    confidence: 0.9,
    ...extra,
  }) as Furniture;

const sofa = piece('F-sofa', 'chair', 2200, 900, 800);
const chair = piece('F-arm', 'chair', 800, 800, 800);
const table = piece('F-tbl', 'table', 1000, 600, 420);
const room = [sofa, chair, table];
const usage = (): RoomUsage => 'livingRoom';

beforeAll(() => {
  registerServerLibrary(
    Object.entries(DIMS).flatMap(([role, [w, hh, d]]) =>
      (roles[role] ?? []).map((id) => ({ id, widthMm: w, heightMm: hh, depthMm: d, modelUrl: `https://x.test/${id}.glb` })),
    ),
  );
});
afterAll(() => clearServerLibrary());

const pickAll = (style: LayerStyle, items: readonly Furniture[] = room) => {
  contextRolesOf(items, usage);
  return Object.fromEntries(items.map((f) => [f.id, modelFolderOf(f, style, 'livingRoom')]));
};

describe('sceneHarmony — hàm thuần', () => {
  it('đọc cờ URL, bỏ giá trị lạ', () => {
    expect([...layoutFlagsOf('?layout=hue,toneall,xyz')].sort()).toEqual(['hue', 'toneall']);
    expect(layoutFlagsOf('?disable=tone').size).toBe(0);
  });

  it('khoá hợp màu: cùng họ < trung tính < khác họ; thiếu họ = trung tính', () => {
    expect(harmonyKeyOf('green', 'green')).toBe(0);
    expect(harmonyKeyOf('green', 'grey')).toBe(1);
    expect(harmonyKeyOf('green', undefined)).toBe(1);
    expect(harmonyKeyOf('green', 'purple')).toBe(2);
    expect(harmonyKeyOf(undefined, undefined)).toBe(0);
  });

  it('khoá nhấn: trong dải = 0, neo có màu thì tránh họ khác', () => {
    expect(accentKeyOf('grey', 'blue', 15)).toEqual([0, 0]);
    expect(accentKeyOf('grey', 'blue', 25)[1]).toBe(25 - ACCENT_CHROMA[1]);
    expect(accentKeyOf('green', 'purple', 15)[0]).toBe(1);
  });

  it('neo theo công năng, không có thì món lớn nhất; nhấn chỉ một món tự động', () => {
    const plan = roomHarmonyPlanOf(
      [
        { id: 'a', role: 'sofa', area: 1.8, auto: false },
        { id: 'b', role: 'armchair', area: 0.6, auto: true },
        { id: 'c', role: 'armchair', area: 0.7, auto: true },
      ],
      'livingRoom',
    );
    expect(plan).toEqual({ anchorId: 'a', accentId: 'c' });
    expect(roomHarmonyPlanOf([{ id: 'x', role: 'desk', area: 1, auto: true }, { id: 'y', role: 'closet', area: 1.2, auto: true }], 'other').anchorId).toBe('y');
    // Ghế bành người dùng đã xác nhận không làm món nhấn.
    expect(roomHarmonyPlanOf([{ id: 'b', role: 'armchair', area: 0.6, auto: false }], 'livingRoom').accentId).toBeUndefined();
  });
});

describe('sceneVariety ?layout=', () => {
  it('không cờ = như cũ (đồ AI không theo tông, chọn độ rực thấp nhất)', () => {
    const off = pickAll(styleWith([], 'd'));
    const plain = Object.fromEntries(room.map((f) => [f.id, modelFolderOf({ ...f, reviewed: true }, styleWith([], 'd'), 'livingRoom')]));
    expect(off).toEqual(plain);
    expect(harmonyReport()).toEqual({});
  });

  it('toneall: đồ AI chưa xác nhận theo tông của căn; đồ đã xác nhận giữ nguyên', () => {
    const pick = pickAll(styleWith(['toneall'], 'l'))['F-arm'] ?? '';
    expect(models[pick]?.t ?? 'l').toBe('l');
    const reviewed = { ...chair, reviewed: true };
    expect(modelFolderOf(reviewed, styleWith(['toneall'], 'l'), 'livingRoom')).toBe(modelFolderOf(reviewed, styleWith([], 'l'), 'livingRoom'));
  });

  it('hue: neo giữ mẫu cũ, đúng một món nhấn độ rực vừa, tất định, có đầu dò', () => {
    const off = pickAll(styleWith([]));
    const on = pickAll(styleWith(['hue']));
    expect(on['F-sofa']).toBe(off['F-sofa']);
    const accent = models[on['F-arm'] ?? '']?.c ?? 0;
    // Phong cách vẫn đứng trước màu: căn không mã phong cách → mẫu không mã (hạng 0) trước.
    const tier0 = (roles.armchair ?? []).filter((id) => (models[id]?.s ?? []).length === 0);
    const best = Math.min(...tier0.map((id) => accentKeyOf(models[off['F-sofa'] ?? '']?.h, models[id]?.h, models[id]?.c ?? 0)[1]));
    expect(accentKeyOf(models[off['F-sofa'] ?? '']?.h, models[on['F-arm'] ?? '']?.h, accent)[1]).toBe(best);
    // Tất định: lặp lại, đảo thứ tự.
    expect(pickAll(styleWith(['hue']), [...room].reverse())).toEqual(on);
    const report = harmonyReport()['R-live'];
    expect(report?.anchor?.id).toBe('F-sofa');
    expect(report?.accent).toBe('F-arm');
    expect(report?.items.map((i) => i.id).sort()).toEqual(['F-arm', 'F-tbl']);
  });

  it('hue: mẫu người dùng gán / đã xác nhận không đổi', () => {
    const assigned = { ...chair, model: { id: 'x', src: 'https://x.test/items/whatever/model.glb' } };
    const reviewed = { ...table, reviewed: true };
    const items = [sofa, assigned, reviewed];
    const off = pickAll(styleWith([]), items);
    const on = pickAll(styleWith(['hue', 'toneall'], 'd'), items);
    expect(on['F-tbl']).toBe(off['F-tbl']);
    expect(on['F-arm']).toBe(off['F-arm']);
  });

  it('hue: mẫu concept chọn cho vai giữ nguyên (ý định thiết kế); vai concept không chỉ định mới được phối', () => {
    const conceptPick = (roles.armchair ?? []).at(-1) ?? '';
    const style = { ...styleWith(['hue', 'toneall'], 'd'), prefer: { ...base.prefer, armchair: [conceptPick] } };
    expect(pickAll(style)['F-arm']).toBe(conceptPick);
  });

  it('mẫu thiếu tông gỗ/họ màu: không bị phạt dưới toneall', () => {
    const missing = (roles.coffeeTable ?? []).filter((id) => models[id]?.t === undefined);
    const pick = pickAll(styleWith(['toneall'], 'd'))['F-tbl'] ?? '';
    // Mẫu chọn hoặc đúng tông, hoặc thiếu tông (không bị đẩy xuống).
    expect(models[pick]?.t === 'd' || missing.includes(pick)).toBe(true);
  });
});
