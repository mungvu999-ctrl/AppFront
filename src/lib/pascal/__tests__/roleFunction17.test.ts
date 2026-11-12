/**
 * Vòng 17 làn C — vai đúng công năng (`roleOf`): L1 giường chỉ khi hộp đủ cỡ giường; L2 vai đặc thù (giường, tủ bếp,
 * thiết bị vệ sinh) ở phòng ngoài bảng công năng mà món AI chưa chắc (tin cậy < 0,7 hoặc cỡ ngoài profile) → vai trung
 * tính, sổ bộ phòng ghi `doubt`. Đồ người dùng xác nhận / có mẫu / có khe vật liệu không đổi vai.
 * Số liệu hộp lấy từ sổ chụp vòng 16 (F:/runs/m15/qa/shots/<căn>/4181d388-VB): s150, s4pn, ch07, hin1.
 */
import { describe, expect, it } from 'vitest';

import type { Furniture, FurnitureKind, RoomUsage } from '@/domain/spatial/types';
import { degrees, millimetres } from '@/domain/units/types';

import { SCENE_STYLES } from '../sceneStyles';
import { contextRolesOf, modelFolderOf, roleDoubtOf, roleOf, roomSetReport, type LayerStyle } from '../sceneVariety';

const ai = (
  id: string,
  kind: FurnitureKind,
  wMm: number,
  dMm: number,
  extra: Partial<Furniture> = {},
): Furniture =>
  ({
    id: `F-${id}`,
    levelId: 'L-1',
    roomId: 'R-17',
    kind,
    centre: { x: millimetres(wMm / 2), y: millimetres(dMm / 2) },
    boundingBox: { min: { x: millimetres(0), y: millimetres(0) }, max: { x: millimetres(wMm), y: millimetres(dMm) } },
    rotationDeg: degrees(0),
    confidence: 0.8,
    source: 'ai',
    reviewed: false,
    ...extra,
  }) as Furniture;

const BEDS = new Set(['doubleBed', 'singleBed']);

describe('roleOf — vai đúng công năng (vòng 17)', () => {
  it('T1/T2: hộp quá nhỏ dán nhãn giường trong phòng khách không thành giường (s150 0,81 × 0,86; s4pn 0,91 × 0,51)', () => {
    const s150 = ai('s150', 'bed', 811, 861, { confidence: 0.6187 });
    const s4pn = ai('s4pn', 'bed', 913, 505, { confidence: 0.8043 });
    for (const f of [s150, s4pn]) {
      expect(BEDS.has(roleOf(f, 'livingRoom'))).toBe(false);
      expect(roleOf(f, 'livingRoom')).toBe('bench');
      expect(roleDoubtOf(f, 'livingRoom')).toMatch(/không đủ cỡ giường/);
    }
  });

  it('T3: luật cỡ độc lập với phòng — hộp 0,81 × 0,86 trong phòng ngủ cũng không phải giường', () => {
    expect(BEDS.has(roleOf(ai('s150b', 'bed', 811, 861), 'bedroom'))).toBe(false);
    // Cao đã biết ≥ 0,6 m → hộp tủ trung tính, không ghế đôn.
    expect(roleOf(ai('tall', 'bed', 811, 861, { heightMm: millimetres(900) }), 'bedroom')).toBe('cabinet');
  });

  it('T4: giường đôi đúng cỡ, tin cậy cao trong "phòng khách" giữ vai (ch07 2,34 × 2,57, tin cậy 0,81)', () => {
    const ch07 = ai('ch07', 'bed', 2336, 2567, { confidence: 0.8101 });
    expect(roleOf(ch07, 'livingRoom')).toBe('doubleBed');
    expect(roleDoubtOf(ch07, 'livingRoom')).toBeUndefined();
  });

  it('L2: giường đủ cỡ nhưng tin cậy thấp ở phòng khách → trung tính; cùng món ở phòng ngủ giữ giường', () => {
    const low = ai('low', 'bed', 1600, 2000, { confidence: 0.55 });
    expect(roleOf(low, 'livingRoom')).toBe('bench');
    expect(roleDoubtOf(low, 'livingRoom')).toMatch(/không hợp phòng livingRoom, tin cậy 0,55/);
    expect(roleOf(low, 'bedroom')).toBe('doubleBed');
    expect(roleOf(low)).toBe('doubleBed');
  });

  it('T5: giường đơn 1,10 × 2,09 trong phòng ngủ vẫn là giường đơn (chống hồi quy)', () => {
    expect(roleOf(ai('t5', 'bed', 1099, 2094), 'bedroom')).toBe('singleBed');
  });

  it('T6: món người dùng xác nhận / nguồn người / đã sửa / có mẫu / có khe vật liệu không đổi vai', () => {
    const variants: Partial<Furniture>[] = [
      { reviewed: true },
      { source: 'human' },
      { edited: true },
      { model: { id: 'm', src: '/items/bed-x/model.glb' } },
      { slots: {} },
    ];
    for (const extra of variants) {
      const f = ai('user', 'bed', 811, 861, { confidence: 0.3, ...extra });
      expect(roleOf(f, 'livingRoom')).toBe('singleBed');
      expect(roleDoubtOf(f, 'livingRoom')).toBeUndefined();
    }
  });

  it('T7: tủ bếp tin cậy thấp trong phòng ngủ không là counter; cùng món ở bếp / phòng khách (bếp mở) vẫn counter', () => {
    const hin1 = ai('hin1', 'kitchenCabinet', 1528, 264, { confidence: 0.67 });
    expect(roleOf(hin1, 'bedroom')).toBe('cabinet');
    expect(roleDoubtOf(hin1, 'bedroom')).toMatch(/vai counter không hợp phòng bedroom/);
    for (const usage of ['kitchen', 'livingRoom', 'other', undefined] as (RoomUsage | undefined)[]) expect(roleOf(hin1, usage)).toBe('counter');
    // Tin cậy cao (cn06 0,83) → giữ vai, chỉ L2 khi chưa chắc.
    expect(roleOf(ai('cn06', 'kitchenCabinet', 716, 579, { confidence: 0.83 }), 'bedroom')).toBe('counter');
  });

  it('L2: bồn cầu tin cậy thấp trong phòng khách → trung tính; trong phòng ngủ (WC riêng) và phòng tắm giữ', () => {
    const wc = ai('wc', 'sanitaryFixture', 400, 700, { confidence: 0.5 });
    expect(roleOf(wc, 'bathroom')).toBe('toilet');
    expect(roleOf(wc, 'bedroom')).toBe('toilet');
    expect(roleOf(wc, 'livingRoom')).toBe('cabinet');
  });

  it('sổ bộ phòng ghi lý do vai chưa xác định (`doubt`) cho món dựng bằng vai trung tính', () => {
    const bed = ai('log', 'bed', 811, 861, { confidence: 0.6187 });
    const style: LayerStyle = { ...SCENE_STYLES['am-ap'], roomSet: true };
    contextRolesOf([bed], () => 'livingRoom');
    modelFolderOf(bed, style, 'livingRoom');
    const entry = roomSetReport()['R-17']?.items.find((d) => d.id === bed.id);
    expect(entry?.role).toBe('bench');
    expect(entry?.doubt).toMatch(/chưa xác định/);
  });
});

describe('R7 — bàn nhỏ sát sofa trong phòng khách là bàn trà (lỗi ánh xạ vai, set17 cn21/cn22)', () => {
  /** Dời hộp món tới góc (x, y) mm. */
  const at = (f: Furniture, x: number, y: number): Furniture => {
    const w = f.boundingBox.max.x - f.boundingBox.min.x;
    const d = f.boundingBox.max.y - f.boundingBox.min.y;
    return {
      ...f,
      centre: { x: millimetres(x + w / 2), y: millimetres(y + d / 2) },
      boundingBox: { min: { x: millimetres(x), y: millimetres(y) }, max: { x: millimetres(x + w), y: millimetres(y + d) } },
    };
  };
  const sofa = at(ai('sofa', 'chair', 2100, 900), 0, 0);
  const table = at(ai('tbl', 'table', 840, 610), 600, 1200);

  it('bàn 0,84 × 0,61 cách sofa 0,3 m, không ghế ăn → coffeeTable', () => {
    expect(contextRolesOf([sofa, table], () => 'livingRoom').get(table.id)).toBe('coffeeTable');
  });

  it('có ghế ăn sát bàn → giữ vai bàn (không đổi)', () => {
    const chair = at(ai('ch', 'chair', 450, 450), 1500, 1250);
    expect(contextRolesOf([sofa, table, chair], () => 'livingRoom').get(table.id)).toBeUndefined();
  });

  it('bàn xa sofa (> 0,6 m) hoặc phòng khác → không đổi', () => {
    const far = at(ai('far', 'table', 840, 610), 600, 2600);
    expect(contextRolesOf([sofa, far], () => 'livingRoom').get(far.id)).toBeUndefined();
    expect(contextRolesOf([sofa, table], () => 'kitchen').get(table.id)).toBeUndefined();
  });
});
