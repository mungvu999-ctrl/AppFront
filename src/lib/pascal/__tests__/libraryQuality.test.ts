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

import { LIBRARY_QUALITY, LIBRARY_QUALITY_SCHEMA, qualityOf } from '../libraryQuality';
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
