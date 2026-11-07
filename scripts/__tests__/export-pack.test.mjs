import { describe, expect, it } from 'vitest';

import sharp from 'sharp';

import { buildDefaults, collectRefs, decodeKtx2, missingRefs, parseConstString, parseStringRecord, resolveFinishes, sourceOfMap } from '../export-pack/lib.mjs';

describe('export-pack lib', () => {
  it('sourceOfMap: ktx2 qua sourceFor, webp thẳng, thiếu → null', () => {
    const exists = (p) => !p.includes('missing');
    const sf = (m) => {
      if (m.includes('bad')) throw new Error('x');
      return `/src${m}.webp`;
    };
    expect(sourceOfMap('/a', '/m/x_512.ktx2', sf, exists)).toBe('/src/m/x_512.ktx2.webp');
    expect(sourceOfMap('/a', '/m/bad_512.ktx2', sf, exists)).toBeNull();
    expect(sourceOfMap('/a', '/m/s.webp', sf, exists).replaceAll('\\', '/')).toBe('/a/m/s.webp');
    expect(sourceOfMap('/a', '/m/missing.webp', sf, exists)).toBeNull();
  });
  it('buildDefaults: variant x kind và kind', () => {
    const d = buildDefaults(['bed', 'stair'], ['wc', 'rug'], { wc: { folder: 'toilet' }, rug: null }, (k) => (k === 'bed' ? 'double-bed' : null));
    expect(d).toEqual({ bed: 'double-bed', 'bed|wc': 'toilet', 'stair|wc': 'toilet' });
  });
  it('resolveFinishes: library/scene, thiếu ảnh, ref lạ', () => {
    const mats = { a: { hasTexture: true, maps: { base: 'x' } }, b: { hasTexture: true, maps: {} } };
    const { out, missing } = resolveFinishes({ wood: 'library:a', tile: 'library:b', mosaic: 'scene:s', decking: 'library:zz' }, mats, { s: { hasTexture: false, maps: {} } });
    expect(Object.keys(out)).toEqual(['wood', 'tile', 'mosaic']);
    expect(out.wood.ref).toBe('library:a');
    expect(missing).toHaveLength(2);
  });
  it('collectRefs/missingRefs/parse*', () => {
    const refs = collectRefs({ a: 'library:x', b: { c: ['scene:y', 'zz'] } });
    expect([...refs]).toEqual(['library:x', 'scene:y']);
    expect(missingRefs(refs, { x: 1 }, {})).toEqual(['editor-defaults:scene:y']);
    const src = "const U: Readonly<Record<string, string>> = {\n  a: 'wood',\n  b: 'tile',\n};\nconst K = 'library:k';";
    expect(parseStringRecord(src, 'U')).toEqual({ a: 'wood', b: 'tile' });
    expect(parseConstString(src, 'K')).toBe('library:k');
  });
  it('decodeKtx2: KTX2 thật của vendor → RGBA 512², tệp hỏng → null', async () => {
    const dir = new URL('../../vendor/pascal/assets/material/concrete/plaster_painted/', import.meta.url);
    const img = await decodeKtx2(new URL('plaster_painted_basecolor_512.ktx2', dir), sharp);
    const { info } = await img.raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([512, 512, 4]);
    expect(await decodeKtx2(new URL('plaster_painted_thumb.webp', dir), sharp)).toBeNull();
  });
});
