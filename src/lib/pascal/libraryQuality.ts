/**
 * Dữ liệu chất lượng thư viện (vòng 12) — schema có phiên bản, sinh theo lô bởi `scripts/gen-library-quality.mjs`,
 * KHÔNG sửa tay. Bộ chọn bộ nội thất (`roomSet.ts`) chỉ đọc qua tệp này.
 *
 * Mỗi thuộc tính ghi rõ nguồn: `m` = đo được từ tệp GLB / danh mục, `i` = suy luận (gắn nhãn từ ảnh, phân loại theo
 * tên vật liệu). Thuộc tính VẮNG = chưa biết — bộ chọn coi "chưa biết" là không đủ tin cho ràng buộc cứng.
 */

import data from './libraryQuality.json';

export const LIBRARY_QUALITY_SCHEMA = 2;

export type QualityBy = 'm' | 'i';

/** Mức hoàn thiện. Giường: `full` = nệm + chăn/ga + gối; `partial` = có nệm phủ ga nhưng thiếu gối hoặc chăn; `bare` = khung hoặc nệm trần. */
export type Completeness = 'full' | 'partial' | 'bare';

/** Nhãn texture vải (xem tay từ ảnh): `broken` = vân vỡ/loang patchwork khi dựng, `unsure` = nghi; vắng = ok hoặc chưa xem. */
export type TextureFlag = 'broken' | 'unsure';

export type PartKind = 'upholstery' | 'bedding' | 'frame' | 'top' | 'metal' | 'glass' | 'other';
export type PartMaterial = 'wood' | 'fabric' | 'leather' | 'metal' | 'stone' | 'glass' | 'plastic' | 'ceramic';

/** Một phần chính của món: tỉ phần DIỆN TÍCH BỀ MẶT (không phải trung bình cả texture), màu Lab trên vùng UV thực dùng. */
export interface QualityPart {
  readonly kind: PartKind;
  /** Tỉ phần diện tích bề mặt 0..1 (đo). */
  readonly share: number;
  /** Màu Lab [L, a, b] (đo). */
  readonly lab: readonly [number, number, number];
  /** Chất liệu (suy luận từ tên vật liệu / thông số PBR / nhãn ảnh); vắng = chưa biết. */
  readonly material?: PartMaterial;
  /** Nguồn của `kind`. */
  readonly kindBy: QualityBy;
  /** Bề mặt gương (đo): metallic ≥ 0,9 và roughness ≤ 0,15 trên vùng UV dùng, không trong suốt; vắng = không phải gương. */
  readonly finish?: 'mirror';
}

/**
 * Hướng mặt trước. `axis` luôn '+z' (quy ước nhập). `by`: 'measured' = đã đo từ hình học (lưng/đầu giường ở −Z → `ok`,
 * ở +Z hoặc ±X → `suspect`; hoặc món đối xứng), 'import' = chỉ là giả định theo quy ước nhập (`check` giữ kết quả kiểm
 * ảnh cũ). `sym`: 'rot180' = giống nhau khi xoay 180°, 'all' = giống khi xoay 90° (mặt trước không quan trọng).
 */
export interface QualityFront {
  readonly axis: '+z';
  readonly check: 'ok' | 'suspect';
  /** Bộ giải nén luôn ghi; tuỳ chọn trong kiểu chỉ để mẫu dựng tay (test) kiểu v1 vẫn hợp lệ — vắng = 'import'. */
  readonly by?: 'import' | 'measured';
  readonly sym?: 'rot180' | 'all';
}

export interface ModelQuality {
  /** Vai sử dụng (cùng tên vai với `libraryRoles.json` / `libraryRoles2.json`); vắng = chưa xếp vai. */
  readonly role?: string;
  /** Kích thước sử dụng [rộng, cao, sâu] mm (đo từ hộp bao GLB đã chuẩn hoá). */
  readonly useMm: readonly [number, number, number];
  /** Hướng mặt trước (xem {@link QualityFront}). */
  readonly front: QualityFront;
  /** Dáng sofa góc chữ L (đo từ bản đồ chiếm chỗ nhìn từ trên); vắng = dáng thẳng hoặc không áp dụng. */
  readonly shape?: 'L';
  /** Mức hoàn thiện; vắng = chưa biết hoặc không áp dụng cho vai này. */
  readonly completeness?: { readonly v: Completeness; readonly by: QualityBy };
  /** Cờ texture vải; vắng = ok hoặc chưa xem. */
  readonly texture?: { readonly v: TextureFlag; readonly by: QualityBy };
  /** Các phần chính, tỉ phần giảm dần; vắng = chưa đo được. */
  readonly parts?: readonly QualityPart[];
  /** Mã phong cách (suy luận từ ảnh). */
  readonly styles?: readonly string[];
  /** Mức chi tiết và chi phí (đo). */
  readonly detail: {
    readonly tris: number;
    readonly kb: number;
    readonly textures: number;
    readonly maxTex: number;
    readonly tier: 'light' | 'medium' | 'heavy';
  };
  /** Giấy phép và nguồn (từ danh mục backend `files.json`). */
  readonly licence: string;
  readonly source: string;
  readonly author?: string;
  /** Lỗi kiểm chất lượng đã biết (QC); có phần tử = không dùng làm ứng viên. */
  readonly issues?: readonly string[];
}

export interface LibraryQualityFile {
  readonly schema: number;
  /** Băm nội dung `models` — đổi khi bất kỳ dữ liệu nào đổi; dùng làm khoá vô hiệu cache. */
  readonly rev: string;
  readonly generatedBy: string;
  readonly inputs: Readonly<Record<string, string>>;
  /** Luật sinh (ngưỡng tier, cách gom phần, luật ghép nhãn) — chỉ để đọc, tuỳ chọn. */
  readonly rules?: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<string, ModelQuality>>;
}

/** Dạng nén trong tệp JSON (giữ bundle ≤ 150 KB): từ điển + hàng khoá ngắn; `kindBy` luôn 'i', `front.axis` luôn '+z'. */
interface CompactRow {
  r?: string;
  u: [number, number, number];
  /** Cờ hướng: 1 = suspect, 2 = measured, 4 = sym rot180, 8 = sym all. Hàng v1 chỉ có 1 hoặc vắng → by 'import'. */
  f?: number;
  h?: 'L';
  c?: string;
  /** Cờ texture: 1 = broken, 2 = unsure. */
  t?: number;
  p?: number[][];
  s?: string[];
  d: [number, number, number, number, number];
  l: number;
  o: [number, string];
  a?: number;
  q?: string[];
}
interface CompactFile extends Omit<LibraryQualityFile, 'models'> {
  readonly dict: { licence: string[]; sourcePrefix: string[]; author: string[]; kind: PartKind[]; material: PartMaterial[]; tier: ModelQuality['detail']['tier'][] };
  readonly models: Record<string, CompactRow>;
}
const COMPLETENESS: Record<string, Completeness> = { f: 'full', p: 'partial', b: 'bare' };

/** Giải cờ hướng (v1: chỉ bit 1; v2: thêm bit đo và đối xứng). */
export const frontOfFlags = (f: number): QualityFront => ({
  axis: '+z',
  check: f & 1 ? 'suspect' : 'ok',
  by: f & 2 ? 'measured' : 'import',
  ...(f & 4 ? { sym: 'rot180' as const } : f & 8 ? { sym: 'all' as const } : {}),
});

const expandRow = (dict: CompactFile['dict'], x: CompactRow): ModelQuality => {
  const comp = x.c ? COMPLETENESS[x.c[0] ?? ''] : undefined;
  return {
    ...(x.r ? { role: x.r } : {}),
    useMm: x.u,
    front: frontOfFlags(x.f ?? 0),
    ...(x.h === 'L' ? { shape: 'L' as const } : {}),
    ...(comp ? { completeness: { v: comp, by: x.c?.[1] === 'm' ? 'm' : 'i' } } : {}),
    ...(x.t === 1 || x.t === 2 ? { texture: { v: x.t === 1 ? ('broken' as const) : ('unsure' as const), by: 'i' as const } } : {}),
    ...(x.p
      ? {
          // Hàng phần: [kind, share%, L, a, b, material?, finish?]; material -1 = vắng; finish 1 = mirror.
          parts: x.p.map(([k = 6, s = 0, L = 0, A = 0, B = 0, m, f]) => {
            const material = m === undefined || m < 0 ? undefined : dict.material[m];
            return {
              kind: dict.kind[k] ?? 'other',
              share: s / 100,
              lab: [L, A, B] as const,
              ...(material ? { material } : {}),
              kindBy: 'i' as const,
              ...(f === 1 ? { finish: 'mirror' as const } : {}),
            };
          }),
        }
      : {}),
    ...(x.s ? { styles: x.s } : {}),
    detail: { tris: x.d[0], kb: x.d[1], textures: x.d[2], maxTex: x.d[3], tier: dict.tier[x.d[4]] ?? 'medium' },
    licence: dict.licence[x.l] ?? '',
    source: `${dict.sourcePrefix[x.o[0]] ?? ''}${x.o[1]}`,
    ...(x.a !== undefined && dict.author[x.a] ? { author: dict.author[x.a] as string } : {}),
    ...(x.q ? { issues: x.q } : {}),
  };
};

const expand = (raw: CompactFile): LibraryQualityFile => {
  const { dict, models, ...head } = raw;
  const out: Record<string, ModelQuality> = {};
  for (const [id, row] of Object.entries(models ?? {})) out[id] = expandRow(dict, row);
  return { ...head, models: out };
};

/** Giải nén dạng compact-1 (schema v1) và compact-2 (schema v2) — cùng cấu trúc hàng, v2 thêm bit cờ `f` và `h`. */
export const expandLibraryQuality = (raw: unknown): LibraryQualityFile => expand(raw as CompactFile);

export const LIBRARY_QUALITY: LibraryQualityFile = expand(data as unknown as CompactFile);

export const qualityOf = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];

/** Cờ texture vải của mẫu: 'broken' | 'unsure', vắng = ok hoặc chưa xem. */
export const textureOf = (id: string): TextureFlag | undefined => LIBRARY_QUALITY.models[id]?.texture?.v;
