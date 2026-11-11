import { afterEach, describe, expect, it } from 'vitest';

import { UPHOLSTERY_PALETTE } from '../scenePalette';
import {
  drapeColourOf,
  drapeFabricOf,
  drapeFileFolderOf,
  drapeHeightMm,
  parseDrape,
  setDrapeFlags,
} from '../sceneDressingDrape';
import { SCENE_STYLE_IDS, SCENE_STYLES } from '../sceneStyles';

afterEach(() => setDrapeFlags([]));

describe('drape — luật thuần', () => {
  it('đọc cờ URL', () => {
    expect([...parseDrape('?drape=light,tall')]).toEqual(['light', 'tall']);
    expect([...parseDrape('?drape=all')]).toEqual(['light', 'tall', 'uv']);
    expect([...parseDrape('?drape=foo')]).toEqual([]);
    expect([...parseDrape('')]).toEqual([]);
  });

  it('rèm luôn vải dệt (lanh/cotton) ở mọi phong cách, không da/boucle', () => {
    for (const id of SCENE_STYLE_IDS) expect(drapeFabricOf(SCENE_STYLES[id])).toMatch(/^library:fabric-(linen|cotton)$/);
    expect(drapeFabricOf(SCENE_STYLES['go-am'])).toBe('library:fabric-linen');
    expect(drapeFabricOf(SCENE_STYLES['sang-trong-toi'])).toBe('library:fabric-linen');
    expect(drapeFabricOf(SCENE_STYLES['hien-dai-sang'])).toBe('library:fabric-cotton');
  });

  it('màu rèm = màu chăn ga sáng của phong cách, không màu bọc sofa', () => {
    expect(drapeColourOf('go-am')).toBe(UPHOLSTERY_PALETTE.goAmBedding);
    expect(drapeColourOf('sang-trong-toi')).toBe(UPHOLSTERY_PALETTE.sangTrongBedding);
    for (const id of SCENE_STYLE_IDS) expect(drapeColourOf(id)).not.toBe(UPHOLSTERY_PALETTE.goAm);
  });

  it('chiều cao = tầng − 100 mm, không thấp hơn cỡ catalog', () => {
    expect(drapeHeightMm(3200, 2272)).toBe(3100);
    expect(drapeHeightMm(2700, 2272)).toBe(2600);
    expect(drapeHeightMm(2200, 2272)).toBe(2272);
  });

  it('thư mục GLB có UV chỉ khi bật uv', () => {
    expect(drapeFileFolderOf('curtain')).toBeUndefined();
    setDrapeFlags(['uv']);
    expect(drapeFileFolderOf('curtain')).toBe('curtain-uv');
    expect(drapeFileFolderOf('sofa')).toBeUndefined();
  });
});
