import { DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { cutCapVariant } from './cutSync';
import { FLOOR_FINISHES, roughFloor } from './floorFinish';
import { CAP_TOP_FOLDER, parseMat, parseMatx } from './matx';

describe('M5-LC cờ ?mat=', () => {
  it('parseMat đọc cap-top/floor-rough/all, độc lập với ?matx=', () => {
    expect([...parseMat('?mat=cap-top')]).toEqual(['cap-top']);
    expect([...parseMat('?mat=all')]).toEqual(['cap-top', 'floor-rough']);
    expect(parseMatx('?mat=floor-rough').size).toBe(0);
  });

  it('không cờ = bật cả hai (vòng 5); ?mat=none = baseline cũ; ?disable= tắt từng cái', () => {
    expect([...parseMat('')]).toEqual(['cap-top', 'floor-rough']);
    expect([...parseMat('?matx=floor')]).toEqual(['cap-top', 'floor-rough']);
    expect(parseMat('?mat=none').size).toBe(0);
    expect([...parseMat('?disable=captop')]).toEqual(['floor-rough']);
    expect([...parseMat('?disable=ao,floorrough')]).toEqual(['cap-top']);
    expect(parseMat('?mat=cap-top&disable=captop').size).toBe(0);
  });

  it('cap-top chỉ cho thư mục dạng tủ kín (mẫu Pascal + thư viện máy chủ)', () => {
    for (const f of ['wardrobe-sf', 'wardrobe-pro', 'storage-wardrobe-greywash', 'dresser-sf', 'kitchen-cabinet-gen', 'fridge-sf'])
      expect(CAP_TOP_FOLDER.test(f)).toBe(true);
    for (const f of ['curtain', 'plant-ph', 'indoor-plant', 'bed-sf', 'sofa']) expect(CAP_TOP_FOLDER.test(f)).toBe(false);
  });

  it('cap-top bỏ đồ mở: kệ sách, kệ, kệ tivi, console', () => {
    for (const f of ['bookshelf', 'bookshelf-ph', 'kitchen-shelf', 'shelf', 'tv-stand', 'tv-unit', 'bookcase', 'console-table', 'storage-box'])
      expect(CAP_TOP_FOLDER.test(f)).toBe(false);
  });
});

describe('cutCapVariant với vật liệu hai mặt (đỉnh tủ đen khi Tường: cắt)', () => {
  it('mặc định giữ nguyên vật liệu hai mặt (rèm, lá) — baseline không đổi', () => {
    const ds = new MeshStandardMaterial({ side: DoubleSide });
    expect(cutCapVariant(ds)).toBe(ds);
  });

  it('capDoubleSided: tủ hai mặt nhận biến thể nắp, gốc không bị vá, không đổi shadowSide', () => {
    const ds = new MeshStandardMaterial({ side: DoubleSide });
    const v = cutCapVariant(ds, true);
    expect(v).not.toBe(ds);
    expect(v.side).toBe(DoubleSide);
    expect(v.shadowSide).toBeNull();
    expect((v as unknown as { emissiveNode?: unknown }).emissiveNode).toBeTruthy();
    expect((ds as unknown as { colorNode?: unknown }).colorNode).toBeUndefined();
    expect(ds.side).toBe(DoubleSide);
  });

  it('capDoubleSided bỏ qua lá alphaTest và vật liệu trong suốt', () => {
    const leaf = new MeshStandardMaterial({ side: DoubleSide, alphaTest: 0.5 });
    const glass = new MeshStandardMaterial({ side: FrontSide, transparent: true });
    expect(cutCapVariant(leaf, true)).toBe(leaf);
    expect(cutCapVariant(glass, true)).toBe(glass);
  });
});

describe('roughFloor (?mat=floor-rough)', () => {
  it('gỗ/gạch/đá: roughnessNode kẹp dưới, clearcoat 0; bê tông giữ nguyên', () => {
    const wood = new MeshPhysicalNodeMaterial({ roughness: 0.2, clearcoat: 1 });
    expect(roughFloor(wood as never, FLOOR_FINISHES['flooring-woodparquet76']!)).toBe(true);
    expect(wood.roughnessNode).toBeTruthy();
    expect(wood.clearcoat).toBe(0);
    const tile = new MeshPhysicalNodeMaterial({ roughness: 0.1 });
    expect(roughFloor(tile as never, FLOOR_FINISHES['flooring-tile79']!)).toBe(true);
    const concrete = new MeshPhysicalNodeMaterial({ roughness: 0.1, clearcoat: 1 });
    expect(roughFloor(concrete as never, FLOOR_FINISHES['concrete-polished']!)).toBe(false);
    expect(concrete.roughnessNode).toBeNull();
    expect(concrete.clearcoat).toBe(1);
  });
});
