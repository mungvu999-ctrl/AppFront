/**
 * Vòng 6 làn 2: dải nhám theo LOẠI chỉ cho vai `floor`. Mô phỏng đúng đường vendor đã vá (`r10-floors.mjs`):
 * `createMaterialFromPresetRef(ref, shading, role)` = tuneFloorFinish(ref, cache[JSON(floorFinishPreset(ref, preset, role))], role),
 * khoá cache vendor = `${shading}-${JSON.stringify(preset)}` (`viewer/src/lib/materials.ts` createMaterialFromPreset).
 */
import { getMaterialPresetByRef } from '@pascal-app/core/material-library';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { floorBandOf, floorFinishPreset, floorKindOf, type SurfaceRole, tuneFloorFinish } from './floorFinish';
import type * as matx from './matx';
import { FLOOR_ROUGH_BAND } from './matx';
import { DEFAULT_REALISM_FLAGS, useRealism } from './store';

const flags = vi.hoisted(() => ({ floorRough: true }));
vi.mock('./matx', async (orig) => ({
  ...(await orig<typeof matx>()),
  matOn: (name: string) => (name === 'floor-rough' ? flags.floorRough : true),
}));

const lib = (id: string) => `library:${id}`;
const MARBLE = lib('flooring-statuarettowhite');
const TILE = lib('flooring-tile79');
const WOOD = lib('flooring-woodparquet76');

/** Bản sao tối giản của cache vendor + chỗ gọi đã vá; trả cả khoá để kiểm ảnh dùng chung. */
function vendor() {
  const cache = new Map<string, MeshStandardNodeMaterial>();
  const presets = new Map<string, unknown>();
  const create = (ref: string, role?: SurfaceRole) => {
    const preset = getMaterialPresetByRef(ref);
    if (!preset) return null;
    const p = floorFinishPreset(ref, preset, role);
    const key = `rendered-${JSON.stringify(p)}`;
    let m = cache.get(key);
    if (!m) {
      m = new MeshStandardNodeMaterial({ roughness: preset.mapProperties.roughness });
      cache.set(key, m);
      presets.set(m.uuid, p);
    }
    return tuneFloorFinish(ref, m, role);
  };
  return { cache, presets, create };
}

interface MathLike {
  method?: string;
  bNode?: { value?: number };
  cNode?: { value?: number };
}
const bandOfNode = (m: MeshStandardNodeMaterial): [number?, number?] | null => {
  const n = m.roughnessNode as unknown as MathLike | null;
  return n?.method === 'clamp' ? [n.bNode?.value, n.cNode?.value] : null;
};

afterEach(() => {
  flags.floorRough = true;
  useRealism.setState({ flags: { ...DEFAULT_REALISM_FLAGS } });
});

describe('loại sàn từ catalogue', () => {
  it('bảng FLOOR_FINISHES trước (tile79 = gạch dù catalogue ghi stone), rồi category catalogue', () => {
    expect(floorKindOf(WOOD)).toBe('wood');
    expect(floorKindOf(TILE)).toBe('tile');
    expect(floorKindOf(MARBLE)).toBe('stone');
    expect(floorKindOf(lib('flooring-lightceramic24'))).toBe('tile');
    // Ngoài bảng sàn: category catalogue.
    expect(floorKindOf(lib('wood-finewood27'))).toBe('wood');
    expect(floorKindOf(lib('flooring-tile86'))).toBe('tile');
    expect(floorKindOf(lib('flooring-greenlabradorite'))).toBe('stone'); // không ảnh nhám, 0,35 = đá bóng
  });

  it('không rõ loại → null (giữ nguyên vật liệu catalogue)', () => {
    expect(floorKindOf(lib('concrete-polished'))).toBeNull(); // họ bê tông trong bảng
    expect(floorKindOf(lib('flooring-wallstone1'))).toBeNull(); // đá 0,45 = đá nhám
    expect(floorKindOf(lib('flooring-terrazzo19'))).toBeNull(); // đá có ảnh nhám
    expect(floorKindOf(lib('flooring-rusticbrick'))).toBeNull();
    expect(floorKindOf(lib('khong-co'))).toBeNull();
    expect(floorKindOf('scene:mat_style_am_ap_wall')).toBeNull();
    expect(floorKindOf(undefined)).toBeNull();
  });

  it('dải hợp lệ, đá bóng < gạch < gỗ < thảm, đá vẫn bóng hơn mức ép 0,45 của vòng 5', () => {
    const { stone, tile, wood, carpet } = FLOOR_ROUGH_BAND;
    for (const [lo, hi] of [stone, tile, wood, carpet]) expect(0 <= lo && lo < hi && hi <= 1).toBe(true);
    expect(stone[1] <= tile[0] && tile[1] < wood[0] && wood[1] < carpet[0]).toBe(true);
    expect(stone[1]).toBeLessThan(0.45);
  });
});

describe('phân vai: chỉ vai floor nhận dải nhám', () => {
  it('floorBandOf: chỉ role floor + cờ bật + loại có bảng', () => {
    expect(floorBandOf(MARBLE, 'floor')).toEqual(FLOOR_ROUGH_BAND.stone);
    expect(floorBandOf(MARBLE)).toBeNull();
    expect(floorBandOf(lib('concrete-polished'), 'floor')).toBeNull();
    flags.floorRough = false;
    expect(floorBandOf(MARBLE, 'floor')).toBeNull();
  });

  it('sàn và mặt bàn cùng mã → hai vật liệu; mặt bàn/tường không bị kẹp, giữ map + màu + preset', () => {
    const v = vendor();
    const floor = v.create(MARBLE, 'floor')!;
    const counter = v.create(MARBLE)!;
    const wall = v.create(MARBLE)!;
    expect(floor).not.toBe(counter);
    expect(counter).toBe(wall);
    expect(bandOfNode(floor)).toEqual([0.2, 0.3]);
    expect(floor.userData.realismRole).toBe('floor');
    expect(floor.userData.realismRoughBand).toEqual([0.2, 0.3]);
    expect(bandOfNode(counter)).toEqual([0, 1]); // chỉ kẹp 0..1 của nhiễu bề mặt (`surfaceNoise`), như trước
    expect(counter.userData.realismRole).toBeUndefined();
    // Cùng tông màu/ron (colorNode) và cùng thuộc tính ảnh → khoá cache ảnh vendor giống hệt, ảnh dùng chung.
    expect(floor.colorNode).toBeTruthy();
    expect(counter.colorNode).toBeTruthy();
    const pf = v.presets.get(floor.uuid) as { maps: unknown; mapProperties: unknown; surfaceRole?: string };
    const pc = v.presets.get(counter.uuid) as { maps: unknown; mapProperties: unknown; surfaceRole?: string };
    expect(pf.maps).toEqual(pc.maps);
    expect(pf.mapProperties).toEqual(pc.mapProperties);
    expect(pf.surfaceRole).toBe('floor');
    expect(pc.surfaceRole).toBeUndefined();
  });

  it('gỗ trong dải 0,45–0,6; gạch 0,3–0,4', () => {
    const v = vendor();
    expect(bandOfNode(v.create(WOOD, 'floor')!)).toEqual([0.45, 0.6]);
    expect(bandOfNode(v.create(TILE, 'floor')!)).toEqual([0.3, 0.4]);
  });

  it('sàn ngoài bảng màu nhưng có loại catalogue: chỉ kẹp nhám, không đổi màu', () => {
    const v = vendor();
    const floor = v.create(lib('flooring-tile86'), 'floor')!;
    const counter = v.create(lib('flooring-tile86'))!;
    expect(bandOfNode(floor)).toEqual([0.3, 0.4]);
    expect(floor.colorNode).toBeNull();
    expect(counter.userData.__realismFloor).toBeUndefined(); // không vai, không bảng → vật liệu vendor nguyên
  });
});

describe('dùng chung instance + không rò khi dựng lại', () => {
  it('hai phòng cùng mã sàn → MỘT vật liệu; 10 lần dựng lại (đổi tầng) → cache không lớn thêm', () => {
    const v = vendor();
    const a = v.create(TILE, 'floor');
    const b = v.create(TILE, 'floor');
    expect(a).toBe(b);
    v.create(TILE);
    const size = v.cache.size;
    for (let i = 0; i < 10; i++) {
      expect(v.create(TILE, 'floor')).toBe(a);
      v.create(TILE);
    }
    expect(v.cache.size).toBe(size);
    expect(size).toBe(2); // (mã × vai sàn) + (mã không vai)
  });

  it('loại không có dải (bê tông) → sàn dùng chung đúng vật liệu của chỗ khác (không tạo biến thể)', () => {
    const v = vendor();
    expect(v.create(lib('concrete-polished'), 'floor')).toBe(v.create(lib('concrete-polished')));
    expect(v.cache.size).toBe(1);
  });
});

describe('cờ tắt', () => {
  it('?disable=floorrough → sàn = vật liệu chung như trước vòng 5 (không kẹp, không vai)', () => {
    flags.floorRough = false;
    const v = vendor();
    const floor = v.create(MARBLE, 'floor')!;
    expect(floor).toBe(v.create(MARBLE));
    expect(bandOfNode(floor)).toEqual([0, 1]); // chỉ nhiễu bề mặt
    expect(floor.userData.realismRole).toBeUndefined();
  });

  it('cờ materials tắt (?mat=none/realism tắt) → preset và vật liệu nguyên', () => {
    useRealism.setState({ flags: { ...DEFAULT_REALISM_FLAGS, materials: false } });
    const v = vendor();
    const floor = v.create(MARBLE, 'floor')!;
    expect(floor).toBe(v.create(MARBLE));
    expect(floor.userData).toEqual({});
    const preset = getMaterialPresetByRef(MARBLE)!;
    expect(floorFinishPreset(MARBLE, preset, 'floor')).toBe(preset);
  });
});
