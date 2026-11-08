import { describe, expect, it } from 'vitest';

import sharp from 'sharp';

import { join, parse, resolve } from 'node:path';

import { readFileSync } from 'node:fs';

import { OUT_MARKER, buildDefaults, collectRefs, decodeKtx2, licenceProblems, missingRefs, parseConstString, parseStringRecord, repeatMOf, resolveFinishes, sourceOfMap, unsafeOutReason } from '../export-pack/lib.mjs';

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
  it('unsafeOutReason: chặn đường tương đối, gốc ổ, repo, thư mục lạ; cho phép rỗng/chưa có/có dấu', () => {
    const root = resolve('/ws/AppFront');
    const none = { exists: () => false, readdir: () => [] };
    const dir = (d, names) => ({ exists: (p) => p === d || names.some((n) => join(d, n) === p), readdir: () => names });
    expect(unsafeOutReason('pack', root, none)).toMatch(/tuyệt đối/);
    expect(unsafeOutReason(undefined, root, none)).toMatch(/tuyệt đối/);
    expect(unsafeOutReason(parse(root).root, root, none)).toMatch(/gốc ổ/);
    expect(unsafeOutReason(root, root, none)).toMatch(/chứa thư mục repo/);
    expect(unsafeOutReason(resolve('/ws'), root, none)).toMatch(/chứa thư mục repo/);
    expect(unsafeOutReason(join(root, 'src'), root, none)).toMatch(/nằm trong repo/);
    expect(unsafeOutReason(join(root, 'node_modules', '.cache', 'export-pack'), root, none)).toMatch(/nằm trong repo/);
    expect(unsafeOutReason(join(root, 'node_modules', '.cache', 'export-pack', 'p1'), root, none)).toBeNull();
    expect(unsafeOutReason(resolve('/ws/AppFront-other'), root, none)).toBeNull();
    const out = resolve('/runs/pack');
    expect(unsafeOutReason(out, root, dir(out, []))).toBeNull();
    expect(unsafeOutReason(out, root, dir(out, ['manifest.json', OUT_MARKER]))).toBeNull();
    expect(unsafeOutReason(out, root, dir(out, ['notes.txt']))).toMatch(/không rỗng/);
  });
});

describe('export-pack giấy phép (M2)', () => {
  const OVERRIDE_DIR = resolve(import.meta.dirname, '..', '..', 'assets', 'export-pack-materials');
  const overrides = JSON.parse(readFileSync(join(OVERRIDE_DIR, 'LICENSES.json'), 'utf8'));

  it('licenceProblems: CC0/CC BY/MIT (Pascal) có tác giả thì đạt; "chưa rõ", thiếu tác giả thì hỏng; màu phẳng không xét', () => {
    const ok = { license: 'CC0', author: 'ambientCG', maps: { base: 'x' } };
    expect(licenceProblems({ materials: { a: ok, b: { ...ok, license: 'MIT (Pascal)', author: 'Pascal' } }, models: { m: { license: 'CC BY 4.0 (https://…)', author: 'X' } } })).toEqual([]);
    const bad = licenceProblems({
      materials: { a: { ...ok, license: 'Pascal, MIT?' }, flat: { maps: {} } },
      models: { m: { license: 'chưa rõ', author: 'AppFront' }, n: { license: 'CC0 1.0', author: '' }, p: { license: 'project code', author: 'AppFront' } },
    });
    expect(bad).toHaveLength(4);
    expect(bad.join(' ')).toMatch(/material:a/);
    expect(bad.join(' ')).toMatch(/model:n thiếu tác giả/);
  });

  it('repeatMOf: mét mỗi lần lặp = 1 / repeatX; số lạ → 1', () => {
    expect(repeatMOf(1)).toBe(1);
    expect(repeatMOf(4)).toBe(0.25);
    expect(repeatMOf(3)).toBe(0.3333);
    expect(repeatMOf(0)).toBe(1);
    expect(repeatMOf(undefined)).toBe(1);
  });

  it('bốn ảnh thay thế: ambientCG CC0 có tác giả, đủ tệp, đúng 512 px', async () => {
    expect(Object.keys(overrides).sort()).toEqual(['fabric-linen', 'fabric-wool', 'flooring-statuarettowhite', 'flooring-tile20']);
    expect(licenceProblems({ materials: Object.fromEntries(Object.entries(overrides).map(([id, o]) => [id, { ...o, maps: o.files }])) })).toEqual([]);
    for (const [id, o] of Object.entries(overrides)) {
      expect(o.source).toMatch(/^https:\/\/ambientcg\.com\/a\//);
      for (const file of Object.values(o.files)) {
        const meta = await sharp(join(OVERRIDE_DIR, id, file)).metadata();
        expect([meta.width, meta.height], `${id}/${file}`).toEqual([512, 512]);
      }
    }
  });
});
