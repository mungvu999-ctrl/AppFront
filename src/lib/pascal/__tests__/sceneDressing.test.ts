import { afterEach, describe, expect, it } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import type { RoomUsage } from '@/domain/spatial/types';
import { millimetres } from '@/domain/units/types';
import { EXTERIOR_SKIRTING, setDetailsEnabled } from '@/pascal-page/realism/details';

import { fixtureF1, fixtureF2, type Fixture } from '../__fixtures__';
import { SITE_NODE_ID, toPascalId } from '../ids';
import {
  floorMaterialOf,
  GLASS_OPACITY,
  itemSlotsOf,
  lampInteractiveOf,
  SCENE_MATERIALS,
  TABLE_LAMP_DISTANCE_M,
  TABLE_LAMP_INTENSITY_SHARE,
  wallDressingOf,
} from '../sceneDressing';
import { SCENE_STYLE_IDS, SCENE_STYLE_MATERIALS, SCENE_STYLES, type SceneStyle, sceneStyleOf } from '../sceneStyles';
import { toPascalScene } from '../toPascal';
import type { PascalSlabNode, PascalWallNode } from '../types';

const DEFAULT = sceneStyleOf(undefined);
const GLASS = 'library:preset-glass';

const run = (fixture: Fixture) => {
  const graph = SpatialGraphDocumentSchema.parse(fixture.doc).graph;
  const { scene } = toPascalScene(graph);
  const slabOf = (roomId: string) => scene.nodes[toPascalId('slab', roomId)] as PascalSlabNode;
  const wallOf = (wallId: string) => scene.nodes[toPascalId('wall', wallId)] as PascalWallNode;
  return { graph, scene, slabOf, wallOf };
};

describe('sceneDressing (I3) — sàn, tường, vật liệu cảnh', () => {
  it('C1: kính cửa sổ trong suốt (đục < 0,6 → Pascal phủ fresnel), id giữ nguyên', () => {
    const glass = SCENE_MATERIALS.find((m) => m.id === 'mat_appfront_glass');
    const props = glass?.material.properties as { opacity: number; transparent: boolean; roughness: number } | undefined;
    expect(props?.transparent).toBe(true);
    expect(props?.opacity).toBe(GLASS_OPACITY);
    expect(GLASS_OPACITY).toBeGreaterThanOrEqual(0.2);
    expect(GLASS_OPACITY).toBeLessThanOrEqual(0.3);
    expect(props?.roughness).toBeLessThanOrEqual(0.05);
  });

  it('C1: lampInteractiveOf — đèn bàn mượn khối đèn cây, ánh sáng theo phong cách; đồ khác undefined', () => {
    const style = sceneStyleOf(undefined);
    for (const folder of ['floor-lamp', 'ceiling-lamp', 'recessed-light']) {
      const lamp = lampInteractiveOf(folder, style) as { effects: { kind: string; color?: string; intensityRange?: number[] }[] };
      const light = lamp.effects.find((e) => e.kind === 'light');
      expect(light?.color, folder).toBe(style.lampColour);
      expect(light?.intensityRange, folder).toEqual([0, style.lampIntensity]);
    }
    expect(lampInteractiveOf('sofa', style)).toBeUndefined();
  });

  it('P8: đèn bàn/đèn ngủ dịu hơn đèn trần — cường độ và tầm riêng, mọi phong cách', () => {
    interface Light {
      kind: string;
      intensityRange?: number[];
      distance?: number;
      offset?: number[];
    }
    const lightOf = (folder: string, style: SceneStyle) =>
      (lampInteractiveOf(folder, style) as { effects: Light[] }).effects.find((e) => e.kind === 'light');
    for (const style of Object.values(SCENE_STYLES)) {
      const table = lightOf('table-lamp', style);
      const ceiling = lightOf('recessed-light', style);
      expect(table?.intensityRange).toEqual([0, style.lampIntensity * TABLE_LAMP_INTENSITY_SHARE]);
      expect(table?.intensityRange?.[1]).toBeLessThan(ceiling?.intensityRange?.[1] ?? 0);
      expect(table?.distance).toBe(TABLE_LAMP_DISTANCE_M);
      expect(table?.distance).toBeLessThan(ceiling?.distance ?? 0);
      expect(table?.offset?.[1]).toBeGreaterThan(0);
    }
    // Khối đèn cây mượn được chép sâu: đèn cây vẫn sáng như trần.
    expect(lightOf('floor-lamp', DEFAULT)?.intensityRange).toEqual([0, DEFAULT.lampIntensity]);
  });

  it('P2: sàn theo khu — khách/bếp/hành lang chung một gạch khổ lớn, phòng ngủ gỗ, WC/lô gia gạch chống trơn', () => {
    for (const style of Object.values(SCENE_STYLES)) {
      const of = (usage: RoomUsage) => floorMaterialOf({ usage }, style);
      expect(of('livingRoom'), style.id).not.toBe(of('bedroom'));
      expect(of('livingRoom'), style.id).toBe(of('kitchen'));
      expect(of('corridor'), style.id).toBe(of('livingRoom'));
      expect(of('bedroom'), style.id).toBe(style.floor.wood);
      expect(of('bathroom'), style.id).toBe(of('loggia'));
      expect(of('bathroom'), style.id).not.toBe(of('livingRoom'));
      // finish khai tường minh vẫn thắng đoán theo công năng.
      expect(floorMaterialOf({ usage: 'livingRoom', finish: 'wood' }, style)).toBe(style.floor.wood);
    }
  });

  it('P5: đèn cây nhận kim loại của phong cách ở chân (khe slot_legs), chao giữ nguyên', () => {
    for (const style of Object.values(SCENE_STYLES)) expect(itemSlotsOf('floor-lamp', style)).toEqual({ legs: style.families.metal });
  });

  it('F2: mặt sàn theo công năng khi phòng không khai finish (phong cách mặc định)', () => {
    const { graph, slabOf } = run(fixtureF2());
    const byUsage: Record<RoomUsage, string> = {
      livingRoom: DEFAULT.floor.tile,
      bedroom: DEFAULT.floor.wood,
      corridor: DEFAULT.floor.tile,
      other: DEFAULT.floor.wood,
      kitchen: DEFAULT.floor.tile,
      utility: DEFAULT.floor.tile,
      bathroom: DEFAULT.floor.mosaic,
      stairwell: DEFAULT.floor.concrete,
      loggia: DEFAULT.floor.mosaic,
    };
    expect(graph.rooms.length).toBeGreaterThan(0);
    for (const room of graph.rooms) expect(slabOf(room.id).slots['surface']).toBe(byUsage[room.usage]);
  });

  it('F1 ext: mặt sàn theo finish — gỗ dùng chung một id, tắm mosaic, bếp gạch, ban công decking', () => {
    const { graph, slabOf } = run(fixtureF1({ ext: true }));
    for (const room of graph.rooms) {
      expect(room.finish).toBeDefined();
      expect(slabOf(room.id).slots['surface']).toBe(DEFAULT.floor[room.finish ?? 'concrete']);
    }
    const surfaces = graph.rooms.map((room) => slabOf(room.id).slots['surface']);
    expect(surfaces.filter((s) => s === DEFAULT.floor.wood)).toHaveLength(5);
    expect(surfaces).toEqual(expect.arrayContaining([DEFAULT.floor.mosaic, DEFAULT.floor.tile, DEFAULT.floor.decking]));
  });

  it('tường có đủ hai khe + len + phào; tường thấp là kính, không len phào', () => {
    for (const fixture of [fixtureF2(), fixtureF1({ ext: true })]) {
      const { graph, wallOf } = run(fixture);
      for (const wall of graph.walls) {
        const node = wallOf(wall.id);
        expect(Object.keys(node.slots ?? {}).sort()).toEqual(['exterior', 'interior']);
        if (wall.heightMm <= 1200) {
          expect(node.slots).toEqual({ interior: GLASS, exterior: GLASS });
          expect(node.skirting).toBeUndefined();
          expect(node.crown).toBeUndefined();
          continue;
        }
        expect(node.slots?.['interior']).toBe(DEFAULT.wall.interior);
        expect(node.slots?.['exterior']).toBe(wall.kind === 'partition' ? DEFAULT.wall.interior : DEFAULT.wall.exterior);
        expect(node.skirting).toEqual({ enabled: true, sides: 'interior', height: 0.09, proud: 0.012, profile: 'flat' });
        expect(node.crown).toEqual({ enabled: true, sides: 'interior', height: 0.05, proud: 0.02, profile: 'flat' });
      }
    }
  });

  describe('GĐ6 — cờ details bật: phào chân ngoài dựng lúc nạp', () => {
    afterEach(() => setDetailsEnabled(false));

    it('tường bao (một mặt ra ngoài) có phào ngoài; vách giữa hai phòng giữ len trong; tường kính không len', () => {
      setDetailsEnabled(true);
      const { graph, wallOf } = run(fixtureF1({ ext: true }));
      let outer = 0;
      let inner = 0;
      for (const wall of graph.walls) {
        const node = wallOf(wall.id);
        if (wall.heightMm <= 1200) {
          expect(node.skirting, wall.id).toBeUndefined();
        } else if (node.frontSide === 'exterior' || node.backSide === 'exterior') {
          outer += 1;
          // Mặt trong giữ len của phong cách; mặt ngoài phào cỡ EXTERIOR_SKIRTING.
          const { height, proud, profile } = EXTERIOR_SKIRTING;
          expect(node.skirting, wall.id).toEqual({
            enabled: true, sides: 'both', height: 0.09, proud: 0.012, profile: 'flat',
            exterior: { height, proud, profile },
          });
        } else {
          inner += 1;
          expect(node.skirting, wall.id).toEqual({ enabled: true, sides: 'interior', height: 0.09, proud: 0.012, profile: 'flat' });
        }
      }
      expect(outer).toBeGreaterThan(0);
      expect(inner).toBeGreaterThan(0);
    });
  });

  it('lan can 1,1 m là kính ở mọi phong cách', () => {
    for (const id of SCENE_STYLE_IDS) {
      expect(wallDressingOf({ kind: 'partition', heightMm: millimetres(1100) }, SCENE_STYLES[id])).toEqual({
        slots: { interior: GLASS, exterior: GLASS },
      });
    }
  });

  it('phong cách mặc định ổn định: bỏ tham số = truyền mặc định, gọi lại cho cùng kết quả', () => {
    const room = { usage: 'bedroom' } as const;
    const wall = { kind: 'envelope', heightMm: millimetres(2700) } as const;
    expect(floorMaterialOf(room)).toBe(floorMaterialOf(room, DEFAULT));
    expect(floorMaterialOf(room)).toBe(DEFAULT.floor.wood);
    expect(wallDressingOf(wall)).toEqual(wallDressingOf(wall, DEFAULT));
    expect(itemSlotsOf('bookshelf')).toEqual(itemSlotsOf('bookshelf', DEFAULT));
    expect(itemSlotsOf('bookshelf')).toEqual({ body: DEFAULT.families.wood, shelf: DEFAULT.families.wood });
    expect(itemSlotsOf('indoor-plant')?.['trunk']).toBe('scene:mat_appfront_bark');
    expect(itemSlotsOf('double-bed')).toBeUndefined();
  });

  it('tủ cố định không thành khối be trơn: thân tủ áo vân gỗ, tủ bếp tay nắm kim loại + mặt đá khác thân', () => {
    for (const style of Object.values(SCENE_STYLES)) {
      expect(itemSlotsOf('closet', style)).toEqual({ body: style.families.wood });
      const kitchen = itemSlotsOf('kitchen-cabinet', style);
      expect(kitchen).toEqual({
        cabinet: style.families.cabinetry,
        countertop: style.families.countertop,
        handle: style.families.metal,
      });
      expect(kitchen?.['countertop']).not.toBe(kitchen?.['cabinet']);
      expect(itemSlotsOf('kitchen-shelf', style)?.['handle']).toBe(style.families.metal);
    }
  });

  it('hai phong cách cho sàn phòng gỗ và gỗ đồ đạc khác nhau', () => {
    const room = { usage: 'livingRoom', finish: 'wood' } as const;
    const refs = new Set(SCENE_STYLE_IDS.map((id) => floorMaterialOf(room, SCENE_STYLES[id])));
    expect(refs.size).toBeGreaterThan(1);
    expect(floorMaterialOf(room, SCENE_STYLES['go-am'])).not.toBe(floorMaterialOf(room));
    expect(itemSlotsOf('dresser', SCENE_STYLES['go-am'])).not.toEqual(itemSlotsOf('dresser'));
  });

  it('scene.materials chứa mọi id `scene:` được tham chiếu, khoá theo id', () => {
    for (const fixture of [fixtureF2(), fixtureF1({ ext: true })]) {
      const { scene } = run(fixture);
      expect(Object.keys(scene.materials ?? {}).sort()).toEqual(
        [...SCENE_MATERIALS, ...SCENE_STYLE_MATERIALS].map((m) => m.id).sort(),
      );
      for (const [id, material] of Object.entries(scene.materials ?? {})) expect(material.id).toBe(id);
      const refs = Object.values(scene.nodes).flatMap((node) =>
        'slots' in node && node.slots !== undefined ? Object.values(node.slots) : [],
      );
      for (const ref of refs.filter((r) => r.startsWith('scene:')))
        expect(scene.materials?.[ref.slice('scene:'.length)]).toBeDefined();
    }
  });

  it('khu đất hiện làm đế (ranh vàng tắt lúc dựng) và giữ đường bao cho bộ vẽ', () => {
    const { scene } = run(fixtureF1({ ext: true }));
    const site = scene.nodes[SITE_NODE_ID];

    expect(site).toMatchObject({ type: 'site' });
    expect((site as { visible?: boolean } | undefined)?.visible).not.toBe(false);
    expect(site?.type === 'site' && site.polygon.points.length).toBeGreaterThanOrEqual(3);
  });
});
