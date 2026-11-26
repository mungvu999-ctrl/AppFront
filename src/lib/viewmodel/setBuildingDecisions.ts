/**
 * Quyết định của người duyệt trên khối "Ngôi nhà" (NHA-08b): số họ nhập cho tầng, "không dựng mái", nguồn họ
 * chọn cho mâu thuẫn, cảnh báo đã xem — và những gì còn chặn xác nhận.
 *
 * Thuần, không React. Mọi hàm trả bản mới, không sửa bản cũ. Bản gửi đi (thân `building` của N59) thay CẢ bản
 * đã lưu, và trường tuỳ chọn thì VẮNG chứ không `null`/`undefined` (schema strict của dây duyệt).
 */

import { HOUSE_ELEVATION_RANGE_MM, HOUSE_HEIGHT_RANGE_MM } from '@/api/schemas/houseProposal';
import type {
  BuildingDecisions,
  BuildingProposal,
  BuildingSource,
  LevelDecision,
} from '@/api/schemas/setBuilding';
import { formatNumber, parseNumber } from '@/lib/format/number';

export const EMPTY_DECISIONS: BuildingDecisions = { levels: [], roofs: [], picks: {}, seen: [] };

export type LevelField = 'elevationMm' | 'heightMm';

const LEVEL_FIELDS: Readonly<
  Record<LevelField, { label: string; range: { readonly min: number; readonly max: number } }>
> = {
  elevationMm: { label: 'Cốt', range: HOUSE_ELEVATION_RANGE_MM },
  heightMm: { label: 'Chiều cao', range: HOUSE_HEIGHT_RANGE_MM },
};

const count = (value: number): string => formatNumber(value, { fractionDigits: 0 });
const signed = (value: number): string => `${value < 0 ? '−' : ''}${count(Math.abs(value))}`;

/**
 * Chữ người duyệt gõ → số mm. Chỉ nhận chữ số (dấu chấm tách nghìn được): `parseNumber` đọc khoan dung cho lúc
 * đang gõ ("12a" ra 12, "1e3" ra 1000), còn đây là lúc ghi vào bản duyệt nên chữ lạ là không có số.
 */
export function levelValueFromText(text: string): number | undefined {
  const trimmed = text.trim().replace('−', '-');

  return /^-?\d[\d.]*$/u.test(trimmed) ? parseNumber(trimmed) : undefined;
}

/** Câu báo khi số nhập không gửi được (BE từ chối 422 ngoài dải); `null` = dùng được. */
export function levelValueProblem(field: LevelField, valueMm: number | undefined): string | null {
  const { label, range } = LEVEL_FIELDS[field];

  if (valueMm === undefined || !Number.isInteger(valueMm)) return 'Nhập số nguyên theo mm.';

  return valueMm < range.min || valueMm > range.max
    ? `${label} phải trong khoảng ${signed(range.min)} đến ${signed(range.max)} mm.`
    : null;
}

/* -------------------------------------------------------------------------- */
/* Sửa.                                                                        */
/* -------------------------------------------------------------------------- */

/** Đặt (hoặc bỏ, khi `valueMm` vắng) số người duyệt nhập cho một ô của tầng; hết số thì bỏ cả quyết định. */
export function setLevelValue(
  decisions: BuildingDecisions,
  levelRef: string,
  field: LevelField,
  valueMm: number | undefined,
): BuildingDecisions {
  const next: LevelDecision = {
    ...(decisions.levels.find((level) => level.levelRef === levelRef) ?? { levelRef }),
  };

  if (valueMm === undefined) delete next[field];
  else next[field] = valueMm;
  const others = decisions.levels.filter((level) => level.levelRef !== levelRef);

  return { ...decisions, levels: Object.keys(next).length > 1 ? [...others, next] : others };
}

/** "Không dựng mái, tôi tự vẽ". Bỏ chọn thì gỡ quyết định, trừ khi nó còn mang số mái đã lưu. */
export function setRoofSkip(
  decisions: BuildingDecisions,
  levelRef: string,
  skip: boolean,
): BuildingDecisions {
  const next = {
    ...(decisions.roofs.find((roof) => roof.levelRef === levelRef) ?? { levelRef }),
    skip,
  };
  const others = decisions.roofs.filter((roof) => roof.levelRef !== levelRef);

  return { ...decisions, roofs: skip || Object.keys(next).length > 2 ? [...others, next] : others };
}

export const pickSource = (
  decisions: BuildingDecisions,
  conflictKey: string,
  source: BuildingSource,
): BuildingDecisions => ({
  ...decisions,
  picks: { ...decisions.picks, [conflictKey]: source },
});

/** `key` là khoá máy chủ phát cho vi phạm, gửi lại nguyên văn. */
export const markSeen = (decisions: BuildingDecisions, key: string): BuildingDecisions =>
  decisions.seen.includes(key) ? decisions : { ...decisions, seen: [...decisions.seen, key] };

/**
 * Bỏ quyết định tầng và mái của hình không còn là mặt bằng đang dùng: N59 từ chối CẢ lượt lưu (422) khi còn một
 * `levelRef` như vậy. Nguồn đã chọn và cảnh báo đã xem không bị kiểm theo hình nên giữ nguyên.
 */
export const pruneDecisions = (
  decisions: BuildingDecisions,
  livePlanIds: ReadonlySet<string>,
): BuildingDecisions => ({
  ...decisions,
  levels: decisions.levels.filter((level) => livePlanIds.has(level.levelRef)),
  roofs: decisions.roofs.filter((roof) => livePlanIds.has(roof.levelRef)),
});

/* -------------------------------------------------------------------------- */
/* Thao tác của khối.                                                          */
/* -------------------------------------------------------------------------- */

export interface HouseActions {
  /** `valueMm` vắng = bỏ số đã nhập, quay về giá trị của máy. */
  readonly setLevel: (levelRef: string, field: LevelField, valueMm: number | undefined) => void;
  readonly setRoofSkip: (levelRef: string, skip: boolean) => void;
  readonly pick: (conflictKey: string, source: BuildingSource) => void;
  readonly markSeen: (key: string) => void;
}

/**
 * Nối thao tác vào bản nháp của màn. Bản nháp `null` = người duyệt chưa đụng vào khối (N59 không gửi `building`);
 * thao tác đầu tiên khởi từ quyết định đã lưu ở máy chủ để không đè mất chúng.
 */
export function houseActionsOf(
  change: (update: (local: BuildingDecisions | null) => BuildingDecisions) => void,
  stored: BuildingDecisions | undefined,
): HouseActions {
  const apply = (edit: (decisions: BuildingDecisions) => BuildingDecisions): void => {
    change((local) => edit(local ?? stored ?? EMPTY_DECISIONS));
  };

  return {
    setLevel: (levelRef, field, valueMm) => {
      apply((decisions) => setLevelValue(decisions, levelRef, field, valueMm));
    },
    setRoofSkip: (levelRef, skip) => {
      apply((decisions) => setRoofSkip(decisions, levelRef, skip));
    },
    pick: (conflictKey, source) => {
      apply((decisions) => pickSource(decisions, conflictKey, source));
    },
    markSeen: (key) => {
      apply((decisions) => markSeen(decisions, key));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Chặn xác nhận.                                                              */
/* -------------------------------------------------------------------------- */

const HOUSE = 'Khối “Ngôi nhà”';

/**
 * Những gì của khối còn chặn xác nhận, như N60 chặn ở máy chủ: mâu thuẫn chưa chọn nguồn, vi phạm mức lỗi, cảnh
 * báo chưa xem. Gợi ý không chặn. Nguồn vừa chọn và cảnh báo vừa xem (trong `decisions`) tính ngay.
 */
export function houseBlockers(
  proposal: BuildingProposal | undefined,
  decisions: BuildingDecisions,
): string[] {
  if (proposal === undefined) return [];
  const unchosen = proposal.conflicts.filter(
    (conflict) => (decisions.picks[conflict.key] ?? conflict.chosenSource) === undefined,
  ).length;
  const errors = proposal.violations.filter((hit) => hit.level === 'error').length;
  const unseen = proposal.violations.filter(
    (hit) => hit.level === 'warning' && !decisions.seen.includes(hit.key),
  ).length;

  return [
    ...(unchosen > 0 ? [`${HOUSE} còn ${count(unchosen)} mâu thuẫn chưa chọn nguồn.`] : []),
    ...(errors > 0 ? [`${HOUSE} còn ${count(errors)} lỗi. Hãy sửa cốt, chiều cao hoặc mái.`] : []),
    ...(unseen > 0 ? [`${HOUSE} còn ${count(unseen)} cảnh báo chưa xem.`] : []),
  ];
}
