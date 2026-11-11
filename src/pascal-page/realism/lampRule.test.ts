import { describe, expect, it } from 'vitest';

import { Mesh, Scene, Vector3 } from 'three';

import {
  type AppliedLight,
  fixtureMaterialCount,
  flagOn,
  inRoom,
  LAMP_RULE_DEFAULT,
  type LampItem,
  lampRuleOn,
  planLampAnchors,
  ROOM_SHADOW_DEFAULT,
  roomsWithVisibleSource,
  shadowSlotIndex,
  syncFixtures,
} from './lampRule';
import { planRoomLights, ROOM_LIGHT_MAX, type Polygon } from './roomLights';

const rect = (x0: number, z0: number, w: number, d: number): Polygon => [[x0, z0], [x0 + w, z0], [x0 + w, z0 + d], [x0, z0 + d]];
const rooms = [
  { polygon: rect(0, 0, 4, 4), name: 'Phòng ngủ 1', floorY: 0 },
  { polygon: rect(4, 0, 5, 4), name: 'Phòng ăn', floorY: 0 },
  { polygon: rect(0, 4, 6, 5), name: 'Phòng khách', floorY: 0 },
];

describe('?enable=lamprule — luật neo đèn', () => {
  it('ưu tiên đèn trần thật → bàn ăn → tâm phòng; tất định theo id; giữ đúng số mục kế hoạch', () => {
    const plan = planRoomLights(rooms);
    const lamps: LampItem[] = [
      { id: 'b-pendant', kind: 'ceiling', x: 3, y: 2.6, z: 7 },
      { id: 'a-pendant', kind: 'ceiling', x: 2, y: 2.6, z: 6 },
      { id: 'table', kind: 'table', x: 1, y: 0.6, z: 1 },
    ];
    const tables = [{ id: 'dt', x: 6.5, y: 0, z: 2 }];
    const anchors = planLampAnchors(plan, rooms, lamps, tables);
    expect(anchors).toHaveLength(plan.length);
    const by = Object.fromEntries(plan.map((p, i) => [rooms[p.index]!.name, anchors[i]!]));
    expect(by['Phòng khách']).toMatchObject({ source: 'existing-ceiling', ref: 'a-pendant', x: 2, z: 6, y: 2.6, fixture: false });
    expect(by['Phòng ăn']).toMatchObject({ source: 'rule-dining', ref: 'dt', x: 6.5, z: 2, fixture: true });
    expect(by['Phòng ngủ 1']).toMatchObject({ source: 'rule-center', fixture: true });
    expect(planLampAnchors(plan, rooms, [...lamps].reverse(), tables)).toEqual(anchors);
  });

  it('món tầng khác cùng x/z không được tính (không biết tầng → theo cao độ)', () => {
    expect(inRoom({ x: 1, y: 2.6, z: 1 }, rooms[0]!)).toBe(true);
    expect(inRoom({ x: 1, y: 3.4, z: 1 }, rooms[0]!)).toBe(false);
    const plan = planRoomLights(rooms);
    const upstairs: LampItem[] = [{ id: 'up', kind: 'ceiling', x: 2, y: 6.4, z: 6 }];
    expect(planLampAnchors(plan, rooms, upstairs, []).every((a) => a.source !== 'existing-ceiling')).toBe(true);
  });

  it('Codex #4: hai tầng chồng mặt bằng — bàn ăn tầng trên (3,4 m) không quyết định ốp trần tầng dưới', () => {
    const two = [
      { polygon: rect(0, 0, 5, 4), name: 'Phòng ăn T1', floorY: 0, level: 'level_1' },
      { polygon: rect(0, 0, 5, 4), name: 'Phòng ăn T2', floorY: 3.4, level: 'level_2' },
    ];
    const plan = planRoomLights(two);
    const tables = [{ id: 'dt-up', x: 4, y: 3.4, z: 3, level: 'level_2' }];
    const anchors = planLampAnchors(plan, two, [], tables);
    const by = Object.fromEntries(plan.map((p, i) => [two[p.index]!.name, anchors[i]!]));
    expect(by['Phòng ăn T1']).toMatchObject({ source: 'rule-center' });
    expect(by['Phòng ăn T2']).toMatchObject({ source: 'rule-dining', ref: 'dt-up' });
    // Biết tầng thì tầng quyết định, kể cả cao độ lệch.
    expect(inRoom({ x: 1, y: 9, z: 1, level: 'level_1' }, two[0]!)).toBe(true);
    expect(inRoom({ x: 1, y: 0, z: 1, level: 'level_2' }, two[0]!)).toBe(false);
  });

  it('phòng bị chia nhiều đèn (lamp-cal) → mỗi điểm chia một ốp trần tại chỗ', () => {
    const plan = [
      { index: 2, x: 1, z: 6, intensity: 5, range: 5 },
      { index: 2, x: 3, z: 6, intensity: 5, range: 5 },
    ];
    const anchors = planLampAnchors(plan, rooms, [{ id: 'p', kind: 'ceiling', x: 2, y: 2.6, z: 6 }], []);
    expect(anchors.map((a) => [a.source, a.x])).toEqual([['rule-center', 1], ['rule-center', 3]]);
  });

  it('không vượt bể: 20 phòng → tối đa ROOM_LIGHT_MAX neo', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ polygon: rect(i * 3, 0, 3, 3) }));
    const plan = planRoomLights(many);
    expect(planLampAnchors(plan, many, [], [])).toHaveLength(ROOM_LIGHT_MAX);
  });

  it('phủ nguồn nhìn thấy: phòng có neo hoặc có đèn thật', () => {
    const lamps: LampItem[] = [{ id: 'f', kind: 'floor', x: 1, y: 1.5, z: 6 }];
    expect(roomsWithVisibleSource(rooms, new Set([0]), lamps)).toEqual([true, false, true]);
  });
});

describe('?enable=roomshadow — ô đèn đổ bóng', () => {
  it('phòng chứa camera; ngoài mọi phòng → đèn gần nhất; không camera → 0', () => {
    const plan = planRoomLights(rooms);
    const kitchen = plan.findIndex((p) => p.index === 1);
    expect(shadowSlotIndex(plan, rooms, { x: 6, y: 1.6, z: 1 })).toBe(kitchen);
    expect(shadowSlotIndex(plan, rooms, { x: 20, y: 1.6, z: 2 })).toBe(kitchen);
    expect(shadowSlotIndex(plan, rooms, undefined)).toBe(0);
  });

  it('Codex #5: camera tầng trên chọn phòng tầng trên dù cùng x/z', () => {
    const two = [
      { polygon: rect(0, 0, 6, 5), floorY: 0, level: 'l1' },
      { polygon: rect(0, 0, 5, 4), floorY: 3.4, level: 'l2' },
    ];
    const plan = planRoomLights(two);
    const up = plan.findIndex((p) => p.index === 1);
    const down = plan.findIndex((p) => p.index === 0);
    expect(shadowSlotIndex(plan, two, { x: 2, y: 3.4 + 1.6, z: 2 })).toBe(up);
    expect(shadowSlotIndex(plan, two, { x: 2, y: 1.6, z: 2 })).toBe(down);
  });
});

describe('cờ', () => {
  it('mặc định sản xuất: lamprule BẬT, roomshadow TẮT; ?disable= tắt lamprule', () => {
    expect(LAMP_RULE_DEFAULT).toBe(true);
    expect(ROOM_SHADOW_DEFAULT).toBe(false);
    expect(flagOn('lamprule', LAMP_RULE_DEFAULT, '')).toBe(true);
    expect(flagOn('lamprule', LAMP_RULE_DEFAULT, '?disable=lamprule')).toBe(false);
    expect(flagOn('roomshadow', ROOM_SHADOW_DEFAULT, '')).toBe(false);
    expect(lampRuleOn()).toBe(true);
  });
  it('cơ chế cờ: ?enable= bật; ?disable= thắng', () => {
    expect(flagOn('lamprule', false, '')).toBe(false);
    expect(flagOn('lamprule', false, '?enable=x,lamprule')).toBe(true);
    expect(flagOn('lamprule', true, '?enable=lamprule&disable=lamprule')).toBe(false);
  });
});

describe('Codex #6: ốp trần dùng chung một vật liệu (một khoá shader)', () => {
  it('12 ốp trần cường độ khác nhau → 1 vật liệu, màu riêng theo vật thể', () => {
    const scene = new Scene();
    const lights: AppliedLight[] = Array.from({ length: 12 }, (_, i) => ({
      plan: { index: i, x: i, z: 0, intensity: 3 + i, range: 5 },
      anchor: { source: 'rule-center', x: i, z: 0, fixture: true },
      world: new Vector3(i, 2.9, 0),
      ceilingY: 3,
    }));
    syncFixtures(scene, lights, 0xffc98a, 15, 1.6);
    const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh && c.name === 'realism-lamp-fixture');
    expect(meshes).toHaveLength(12);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    expect(fixtureMaterialCount()).toBe(1);
    const lum = meshes.map((m) => (m.userData.fixtureColor as { r: number }).r);
    expect(lum[11]!).toBeGreaterThan(lum[0]!);
  });
});
