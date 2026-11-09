/**
 * M5 làn 3c — thử nghiệm cấu tạo/mật độ, bật bằng `?buildx=<cờ>[,<cờ>]` (mặc định: không cờ = cảnh hiện tại).
 * - `trim`: phào trần profile cove 90 mm + len chân profile base-modern (thay 50 mm/100 mm phẳng).
 * - `win`: cửa sổ cố định có đố chia ô theo bề rộng (ô ~0,7 m) + ô lật trên khi cao ≥ 1,3 m.
 * - `dense`: thêm cây góc phòng khách/phòng ngủ + đèn sàn cạnh sofa (`sceneDressingRules.ts`, id `DRESS-floorLamp-…` / `DRESS-plantx-…` — không trùng `DRESS-plant-` của `sceneFurnish`).
 * - `minimal`: chỉ giữ thảm + rèm trong lớp trang trí (bỏ gối, chăn, bình, tranh, đèn bàn, thảm chân).
 * `trim`/`win` chỉ đổi trường hiển thị của node tường/cửa sổ (lượt về không đọc `crown`/`skirting`/`columnRatios`),
 * nên không lưu, tải lại ra y hệt. Không nhập store/types để khỏi vòng phụ thuộc với `toPascal.ts`.
 */

export type BuildxFlag = 'trim' | 'win' | 'dense' | 'minimal';
const FLAGS: readonly BuildxFlag[] = ['trim', 'win', 'dense', 'minimal'];

export const buildxFlagsOf = (search: string): ReadonlySet<BuildxFlag> =>
  new Set(
    (new URLSearchParams(search).get('buildx') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is BuildxFlag => (FLAGS as readonly string[]).includes(s)),
  );

let flags: ReadonlySet<BuildxFlag> = typeof location === 'undefined' ? new Set() : buildxFlagsOf(location.search);

export const buildxOn = (flag: BuildxFlag): boolean => flags.has(flag);

/** Chỉ cho bài kiểm. */
export const setBuildxFlags = (next: readonly BuildxFlag[]): void => {
  flags = new Set(next);
};

interface TrimLike {
  readonly enabled?: boolean;
  readonly [key: string]: unknown;
}
interface NodeLike {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const TRIM_CROWN = { height: 0.09, proud: 0.035, profile: 'crown-cove' } as const;
export const TRIM_SKIRTING = { height: 0.1, proud: 0.018, profile: 'base-modern' } as const;
/** Bề rộng ô kính mục tiêu và ngưỡng có ô lật trên. */
const PANE_M = 0.7;
const TRANSOM_MIN_H_M = 1.3;

/** Đố chia ô cho cửa sổ cố định chữ nhật `width × height` (m). Thuần, để kiểm. */
export const windowDivisions = (width: number, height: number): { columnRatios: number[]; rowRatios: number[] } => {
  const cols = Math.max(1, Math.min(4, Math.round(width / PANE_M)));
  return {
    columnRatios: Array.from({ length: cols }, () => 1 / cols),
    rowRatios: height >= TRANSOM_MIN_H_M ? [0.3, 0.7] : [1],
  };
};

/** Áp `trim`/`win` lên node của cảnh (thay node, không sửa tại chỗ). Không cờ nào bật thì không đổi gì. */
export function applyBuildx<N extends { readonly type: string }>(scene: Record<string, N>): void {
  const trim = flags.has('trim');
  const win = flags.has('win');
  if (!trim && !win) return;
  const nodes = scene as unknown as Record<string, NodeLike>;
  for (const [id, node] of Object.entries(nodes)) {
    if (trim && node.type === 'wall') {
      const crown = node.crown as TrimLike | undefined;
      const skirting = node.skirting as TrimLike | undefined;
      nodes[id] = {
        ...node,
        ...(crown?.enabled ? { crown: { ...crown, ...TRIM_CROWN } } : {}),
        ...(skirting?.enabled ? { skirting: { ...skirting, ...TRIM_SKIRTING } } : {}),
      };
    }
    if (
      win &&
      node.type === 'window' &&
      node.windowType === 'fixed' &&
      node.openingKind !== 'opening' &&
      (node.openingShape ?? 'rectangle') === 'rectangle'
    ) {
      nodes[id] = {
        ...node,
        ...windowDivisions(Number(node.width), Number(node.height)),
        columnDividerThickness: 0.04,
        rowDividerThickness: 0.04,
      };
    }
  }
}
