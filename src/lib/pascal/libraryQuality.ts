/**
 * Dữ liệu chất lượng thư viện (vòng 12) — schema có phiên bản, sinh theo lô bởi `scripts/gen-library-quality.mjs`,
 * KHÔNG sửa tay. Bộ chọn bộ nội thất (`roomSet.ts`) chỉ đọc qua tệp này.
 *
 * Mỗi thuộc tính ghi rõ nguồn: `m` = đo được từ tệp GLB / danh mục, `i` = suy luận (gắn nhãn từ ảnh, phân loại theo
 * tên vật liệu). Thuộc tính VẮNG = chưa biết — bộ chọn coi "chưa biết" là không đủ tin cho ràng buộc cứng.
 */

import data from './libraryQuality.json';

export const LIBRARY_QUALITY_SCHEMA = 1;

export type QualityBy = 'm' | 'i';

/** Mức hoàn thiện. Giường: `full` = nệm + chăn/ga + gối; `partial` = có nệm phủ ga nhưng thiếu gối hoặc chăn; `bare` = khung hoặc nệm trần. */
export type Completeness = 'full' | 'partial' | 'bare';

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
}

export interface ModelQuality {
  /** Vai sử dụng (cùng tên vai với `libraryRoles.json` / `libraryRoles2.json`); vắng = chưa xếp vai. */
  readonly role?: string;
  /** Kích thước sử dụng [rộng, cao, sâu] mm (đo từ hộp bao GLB đã chuẩn hoá). */
  readonly useMm: readonly [number, number, number];
  /** Hướng mặt trước: trục theo quy ước nhập (đo) + kết quả kiểm ảnh (suy luận); `suspect` = chưa tin. */
  readonly front: { readonly axis: '+z'; readonly check: 'ok' | 'suspect' };
  /** Mức hoàn thiện; vắng = chưa biết hoặc không áp dụng cho vai này. */
  readonly completeness?: { readonly v: Completeness; readonly by: QualityBy };
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
  f?: 1;
  c?: string;
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

const expandRow = (dict: CompactFile['dict'], x: CompactRow): ModelQuality => {
  const comp = x.c ? COMPLETENESS[x.c[0] ?? ''] : undefined;
  return {
    ...(x.r ? { role: x.r } : {}),
    useMm: x.u,
    front: { axis: '+z', check: x.f ? 'suspect' : 'ok' },
    ...(comp ? { completeness: { v: comp, by: x.c?.[1] === 'm' ? 'm' : 'i' } } : {}),
    ...(x.p
      ? {
          parts: x.p.map(([k = 6, s = 0, L = 0, A = 0, B = 0, m]) => {
            const material = m === undefined ? undefined : dict.material[m];
            return { kind: dict.kind[k] ?? 'other', share: s / 100, lab: [L, A, B] as const, ...(material ? { material } : {}), kindBy: 'i' as const };
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

export const LIBRARY_QUALITY: LibraryQualityFile = expand(data as unknown as CompactFile);

export const qualityOf = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
