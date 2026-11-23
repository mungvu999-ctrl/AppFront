/**
 * Màn "Duyệt bộ hồ sơ" (K-32b): bản nháp các hình máy tách được, người duyệt sửa trên đó, rồi xác nhận.
 *
 * Thuần: không React, không mạng. Máy chỉ đề xuất — loại, tầng máy đọc và độ chắc đi vào bản nháp
 * NGUYÊN VĂN, còn ĐÍCH của mỗi hình (`target`) khởi đầu rỗng trừ khi máy chủ đã lưu một đích do người
 * duyệt chọn ở lượt trước. Không chỗ nào tự điền đích từ đề xuất của máy (không có "dựng luôn"; luật A5).
 *
 * ## Bốn luật chặn trước khi gửi N60
 *
 * Phản chiếu các lỗi 422/409 của máy chủ để câu nói được TRƯỚC khi bấm, tại đúng hình có vấn đề:
 * hình mặt bằng chưa có đích; hai hình cùng một tầng; tầng có sẵn bản vẽ mà chưa tick "Thay bản vẽ
 * cũ"; không hình mặt bằng nào có đích. Máy chủ vẫn là nơi quyết (các mã lỗi được màn đọc lại).
 */

import type {
  CropRect,
  DrawingSetTitleBlock,
  DrawingSetView,
  ViewEdit,
  ViewTarget,
} from '@/api/schemas/drawingSet';
import { DRAWING_SET_LIMITS } from '@/api/schemas/drawingSet';
import type { HouseViewKind } from '@/api/schemas/houseProposal';
import { HOUSE_VIEW_KINDS } from '@/api/schemas/houseProposal';
import { formatNumber } from '@/lib/format/number';

import { questionsOf, type HouseQuestionsFor } from './houseProposalParts';
import { storeyConfidenceLabelOf, storeyTextOf, statusOfConfidence } from './houseProposal';
import type { ViewStatusCode } from './types';

/* -------------------------------------------------------------------------- */
/* Chữ.                                                                        */
/* -------------------------------------------------------------------------- */

export const VIEW_KIND_LABELS: Readonly<Record<HouseViewKind, string>> = {
  plan: 'Mặt bằng',
  section: 'Mặt cắt',
  elevation: 'Mặt đứng',
  roof: 'Mái',
  site: 'Tổng thể',
  detail: 'Chi tiết',
  other: 'Khác',
};

export const VIEW_KIND_OPTIONS: readonly { readonly value: HouseViewKind; readonly label: string }[] = HOUSE_VIEW_KINDS.map(
  (value) => ({ value, label: VIEW_KIND_LABELS[value] }),
);

export const REPLACE_WARNING = 'Tầng này sẽ phải duyệt lại sau khi thay bản vẽ.';
const SECTION_DEFAULT_NAME = 'Mặt cắt';
const MACHINE_MARK = 'Máy đề xuất';

const count = (value: number): string => formatNumber(value, { fractionDigits: 0 });

/* -------------------------------------------------------------------------- */
/* Bản nháp.                                                                   */
/* -------------------------------------------------------------------------- */

/** Đích người duyệt chọn cho một hình mặt bằng. `none` = chưa chọn. */
export type TargetChoice =
  | { readonly mode: 'none' }
  | { readonly mode: 'floor'; readonly floorId: string; readonly replace: boolean }
  | { readonly mode: 'newFloor'; readonly floorId: string; readonly name: string };

export interface ViewDraft {
  readonly id: string;
  readonly fileId: string;
  readonly pageIndex: number;
  readonly crop: CropRect;
  readonly source: 'ai' | 'user';
  readonly excluded: boolean;
  readonly kind: HouseViewKind;
  readonly kindConfidence: number;
  readonly titleText: string | undefined;
  /** Số hiệu bản vẽ máy đọc từ khung tên (K-65); chỉ để hiện và sắp, không gửi lại ở N59. */
  readonly sheetNo: string | undefined;
  readonly storeyLabel: string | undefined;
  readonly storeyNo: number | undefined;
  readonly storeyConfidence: number | undefined;
  readonly questions: DrawingSetView['questions'];
  readonly imageUrl: string | undefined;
  readonly target: TargetChoice;
}

const choiceOf = (target: ViewTarget | undefined): TargetChoice => {
  if (target === undefined || target.mode === 'section') return { mode: 'none' };
  return target.mode === 'floor'
    ? { mode: 'floor', floorId: target.floorId, replace: target.replace === true }
    : { mode: 'newFloor', floorId: target.floorId, name: target.name };
};

export function toDrafts(views: readonly DrawingSetView[]): ViewDraft[] {
  return views.map((view) => ({
    id: view.id,
    fileId: view.fileId,
    pageIndex: view.pageIndex,
    crop: view.crop,
    source: view.source,
    excluded: view.excluded,
    kind: view.kind,
    kindConfidence: view.kindConfidence,
    titleText: view.titleText,
    sheetNo: view.sheetNo,
    storeyLabel: view.storeyLabel,
    storeyNo: view.storeyNo,
    storeyConfidence: view.storeyConfidence,
    questions: view.questions,
    imageUrl: view.imageUrl,
    target: view.kind === 'plan' ? choiceOf(view.target) : { mode: 'none' },
  }));
}

/**
 * Thứ tự hiện lưới: có số bản vẽ thì sắp theo số (so số trong chuỗi theo giá trị: "KT-2" trước "KT-10"),
 * hình không có số xếp sau theo thứ tự cũ. Không hình nào có số thì giữ nguyên thứ tự máy chủ.
 * Chỉ đổi thứ tự HIỆN, không đổi bản nháp nên thân N59 không đổi.
 */
export function sortedBySheetNo<T extends Pick<ViewDraft, 'sheetNo'>>(drafts: readonly T[]): T[] {
  if (drafts.every((draft) => draft.sheetNo === undefined)) return [...drafts];
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

  return drafts
    .map((draft, index) => ({ draft, index }))
    .sort((left, right) => {
      const a = left.draft.sheetNo;
      const b = right.draft.sheetNo;

      if (a === undefined || b === undefined) return a === b ? left.index - right.index : a === undefined ? 1 : -1;

      return collator.compare(a, b) || left.index - right.index;
    })
    .map((entry) => entry.draft);
}

export interface TitleBlockRow {
  readonly key: keyof DrawingSetTitleBlock;
  readonly label: string;
  readonly value: string;
}

const TITLE_BLOCK_LABELS: readonly { readonly key: keyof DrawingSetTitleBlock; readonly label: string }[] = [
  { key: 'owner', label: 'Chủ đầu tư' },
  { key: 'project', label: 'Công trình' },
  { key: 'location', label: 'Địa điểm' },
  { key: 'date', label: 'Ngày' },
];

/** Các dòng của khung "Thông tin hồ sơ": chỉ trường máy đọc được (vắng thì không có dòng). */
export function titleBlockRowsOf(titleBlock: DrawingSetTitleBlock | undefined): TitleBlockRow[] {
  if (titleBlock === undefined) return [];

  return TITLE_BLOCK_LABELS.flatMap(({ key, label }) => {
    const value = titleBlock[key]?.trim() ?? '';

    return value.length === 0 ? [] : [{ key, label, value }];
  });
}

/** Gợi ý tên bộ: tên công trình trên khung tên; không gợi ý khi bộ đã có tên (không đè tên đã có). */
export function suggestedSetName(titleBlock: DrawingSetTitleBlock | undefined, currentName: string | undefined): string | null {
  if (currentName !== undefined && currentName.trim().length > 0) return null;
  const project = titleBlock?.project?.trim() ?? '';

  return project.length === 0 ? null : project;
}

/** Tên dòng mặt cắt: chữ máy đọc được trên hình, không có thì "Mặt cắt", "Mặt cắt 2"… theo thứ tự. */
function sectionNameOf(draft: ViewDraft, ordinal: number): string {
  const title = draft.titleText?.trim() ?? '';

  return title.length > 0 ? title : ordinal === 1 ? SECTION_DEFAULT_NAME : `${SECTION_DEFAULT_NAME} ${count(ordinal)}`;
}

/**
 * Bản nháp → thân N59. Hình đã bỏ không mang đích (máy chủ không phải xét trùng tầng với hình không dùng);
 * mặt bằng tầng mới mà tên trống thì giữ hình, bỏ đích (chưa đủ để gửi, vẫn lưu được phần còn lại).
 */
export function toViewEdits(drafts: readonly ViewDraft[]): ViewEdit[] {
  let sections = 0;

  return drafts.map((draft) => {
    const edit: ViewEdit = {
      id: draft.id,
      fileId: draft.fileId,
      pageIndex: draft.pageIndex,
      crop: draft.crop,
      excluded: draft.excluded,
      kind: draft.kind,
      ...(draft.storeyNo !== undefined ? { storeyNo: draft.storeyNo } : {}),
    };

    if (draft.excluded) return edit;
    if (draft.kind === 'section') {
      sections += 1;
      return { ...edit, target: { mode: 'section', name: sectionNameOf(draft, sections) } };
    }
    const { target } = draft;

    if (draft.kind !== 'plan' || target.mode === 'none') return edit;
    if (target.mode === 'floor') {
      return { ...edit, target: { mode: 'floor', floorId: target.floorId, ...(target.replace ? { replace: true as const } : {}) } };
    }
    const name = target.name.trim();

    return name.length === 0 ? edit : { ...edit, target: { mode: 'newFloor', floorId: target.floorId, name } };
  });
}

/** Hai danh sách cho cùng nội dung gửi đi? (so thân N59, không so riêng bản nháp). */
export const sameEdits = (left: readonly ViewEdit[], right: readonly ViewEdit[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/* -------------------------------------------------------------------------- */
/* Sửa một hình.                                                               */
/* -------------------------------------------------------------------------- */

const patch = (drafts: readonly ViewDraft[], id: string, change: (draft: ViewDraft) => ViewDraft): ViewDraft[] =>
  drafts.map((draft) => (draft.id === id ? change(draft) : draft));

export const setExcluded = (drafts: readonly ViewDraft[], id: string, excluded: boolean): ViewDraft[] =>
  patch(drafts, id, (draft) => ({ ...draft, excluded }));

/** Đổi loại: không còn là mặt bằng thì mất đích (chỉ mặt bằng có đích). */
export const setKind = (drafts: readonly ViewDraft[], id: string, kind: HouseViewKind): ViewDraft[] =>
  patch(drafts, id, (draft) => ({ ...draft, kind, target: kind === 'plan' ? draft.target : { mode: 'none' } }));

export const chooseExistingFloor = (drafts: readonly ViewDraft[], id: string, floorId: string): ViewDraft[] =>
  patch(drafts, id, (draft) => ({ ...draft, target: { mode: 'floor', floorId, replace: false } }));

export const clearTarget = (drafts: readonly ViewDraft[], id: string): ViewDraft[] =>
  patch(drafts, id, (draft) => ({ ...draft, target: { mode: 'none' } }));

/** Tầng mới: tên khởi đầu theo tầng máy đọc (người duyệt sửa được), `floorId` do nơi gọi sinh. */
export const chooseNewFloor = (drafts: readonly ViewDraft[], id: string, floorId: string): ViewDraft[] =>
  patch(drafts, id, (draft) => ({ ...draft, target: { mode: 'newFloor', floorId, name: suggestedFloorName(draft) } }));

export const setNewFloorName = (drafts: readonly ViewDraft[], id: string, name: string): ViewDraft[] =>
  patch(drafts, id, (draft) =>
    draft.target.mode === 'newFloor' ? { ...draft, target: { ...draft.target, name } } : draft,
  );

export const setReplace = (drafts: readonly ViewDraft[], id: string, replace: boolean): ViewDraft[] =>
  patch(drafts, id, (draft) => (draft.target.mode === 'floor' ? { ...draft, target: { ...draft.target, replace } } : draft));

/** "Tầng 2", "Tầng hầm"…; máy chưa rõ tầng thì rỗng để người duyệt tự gõ. */
export function suggestedFloorName(draft: Pick<ViewDraft, 'storeyLabel' | 'storeyNo'>): string {
  const text = storeyTextOf(draft.storeyLabel, draft.storeyNo);

  return text === 'Chưa rõ tầng' ? '' : text;
}

/* -------------------------------------------------------------------------- */
/* Thẻ hình: chữ máy đề xuất.                                                  */
/* -------------------------------------------------------------------------- */

export interface ViewCardVm {
  readonly kindText: string;
  readonly kindChip: string;
  readonly kindStatus: ViewStatusCode;
  readonly storeyText: string;
  readonly storeyChip: string;
  readonly storeyStatus: ViewStatusCode;
  readonly questions: readonly string[];
}

const flatQuestions = (questions: HouseQuestionsFor): string[] => [...questions.row, ...questions.elevation, ...questions.height];

/** Chip độ chắc không bao giờ `verified` (A5): view đổi `neutral` về chip trung tính. */
const machineStatus = (status: ViewStatusCode): ViewStatusCode => (status === 'verified' ? 'neutral' : status);

export function viewCardOf(draft: ViewDraft): ViewCardVm {
  const storeyText = storeyTextOf(draft.storeyLabel, draft.storeyNo);
  const kindStatus = machineStatus(statusOfConfidence(draft.kindConfidence));
  const storeyStatus = machineStatus(statusOfConfidence(draft.storeyConfidence));

  return {
    kindText: VIEW_KIND_LABELS[draft.kind],
    kindChip: kindStatus === 'neutral' ? MACHINE_MARK : 'Chưa chắc',
    kindStatus,
    storeyText,
    storeyChip: draft.storeyConfidence === undefined ? MACHINE_MARK : storeyConfidenceLabelOf(draft.storeyConfidence, storeyText),
    storeyStatus,
    questions: flatQuestions(questionsOf(draft.questions).questionsFor),
  };
}

/* -------------------------------------------------------------------------- */
/* Kiểm trước khi xác nhận.                                                    */
/* -------------------------------------------------------------------------- */

/** Phần của tầng dự án mà bước duyệt cần. */
export interface ReviewFloor {
  readonly id: string;
  readonly name: string;
  readonly hasDrawing: boolean;
  /** Tầng là dòng mặt cắt: không phải đích của mặt bằng. */
  readonly isSection: boolean;
}

export interface ConfirmProblem {
  /** Hình có vấn đề; vắng khi vấn đề của cả bộ. */
  readonly viewId?: string;
  readonly text: string;
}

export interface ConfirmSummary {
  readonly newFloors: number;
  readonly existingFloors: number;
  readonly replacedFloorNames: readonly string[];
  readonly sections: number;
}

export interface ConfirmCheck {
  readonly canConfirm: boolean;
  readonly problems: readonly ConfirmProblem[];
  readonly summary: ConfirmSummary;
}

const SAVE_NO_PLAN = 'Chọn tầng cho ít nhất một hình mặt bằng rồi mới xác nhận được.';

export function checkConfirm(drafts: readonly ViewDraft[], floors: readonly ReviewFloor[]): ConfirmCheck {
  const live = drafts.filter((draft) => !draft.excluded);
  const plans = live.filter((draft) => draft.kind === 'plan');
  const problems: ConfirmProblem[] = [];
  const floorById = new Map(floors.map((floor) => [floor.id, floor]));
  const seen = new Map<string, string>();
  const replaced: string[] = [];
  let newFloors = 0;
  let existingFloors = 0;

  for (const draft of plans) {
    const { target } = draft;

    if (target.mode === 'none') {
      problems.push({ viewId: draft.id, text: 'Chọn tầng cho hình mặt bằng này.' });
      continue;
    }
    if (seen.has(target.floorId)) {
      problems.push({ viewId: draft.id, text: 'Tầng này đã được chọn cho một hình mặt bằng khác. Mỗi tầng chỉ có một mặt bằng.' });
    }
    seen.set(target.floorId, draft.id);

    if (target.mode === 'newFloor') {
      newFloors += 1;
      if (target.name.trim().length === 0) problems.push({ viewId: draft.id, text: 'Đặt tên cho tầng mới.' });
      continue;
    }
    existingFloors += 1;
    const floor = floorById.get(target.floorId);

    if (floor === undefined || floor.isSection) {
      problems.push({ viewId: draft.id, text: 'Tầng này không còn dùng được. Chọn tầng khác.' });
    } else if (floor.hasDrawing && !target.replace) {
      problems.push({
        viewId: draft.id,
        text: `${floor.name} đã có bản vẽ. Chọn “Thay bản vẽ cũ” nếu muốn thay, hoặc chọn tầng khác.`,
      });
    } else if (floor.hasDrawing) {
      replaced.push(floor.name);
    }
  }
  if (plans.length > DRAWING_SET_LIMITS.maxPlansPerConfirm) {
    problems.push({ text: `Một lần xác nhận dựng tối đa ${count(DRAWING_SET_LIMITS.maxPlansPerConfirm)} mặt bằng. Hãy bỏ bớt hình.` });
  }
  if (plans.length === 0 || plans.every((draft) => draft.target.mode === 'none')) {
    problems.push({ text: SAVE_NO_PLAN });
  }

  return {
    canConfirm: problems.length === 0,
    problems,
    summary: {
      newFloors,
      existingFloors,
      replacedFloorNames: replaced,
      sections: live.filter((draft) => draft.kind === 'section').length,
    },
  };
}

/** Câu tóm tắt cho hộp hỏi trước khi xác nhận (A9: tạo tầng không hoàn tác được bằng một cú bấm). */
export function confirmSummaryText(summary: ConfirmSummary): string {
  const parts: string[] = [];

  if (summary.newFloors > 0) parts.push(`tạo ${count(summary.newFloors)} tầng mới`);
  if (summary.existingFloors > 0) parts.push(`gắn bản vẽ vào ${count(summary.existingFloors)} tầng đã có`);
  if (summary.sections > 0) parts.push(`thêm ${count(summary.sections)} dòng mặt cắt`);
  const first = parts.join(', ');
  const base = first.length === 0 ? '' : `Máy sẽ ${first}, rồi chạy xử lý từng mặt bằng.`;
  const replaced =
    summary.replacedFloorNames.length === 0
      ? ''
      : ` Bản vẽ cũ của ${summary.replacedFloorNames.join(', ')} sẽ bị thay, và các tầng đó phải duyệt lại.`;

  return `${base}${replaced}`.trim();
}

/** Các dòng của màn "đã xác nhận": mỗi hình có đích của bộ đã xác nhận. Tên tầng có sẵn không có trên dây nên không nêu. */
export function confirmedLines(views: readonly DrawingSetView[]): string[] {
  return views.flatMap((view) => {
    const { target } = view;

    if (view.excluded || target === undefined) return [];
    if (target.mode === 'newFloor') return [`${target.name}: tầng mới, đã gắn mặt bằng.`];
    if (target.mode === 'section') return [`${target.name}: dòng mặt cắt, ẩn khỏi 3D.`];

    return [target.replace === true ? 'Một tầng đã có: bản vẽ cũ đã được thay, tầng này cần duyệt lại.' : 'Một tầng đã có: đã gắn mặt bằng.'];
  });
}
