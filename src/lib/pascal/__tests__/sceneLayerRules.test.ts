/**
 * Luật lớp cảnh vòng 6 phần chọn mẫu (`sceneVariety.ts`): `orient` (B) — món sinh khớp mẫu theo hướng trục, không đổi
 * họ màu chỉ để khớp hướng; tắt riêng bằng `rulesOff`/`?disable=orient`; món không phải đồ sinh giữ nguyên.
 */
import { describe, expect, it } from 'vitest';

import type { Furniture } from '@/domain/spatial/types';

import { registerServerLibrary } from '../furnitureCatalog';
import { sceneRulesOffOf } from '../sceneLayer';
import { sceneStyleOf } from '../sceneStyles';
import { modelFolderOf, orientedGenerated, woodToneOf, type LayerStyle } from '../sceneVariety';

const style: LayerStyle = { ...sceneStyleOf(undefined), rulesOff: new Set() };
const off = (name: string): LayerStyle => ({ ...style, rulesOff: new Set([name]) });

const piece = (id: string, kind: Furniture['kind'], w: number, d: number, extra: Partial<Furniture> = {}): Furniture =>
  ({
    id,
    levelId: 'L-1',
    roomId: 'R-1',
    kind,
    centre: { x: 1000, y: 1000 },
    boundingBox: { min: { x: 1000 - w / 2, y: 1000 - d / 2 }, max: { x: 1000 + w / 2, y: 1000 + d / 2 } },
    rotationDeg: 0,
    source: 'ai',
    reviewed: false,
    confidence: 1,
    ...extra,
  }) as Furniture;
const model = (id: string, widthMm: number, depthMm: number, heightMm = 800) => ({
  id,
  widthMm,
  depthMm,
  heightMm,
  modelUrl: `https://x.test/${id}.glb`,
  attribution: 'a · CC0',
});

describe('luật orient (B)', () => {
  // Thảm kem (scandinavian, mẫu dài theo sâu) và thảm đen hoa văn (đúng hướng hộp nhưng khác họ màu).
  registerServerLibrary([model('rug-cream-hex', 1710, 2490, 10), model('rug-black-lattice', 2490, 1710, 10)]);
  // Tủ áo: mẫu kem nằm ngang hộp (chọn trước theo độ rực), mẫu kem đúng hướng, mẫu xám đúng hướng.
  registerServerLibrary([model('wardrobe-white-oak', 600, 2000, 2000), model('storage-wardrobe-mirror', 2000, 600, 2000), model('storage-wardrobe-greywash', 2000, 600, 2000)]);

  const rug = piece('DRESS-rug-R-1', 'other', 2320, 1400, { variant: 'rug', heightMm: 10 } as Partial<Furniture>);

  it('thảm sinh nằm ngang mẫu: xoay món 90°, dấu chân giữ nguyên, GIỮ đúng mẫu kem (không thành thảm đen)', () => {
    expect(modelFolderOf(rug, style, 'livingRoom')).toBe('rug-cream-hex');
    const turned = orientedGenerated(rug, style, 'livingRoom');
    expect(turned.rotationDeg).toBe(90);
    expect(turned.boundingBox.max.x - turned.boundingBox.min.x).toBe(1400);
    expect(turned.boundingBox.max.y - turned.boundingBox.min.y).toBe(2320);
    expect(turned.centre).toEqual(rug.centre);
    expect(modelFolderOf(turned, style, 'livingRoom')).toBe('rug-cream-hex');
    // Đã đúng hướng thì không xoay lần nữa (idempotent).
    expect(orientedGenerated(turned, style, 'livingRoom')).toBe(turned);
  });

  it('tắt `orient` hoặc món không phải đồ sinh: giữ nguyên', () => {
    expect(orientedGenerated(rug, off('orient'), 'livingRoom')).toBe(rug);
    const aiRug = { ...rug, id: 'F-RUG000000001' } as Furniture;
    expect(orientedGenerated(aiRug, style, 'livingRoom')).toBe(aiRug);
  });

  it('món sinh có mặt trước (tủ áo) nằm ngang mẫu: đổi sang mẫu CÙNG họ màu đúng hướng, không sang họ màu khác', () => {
    const closet = piece('DRESS-closet-R-1', 'wardrobe', 2000, 600, { heightMm: 2000 } as Partial<Furniture>);
    expect(modelFolderOf(closet, off('orient'), 'bedroom')).toBe('wardrobe-white-oak');
    expect(modelFolderOf(closet, style, 'bedroom')).toBe('storage-wardrobe-mirror');
    // Không xoay món có mặt trước.
    expect(orientedGenerated(closet, style, 'bedroom')).toBe(closet);
    // Đồ AI/người dùng giữ cách chọn cũ.
    expect(modelFolderOf({ ...closet, id: 'F-CLOSET000001' } as Furniture, style, 'bedroom')).toBe('wardrobe-white-oak');
  });

  it('cờ URL: `?disable=orient,fit` tách đúng tên luật', () => {
    expect([...sceneRulesOffOf('?disable=orient,fit&x=1')]).toEqual(['orient', 'fit']);
    expect(sceneRulesOffOf('').size).toBe(0);
  });
});

describe('luật tone (C): một tông gỗ cho đồ SINH, đồ AI/người dùng không đổi mẫu', () => {
  registerServerLibrary([model('shelf-industrial-metal', 800, 350, 1800), model('shelf-iron-wood-geometric-b', 800, 350, 1800)]);
  const industrial: LayerStyle = { ...style, libraryStyles: ['industrial'] };
  const shelf = (id: string) => piece(id, 'other', 800, 350, { variant: 'shelves', heightMm: 1800 } as Partial<Furniture>);

  const dark: LayerStyle = { ...industrial, woodTone: 'd' };
  const darkOff: LayerStyle = { ...dark, rulesOff: new Set(['tone']) };

  it('món sinh theo tông của căn; món AI giữ mẫu cũ; tắt `tone` thì như cũ', () => {
    const dress = shelf('DRESS-shelf-R-1');
    const ai = shelf('F-SHELF0000001');
    expect(modelFolderOf(dress, industrial, 'livingRoom')).toBe('shelf-iron-wood-geometric-b');
    expect(modelFolderOf(dress, dark, 'livingRoom')).toBe('shelf-industrial-metal');
    expect(modelFolderOf(dress, darkOff, 'livingRoom')).toBe('shelf-iron-wood-geometric-b');
    expect(modelFolderOf(ai, dark, 'livingRoom')).toBe('shelf-iron-wood-geometric-b');
  });

  it('tông của căn: đa số đồ có sẵn (bỏ đồ sinh), không có thì theo mã phong cách đầu', () => {
    const saved = (id: string, folder: string) => ({ f: { ...shelf(id), model: { id: 'x', src: `/items/${folder}/model.glb` } } as Furniture });
    expect(woodToneOf([saved('F-1', 'shelf-industrial-metal'), saved('F-2', 'shelf-industrial-metal'), saved('F-3', 'shelf-iron-wood-geometric-b')], style)).toBe('d');
    expect(woodToneOf([saved('DRESS-a', 'shelf-industrial-metal')], { ...style, libraryStyles: ['scandinavian'] })).toBe('l');
    expect(woodToneOf([], { ...style, libraryStyles: ['modern-lux'] })).toBe('d');
    expect(woodToneOf([], { ...style, libraryStyles: [] })).toBeUndefined();
  });
});
