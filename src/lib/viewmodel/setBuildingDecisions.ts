/**
 * Quyết định của người duyệt trên khối "Ngôi nhà" (NHA-08b/08c): số họ nhập cho tầng, thông số mái họ sửa,
 * "không dựng mái", nguồn họ chọn cho mâu thuẫn, cảnh báo đã xem — và những gì còn chặn xác nhận.
 *
 * Thuần, không React. Mọi hàm trả bản mới, không sửa bản cũ. Bản gửi đi (thân `building` của N59) thay CẢ bản
 * đã lưu, và trường tuỳ chọn thì VẮNG chứ không `null`/`undefined` (schema strict của dây duyệt).
 */

import { HOUSE_ELEVATION_RANGE_MM, HOUSE_HEIGHT_RANGE_MM } from '@/api/schemas/houseProposal';
import {
  RoofDecisionSchema,
  type BuildingDecisions,
  type BuildingProposal,
  type BuildingSource,
  type LevelDecision,
} from '@/api/schemas/setBuilding';
import { formatNumber, parseNumber } from '@/lib/format/number';

export const EMPTY_DECISIONS: BuildingDecisions = { levels: [], roofs: [], picks: {}, seen: [] };

export type LevelField = 'elevationMm' | 'heightMm';

/** Tám thông số sửa được của một mái, theo thứ tự hiện trên thẻ mái. */
export const ROOF_FIELDS = [
  'form',
  'pitchDeg',
  'quarterTurns',
  'eaveElevationMm',
  'ridgeElevationMm',
  'overhangMm',
  'material',
  'parapetMm',
] as const;
export type RoofField = (typeof ROOF_FIELDS)[number];

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

const MM_FORMAT_PROBLEM = 'Nhập số nguyên theo mm.';

/** Kết quả đọc chữ gõ trong một ô sửa: số gửi được, hoặc câu báo ngay dưới ô. */
export type NumberRead = { readonly value: number } | { readonly problem: string };

/** Câu báo khi một số mm không gửi được (BE từ chối 422 ngoài dải); `null` = dùng được. Chung cho tầng và mái. */
export function mmRangeProblem(
  label: string,
  range: { readonly min: number; readonly max: number },
  valueMm: number | undefined,
): string | null {
  if (valueMm === undefined || !Number.isInteger(valueMm)) return MM_FORMAT_PROBLEM;

  return valueMm < range.min || valueMm > range.max
    ? `${label} phải trong khoảng ${signed(range.min)} đến ${signed(range.max)} mm.`
    : null;
}

export function levelValueProblem(field: LevelField, valueMm: number | undefined): string | null {
  const { label, range } = LEVEL_FIELDS[field];

  return mmRangeProblem(label, range, valueMm);
}

export function readMmValue(
  label: string,
  range: { readonly min: number; readonly max: number },
  text: string,
): NumberRead {
  const valueMm = levelValueFromText(text);
  const problem = mmRangeProblem(label, range, valueMm);

  return valueMm === undefined || problem !== null
    ? { problem: problem ?? MM_FORMAT_PROBLEM }
    : { value: valueMm };
}

export const readLevelNumber = (field: LevelField, text: string): NumberRead =>
  readMmValue(LEVEL_FIELDS[field].label, LEVEL_FIELDS[field].range, text);

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

/**
 * Đặt (hoặc bỏ, khi `value` vắng) một thông số mái người duyệt nhập. Hết thông số thì bỏ cả quyết định, trừ khi
 * mái đang "không dựng". Giá trị dây không nhận (dạng lạ, số ngoài khoảng) thì không ghi gì: một quyết định hỏng
 * làm N59 từ chối CẢ lượt lưu.
 */
export function setRoofValue(
  decisions: BuildingDecisions,
  levelRef: string,
  field: RoofField,
  value: number | string | undefined,
): BuildingDecisions {
  const next: Record<string, unknown> = {
    ...(decisions.roofs.find((roof) => roof.levelRef === levelRef) ?? { levelRef, skip: false }),
  };

  if (value === undefined) delete next[field];
  else next[field] = value;
  const parsed = RoofDecisionSchema.safeParse(next);

  if (!parsed.success) return decisions;
  const others = decisions.roofs.filter((roof) => roof.levelRef !== levelRef);
  const kept = parsed.data.skip || Object.keys(parsed.data).length > 2;

  return { ...decisions, roofs: kept ? [...others, parsed.data] : others };
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

/**
 * Thân `building` của một lượt lưu N59; `undefined` = không gửi, máy chủ giữ bản đã lưu.
 *
 * `touched` vắng = người duyệt chưa chạm khối trong lượt mở trang này. Khi đó vẫn phải gửi nếu một hình có quyết
 * định ĐÃ LƯU vừa bị bỏ khỏi bản duyệt: không gửi thì máy chủ giữ quyết định của hình đã mất và N60 chặn xác nhận,
 * trong khi dòng của tầng đó không còn hiện để người duyệt gỡ.
 */
export function decisionsToSend(
  touched: BuildingDecisions | undefined,
  stored: BuildingDecisions | undefined,
  livePlanIds: ReadonlySet<string>,
): BuildingDecisions | undefined {
  if (touched !== undefined) return pruneDecisions(touched, livePlanIds);
  if (stored === undefined) return undefined;
  const pruned = pruneDecisions(stored, livePlanIds);
  const unchanged =
    pruned.levels.length === stored.levels.length && pruned.roofs.length === stored.roofs.length;

  return unchanged ? undefined : pruned;
}

/* -------------------------------------------------------------------------- */
/* Thao tác của khối.                                                          */
/* -------------------------------------------------------------------------- */

export interface HouseActions {
  /** `valueMm` vắng = bỏ số đã nhập, quay về giá trị của máy. */
  readonly setLevel: (levelRef: string, field: LevelField, valueMm: number | undefined) => void;
  readonly setRoofSkip: (levelRef: string, skip: boolean) => void;
  /** `value` vắng = bỏ giá trị đã nhập, quay về giá trị của máy. */
  readonly setRoof: (levelRef: string, field: RoofField, value: number | string | undefined) => void;
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
    setRoof: (levelRef, field, value) => {
      apply((decisions) => setRoofValue(decisions, levelRef, field, value));
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
