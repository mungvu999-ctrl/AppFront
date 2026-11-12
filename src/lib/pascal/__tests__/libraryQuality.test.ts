// @vitest-environment node
/**
 * Dữ liệu chất lượng thư viện (`libraryQuality.json`, sinh bởi `scripts/gen-library-quality.mjs`): đúng schema, phủ
 * mọi id có vai, tỉ phần hợp lệ, giải nén không mất dữ liệu (băm `rev` khớp), và `parts` là màu theo DIỆN TÍCH trên
 * vùng UV thực dùng — không phải trung bình cả texture.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { expandLibraryQuality, LIBRARY_QUALITY, LIBRARY_QUALITY_SCHEMA, qualityOf } from '../libraryQuality';
import ROLES from '../libraryRoles.json' with { type: 'json' };
import ROLES2 from '../libraryRoles2.json' with { type: 'json' };

type Lab = [number, number, number];
interface Measure {
  clusters: unknown[];
  imageMean: Lab | null;
}
interface GenModule {
  measureDocument(doc: Document): Promise<Measure>;
  partsOf(m: Measure, ctx: { role?: string; profMats?: string[] }): { share: number; lab: Lab; kind: string }[] | undefined;
  makeIO(): Promise<{ read(path: string): Promise<Document> }>;
  dE(a: readonly number[], b: readonly number[]): number;
  linToLab(lin: readonly number[]): Lab;
  HMAP_GRID: number;
  frontOf(hm: ArrayLike<number>, role: string | undefined, prev?: 'ok' | 'suspect', aspect?: number): { front: { check: string; by: string; sym?: string } };
  shapeOf(hm: ArrayLike<number>, role: string | undefined): 'L' | undefined;
}
interface Check {
  id: string;
  file: string;
  role: string;
  profMats: string[];
}
const SCRIPT =new URL('../../../../scripts/gen-library-quality.mjs', import.meta.url).href;
const gen = async () => (await import(/* @vite-ignore */ SCRIPT)) as GenModule;

const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

const roleIds = [...Object.entries(ROLES.roles), ...Object.entries(ROLES2.roles)].flatMap(([role, ids]) => (ids as string[]).map((id) => [id, role] as const));
const models = Object.entries(LIBRARY_QUALITY.models);

describe('libraryQuality.json', () => {
  it('đúng phiên bản schema và rev = băm models (giải nén không mất dữ liệu)', () => {
    expect(LIBRARY_QUALITY.schema).toBe(LIBRARY_QUALITY_SCHEMA);
    expect(LIBRARY_QUALITY.rev).toBe(createHash('sha256').update(stable(LIBRARY_QUALITY.models)).digest('hex').slice(0, 16));
  });

  it('mọi id có vai đều có mục, vai khớp một vai của id', () => {
    const missing = roleIds.filter(([id]) => !qualityOf(id)).map(([id]) => id);
    expect(missing).toEqual([]);
    const rolesOf = new Map<string, string[]>();
    for (const [id, role] of roleIds) rolesOf.set(id, [...(rolesOf.get(id) ?? []), role]);
    for (const [id, q] of models) expect(rolesOf.get(id), id).toContain(q.role);
  });

  it('parts: share ∈ (0,1], tổng ≤ 1,01, giảm dần, ≤ 4 phần, Lab trong miền', () => {
    let withParts = 0;
    for (const [id, q] of models) {
      if (!q.parts) continue;
      withParts++;
      expect(q.parts.length, id).toBeLessThanOrEqual(4);
      let sum = 0;
      let prev = 1;
      for (const p of q.parts) {
        expect(p.share, id).toBeGreaterThan(0);
        expect(p.share, id).toBeLessThanOrEqual(prev);
        prev = p.share;
        sum += p.share;
        expect(p.lab[0], id).toBeGreaterThanOrEqual(0);
        expect(p.lab[0], id).toBeLessThanOrEqual(100);
        expect(p.kindBy).toBe('i');
        expect([undefined, 'mirror'], id).toContain(p.finish);
      }
      expect(sum, id).toBeLessThanOrEqual(1.01);
    }
    expect(withParts / models.length).toBeGreaterThan(0.9);
  });

  it('licence không rỗng, mặt trước theo quy ước +z, chi tiết đo được', () => {
    for (const [id, q] of models) {
      expect(q.licence.trim(), id).not.toBe('');
      expect(q.front.axis).toBe('+z');
      expect(q.useMm.every((v) => v > 0), id).toBe(true);
      expect(q.detail.tris, id).toBeGreaterThan(0);
    }
  });
});

describe('parts không phải trung bình texture', () => {
  it('atlas tổng hợp: chỉ dùng nửa đỏ của ảnh đỏ|xanh → phần chính đỏ, không tím', async () => {
    const { measureDocument, partsOf, dE } = await gen();
    const doc = new Document();
    const buf = doc.createBuffer();
    const png = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const tex = doc.createTexture().setImage(new Uint8Array(png)).setMimeType('image/png');
    const mat = doc.createMaterial('m').setBaseColorTexture(tex);
    const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    const uv = doc.createAccessor().setType('VEC2').setBuffer(buf).setArray(new Float32Array([0, 0, 0.49, 0, 0.49, 1, 0, 1]));
    const idx = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat);
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
    const m = await measureDocument(doc);
    const parts = partsOf(m, {});
    const red: Lab = [53.2, 80.1, 67.2];
    expect(parts?.[0]?.share).toBe(1);
    expect(dE(parts?.[0]?.lab ?? [0, 0, 0], red)).toBeLessThan(2);
    expect(m.imageMean).not.toBeNull();
    expect(dE(parts?.[0]?.lab ?? [0, 0, 0], m.imageMean ?? [0, 0, 0])).toBeGreaterThan(30);
  });

  it('gương (metallic ≥ 0,9, roughness ≤ 0,15) thành phần riêng, không gộp với kim loại mờ cùng màu', async () => {
    const { measureDocument, partsOf } = await gen();
    const doc = new Document();
    const buf = doc.createBuffer();
    const scene = doc.createScene();
    const quad = (x0: number, w: number, rough: number) => {
      const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([x0, 0, 0, x0 + w, 0, 0, x0 + w, 1, 0, x0, 1, 0]));
      const idx = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
      const mat = doc.createMaterial().setBaseColorFactor([0.8, 0.8, 0.8, 1]).setMetallicFactor(1).setRoughnessFactor(rough);
      scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat))));
    };
    quad(0, 3, 0.5);
    quad(3, 1, 0.05);
    const parts = partsOf(await measureDocument(doc), {}) as unknown as { share: number; finish?: string }[];
    expect(parts.map((p) => [p.share, p.finish])).toEqual([
      [0.75, undefined],
      [0.25, 'mirror'],
    ]);
  });

  it('mẫu có phần gương: share > 0', () => {
    for (const [id, q] of models) for (const p of q.parts ?? []) if (p.finish === 'mirror') expect(p.share, id).toBeGreaterThan(0);
  });

  // Mẫu thật chọn TỰ ĐỘNG lúc sinh (một ảnh base, phần chính ≥ 50 %, ΔE lớn nhất với trung bình ảnh); chỉ chạy khi có GLB gốc.
  const CHECK = 'F:/runs/m12/q/atlas-check.json';
  const check = existsSync(CHECK) ? (JSON.parse(readFileSync(CHECK, 'utf8')) as Check) : null;
  it.skipIf(!check || !existsSync(check.file))('mẫu thật có atlas: đo lại khớp dữ liệu và khác xa trung bình ảnh', async () => {
    const { makeIO, measureDocument, partsOf, dE } = await gen();
    const c = check as Check;
    const q = qualityOf(c.id);
    const m = await measureDocument(await (await makeIO()).read(c.file));
    const main = q?.parts?.[0];
    expect(main).toBeDefined();
    expect(m.imageMean).not.toBeNull();
    expect(dE(main?.lab ?? [0, 0, 0], m.imageMean ?? [0, 0, 0])).toBeGreaterThan(15);
    const again = partsOf(m, { role: c.role, profMats: c.profMats })?.[0];
    expect(again?.share).toBeCloseTo(main?.share ?? -1, 2);
    expect(dE(again?.lab ?? [0, 0, 0], main?.lab ?? [0, 0, 0])).toBeLessThan(1);
  }, 60_000);
});

describe('schema v2: hướng mặt trước đo được, đối xứng, dáng L', () => {
  const head = { rev: 'x', generatedBy: 't', inputs: {}, dict: { licence: ['CC0'], sourcePrefix: ['s/'], author: [], kind: [], material: [], tier: ['light'] } };
  const row = { u: [1, 1, 1], d: [1, 1, 0, 0, 0], l: 0, o: [0, 'a'] };

  it('giải nén hàng v1 (f = 1 hoặc vắng) và hàng v2 (bit đo, đối xứng, dáng L)', () => {
    const v1 = expandLibraryQuality({ ...head, schema: 1, format: 'compact-1', models: { a: { ...row, f: 1 }, b: row } });
    expect(v1.models.a?.front).toEqual({ axis: '+z', check: 'suspect', by: 'import' });
    expect(v1.models.b?.front).toEqual({ axis: '+z', check: 'ok', by: 'import' });
    expect(v1.models.b?.shape).toBeUndefined();
    const v2 = expandLibraryQuality({ ...head, schema: 2, format: 'compact-2', models: { a: { ...row, f: 2, h: 'L' }, b: { ...row, f: 3 }, c: { ...row, f: 6 }, d: { ...row, f: 10 } } });
    expect(v2.models.a?.front).toEqual({ axis: '+z', check: 'ok', by: 'measured' });
    expect(v2.models.a?.shape).toBe('L');
    expect(v2.models.b?.front).toEqual({ axis: '+z', check: 'suspect', by: 'measured' });
    expect(v2.models.c?.front.sym).toBe('rot180');
    expect(v2.models.d?.front.sym).toBe('all');
  });

  // Bản đồ độ cao tổng hợp: hàng j theo z (j = 0 ở −Z), cột i theo x; -1 = trống.
  const grid = async (f: (i: number, j: number, g: number) => number) => {
    const { HMAP_GRID: g } = await gen();
    return Float32Array.from({ length: g * g }, (_, k) => f(k % g, Math.floor(k / g), g));
  };
  const sofa = (backAtNegZ: boolean) => (_i: number, j: number, g: number) => ((backAtNegZ ? j < 4 : j >= g - 4) ? 1 : 0.45);

  it('lưng ở −Z → ok, measured; lưng ở +Z → suspect, measured; lưng ở ±X → suspect', async () => {
    const { frontOf } = await gen();
    expect(frontOf(await grid(sofa(true)), 'sofa').front).toMatchObject({ check: 'ok', by: 'measured' });
    expect(frontOf(await grid(sofa(false)), 'sofa', 'ok').front).toMatchObject({ check: 'suspect', by: 'measured' });
    expect(frontOf(await grid((i) => (i < 4 ? 1 : 0.45)), 'doubleBed').front).toMatchObject({ check: 'suspect', by: 'measured' });
    // Không có lưng (ghế dài phẳng) → giữ quy ước nhập và kết quả kiểm cũ.
    expect(frontOf(await grid(() => 0.5), 'bench', 'suspect').front).toEqual({ axis: '+z', check: 'suspect', by: 'import' });
  });

  it('bàn tròn → sym all; bàn chữ nhật hai đầu như nhau → rot180; tủ không có tín hiệu → import', async () => {
    const { frontOf } = await gen();
    const round = await grid((i, j, g) => (Math.hypot(i + 0.5 - g / 2, j + 0.5 - g / 2) <= g / 2 ? 0.95 : -1));
    expect(frontOf(round, 'coffeeTable', 'ok', 1).front).toMatchObject({ by: 'measured', sym: 'all' });
    // Bàn dài: hộp bao 2:1 nên dù lưới vuông đối xứng 90° vẫn chỉ là rot180.
    expect(frontOf(round, 'diningTable', 'ok', 2).front).toMatchObject({ by: 'measured', sym: 'rot180' });
    // Một bên có bệ cao → không đối xứng → import.
    expect(frontOf(await grid((i) => (i < 6 ? 1 : 0.3)), 'coffeeTable').front).toEqual({ axis: '+z', check: 'ok', by: 'import' });
    expect(frontOf(round, 'dresser').front).toEqual({ axis: '+z', check: 'ok', by: 'import' });
  });

  it('sofa góc: một đầu sâu kín lưới, đầu kia nông → L; sofa thẳng → không', async () => {
    const { shapeOf } = await gen();
    expect(shapeOf(await grid((i, j, g) => (i >= g * 0.6 || j < g * 0.5 ? 0.5 : -1)), 'sofa')).toBe('L');
    expect(shapeOf(await grid(() => 0.5), 'sofa')).toBeUndefined();
    expect(shapeOf(await grid((i, j, g) => (i >= g * 0.6 || j < g * 0.5 ? 0.5 : -1)), 'armchair')).toBeUndefined();
  });

  it('dữ liệu thật: đối xứng chỉ ở vai không phải ghế/giường, import không có sym, dáng L chỉ ở sofa', () => {
    const seatBed = new Set(['sofa', 'armchair', 'diningChair', 'bench', 'doubleBed', 'singleBed']);
    for (const [id, q] of models) {
      if (q.front.sym) {
        expect(q.front.by, id).toBe('measured');
        expect(seatBed.has(q.role ?? ''), id).toBe(false);
      }
      if (q.shape) expect(q.role, id).toBe('sofa');
    }
  });

  it('dữ liệu thật: giường đo được gần như đều có đầu giường ở −Z (ok)', () => {
    const beds = models.filter(([, q]) => /Bed$/.test(q.role ?? '') && q.front.by === 'measured');
    expect(beds.length).toBeGreaterThan(10);
    const suspect = beds.filter(([, q]) => q.front.check === 'suspect').map(([id]) => id);
    expect(suspect.length / beds.length, suspect.join(', ')).toBeLessThanOrEqual(0.1);
  });
});
