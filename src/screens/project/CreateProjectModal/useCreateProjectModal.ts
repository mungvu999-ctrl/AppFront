/**
 * The create-project wizard's whole mind: three steps, a floor stack, and the
 * one call to a gateway that turns it all into a project.
 *
 * Invariant D's split: this hook holds every piece of state and does every
 * computation; `CreateProjectModal.tsx` only renders. Every string the view
 * shows for a floor's position — "-3,0 m", the overlap sentence — arrives
 * already built, so the view never calls `formatNumber` or a domain
 * conversion itself (invariant A15).
 *
 * ## The elevation stack (the one thing worth reading carefully)
 *
 * The ground floor is the datum: its `floorElevationMm` is always `0`. Every
 * floor above it is placed by one repeated call —
 * `ceilingElevationMm(previousFloor)` from `@/domain/axes/alignFloors` — so a
 * floor's floor level is always exactly its neighbour's ceiling, never a
 * number typed by this hook. The basement, if there is one, gets exactly ONE
 * downward negation: its ceiling has to land on the ground floor's `0`, so its
 * own floor level is `-clearHeightMm`. That line is marked below and it is the
 * only place a floor's elevation is computed by subtraction rather than by
 * `ceilingElevationMm`.
 *
 * Collisions are read straight off `alignFloors(plans).issues`, filtered to
 * `kind === 'overlap'` — `unalignable` and `clearHeight` also fire on this
 * data (every row's `axes` is `[]`, and this form's own 2–10 m range is wider
 * than the domain's 2,4–6 m one) but neither is a complaint this screen owns.
 * `FloorIssue.message` is used verbatim: it already names both floors in
 * Vietnamese with formatted millimetres.
 *
 * ## Seven states, one precedence
 *
 * `collapsed → forbidden → loading → error → empty → partial → success`, most
 * of which are read straight off {@link SEVEN_STATES}' own wording. `empty`
 * only fires on step 2 with no floors yet — step 1 with nothing wrong is
 * `success` by default, which is also why the eventual "all clean" story for
 * `success` happens to sit on step 3.
 */

import { useEffect, useMemo, useState } from 'react';

import type { SelectOption } from '@/components/ui/Select';
import { alignFloors, ceilingElevationMm, type FloorPlan } from '@/domain/axes/alignFloors';
import { PROJECT_LIMITS } from '@/domain/project/limits';
import type { LevelId } from '@/domain/spatial/types';

/** Re-exported so `CreateProjectModal.tsx`/`StepFloors.tsx` (pure views, R-60)
 * never import `src/domain` directly — only this hook may. */
export { PROJECT_LIMITS };
import {
  metres,
  metresToMillimetres,
  millimetres,
  millimetresToMetres,
  roundMeasurement,
  type Millimetres,
} from '@/domain/units/types';
import { describeError, toAppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import { can } from '@/lib/auth/permissions';
import { createUuid } from '@/lib/http/ids';
import type { Result } from '@/lib/http';
import { formatNumber } from '@/lib/format/number';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';
import type { ProjectRole } from '@/types/project';

/** How many characters of the generated slug the code keeps. */
const CODE_SLUG_MAX_LENGTH = 24;

/** `L-` — the fixed prefix a row id is turned into a {@link LevelId} with. */
const LEVEL_ID_PREFIX_LENGTH = 2;

const BUILDING_TYPE_OPTIONS: SelectOption[] = [
  { value: 'residential', label: 'Nhà ở' },
  { value: 'commercial', label: 'Thương mại' },
  { value: 'industrial', label: 'Công nghiệp' },
  { value: 'mixed', label: 'Hỗn hợp' },
  { value: 'other', label: 'Khác' },
];

const DEFAULT_BUILDING_TYPE = 'residential';

/** Số tầng khi dựng thẳng hook (test, story). Màn thật truyền `initialFloorCount: 1` (U40). */
const DEFAULT_FLOOR_COUNT = 4;

/* -------------------------------------------------------------------------- */
/* Draft floors — what this hook edits before it becomes a FloorPlan.          */
/* -------------------------------------------------------------------------- */

interface DraftFloorRow {
  readonly id: string;
  readonly name: string;
  readonly kind: 'basement' | 'floor';
  readonly clearHeightM: number | null;
  /** Tên do wizard tự sinh, chưa ai gõ lại: chỉ những dòng này được đánh số lại khi xoá tầng (RV4#7). */
  readonly isAutoName?: boolean;
}

/** One floor, ready for the table. Every field is a value; the view computes nothing. */
export interface CreateProjectFloorRowModel {
  readonly id: string;
  readonly name: string;
  readonly kind: 'basement' | 'floor';
  readonly clearHeightM: number | null;
  /** `"3,2 m"`, already formatted; `null` while no height is typed (G3-05). */
  readonly clearHeightLabel: string | null;
  /** `"-3,0 m"`, already formatted; `null` while the stack cannot be computed yet. */
  readonly elevationLabel: string | null;
  /** This row's own complaint — missing height, out of range, or a collision naming it. */
  readonly problem: string | null;
  /** A blank floor name — the server refuses one (`FloorDraftName` min 1 after trim, BUG-185). */
  readonly nameProblem: string | null;
}

/* -------------------------------------------------------------------------- */
/* Wording.                                                                    */
/* -------------------------------------------------------------------------- */

function heightProblemFor(clearHeightM: number | null): string | null {
  if (clearHeightM === null) {
    return 'Chưa nhập chiều cao tầng (sàn–sàn).';
  }
  if (
    clearHeightM < PROJECT_LIMITS.storeyHeightMinM ||
    clearHeightM > PROJECT_LIMITS.storeyHeightMaxM
  ) {
    return (
      `Chiều cao tầng (sàn–sàn) áp dụng từ ${formatNumber(PROJECT_LIMITS.storeyHeightMinM)} ` +
      `đến ${formatNumber(PROJECT_LIMITS.storeyHeightMaxM)} mét.`
    );
  }
  return null;
}

function elevationProblemFor(elevationMm: Millimetres): string | null {
  const elevationM = millimetresToMetres(elevationMm);
  if (elevationM < PROJECT_LIMITS.elevationMinM || elevationM > PROJECT_LIMITS.elevationMaxM) {
    return (
      `Cao độ vượt giới hạn cho phép (${formatNumber(PROJECT_LIMITS.elevationMinM)} ` +
      `đến ${formatNumber(PROJECT_LIMITS.elevationMaxM)} mét).`
    );
  }
  return null;
}

function formatElevationLabel(elevationMm: Millimetres): string {
  return `${formatNumber(millimetresToMetres(elevationMm), { fractionDigits: 1 })} m`;
}

/**
 * A free-text field longer than the server accepts — counted the server's way,
 * after trim + NFC — names its own limit at step 1 instead of becoming an
 * unmarked 422 at step 3 (BUG-176, BUG-186).
 */
function lengthProblemFor(label: string, value: string, maxLength: number): string | null {
  return value.trim().normalize('NFC').length > maxLength
    ? `${label} không quá ${formatNumber(maxLength)} ký tự.`
    : null;
}

const NAME_HINT =
  `Bắt buộc, từ ${formatNumber(PROJECT_LIMITS.nameMinLength)} ` +
  `đến ${formatNumber(PROJECT_LIMITS.nameMaxLength)} ký tự.`;

function localNameProblemFor(name: string): string | null {
  // Counted like the server and like code/address: trim, then NFC (AppBack projects/schemas.py).
  const trimmed = name.trim().normalize('NFC');
  if (trimmed.length === 0) {
    return 'Chưa nhập tên dự án.';
  }
  if (trimmed.length < PROJECT_LIMITS.nameMinLength) {
    return `Tên dự án cần ít nhất ${formatNumber(PROJECT_LIMITS.nameMinLength)} ký tự.`;
  }
  if (trimmed.length > PROJECT_LIMITS.nameMaxLength) {
    return `Tên dự án không quá ${formatNumber(PROJECT_LIMITS.nameMaxLength)} ký tự.`;
  }
  return null;
}

/** The combining marks NFD leaves behind once a letter is split from its accent. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * A short, editable starting point for the project code — six-ish lines, as
 * agreed, rather than a dependency on `src/lib/export/exportGlb.ts`'s slug
 * helper (that module pulls in the GLB exporter and three.js, and the bundle
 * size gate is already red at HEAD).
 */
function generateProjectCode(name: string): string {
  const withoutDiacritics = name
    .trim()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/giu, 'd');
  const slug = withoutDiacritics
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '-')
    .slice(0, CODE_SLUG_MAX_LENGTH)
    // Trimmed AFTER the cut, so a cut that lands on a word gap leaves no "-" dangling.
    .replace(/^-+|-+$/gu, '');

  return slug === '' ? '' : `DA-${slug}`;
}

function rowIdFromLevelId(levelId: LevelId): string {
  return levelId.slice(LEVEL_ID_PREFIX_LENGTH);
}

/** Names the next floor above the ground the way {@link addFloor} always has. */
function nextFloorName(aboveCount: number): string {
  return aboveCount === 0 ? 'Tầng trệt' : `Tầng ${String(aboveCount)}`;
}

/** The wizard's starting stack: {@link DEFAULT_FLOOR_COUNT} floors, no basement, no heights yet. */
function createDefaultFloorRows(count: number = DEFAULT_FLOOR_COUNT, clearHeightM: number | null = null): DraftFloorRow[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: createUuid(),
    name: nextFloorName(index),
    kind: 'floor' as const,
    clearHeightM,
    isAutoName: true,
  }));
}

/** The step-1 fields a 422 can name (`field` on the wire, AppBack `schemas.py`). */
type ServerField = 'name' | 'code' | 'address';

const SERVER_FIELD_LABELS: Readonly<Record<ServerField, string>> = {
  name: 'tên dự án',
  code: 'mã dự án',
  address: 'địa chỉ',
};

/** A server refusal pinned to the step-1 value it was about; editing that value retires it. */
interface ServerProblem {
  readonly field: ServerField;
  readonly value: string;
  readonly message: string;
}

/** A server refusal of one floor row (`floors.<n>.<key>`); editing that row retires it. */
interface ServerFloorProblem {
  readonly rowId: string;
  /** `floors.<n>.name` marks the name cell; any other key, the height cell. */
  readonly onName: boolean;
  readonly message: string;
}

interface CreateFailure {
  readonly notice: CreateProjectNotice;
  readonly fieldProblem: Omit<ServerProblem, 'value'> | null;
  readonly floorProblem?: ServerFloorProblem;
}

/**
 * Turns a failed create into the notice step 3 shows and, when the server
 * named a step-1 field, the complaint that field carries (BUG-129, BUG-187):
 * every failure used to land on "Tên dự án", whatever the server refused.
 */
function describeCreateFailure(error: unknown, floors: readonly FloorPlan[]): CreateFailure {
  const appError = toAppError(error);
  // A 409 from `projects.create` is, in practice, always a name already taken
  // — the one field this form can collide on.
  if (appError.kind === 'conflict') {
    const message = 'Tên dự án đã trùng với một dự án khác. Đổi tên rồi thử lại.';
    return {
      notice: { level: 'violation', message, fixStep: 1, actionLabel: 'Sửa ở bước 1' },
      fieldProblem: { field: 'name', message },
    };
  }

  const field = appError.kind === 'validation' ? (readWireError(error)?.field ?? null) : null;
  if (field === 'name' || field === 'code' || field === 'address') {
    const label = SERVER_FIELD_LABELS[field];
    return {
      notice: {
        level: 'violation',
        message: `Máy chủ không nhận ${label} này. Sửa ô được đánh dấu ở bước 1 rồi thử lại.`,
        fixStep: 1,
        actionLabel: 'Sửa ở bước 1',
      },
      fieldProblem: { field, message: `Máy chủ không nhận ${label} này. Sửa rồi thử lại.` },
    };
  }

  // `floors.<n>.<key>`: n indexes the floors exactly as they were sent.
  const floorIndex = field !== null && field.startsWith('floors.') ? Number(field.split('.')[1]) : Number.NaN;
  const floor = Number.isInteger(floorIndex) ? floors[floorIndex] : undefined;
  if (floor !== undefined) {
    const floorName = floor.name.trim() === '' ? `thứ ${formatNumber(floorIndex + 1)}` : `"${floor.name}"`;
    return {
      notice: {
        level: 'violation',
        message: `Máy chủ không nhận tầng ${floorName}. Sửa ở bước 2 rồi thử lại.`,
        fixStep: 2,
        actionLabel: 'Sửa ở bước 2',
      },
      fieldProblem: null,
      floorProblem: {
        rowId: rowIdFromLevelId(floor.levelId),
        onName: field?.split('.')[2] === 'name',
        message: 'Máy chủ không nhận giá trị này. Sửa rồi thử lại.',
      },
    };
  }

  // Nothing is marked from here on: "Tạo dự án" stays usable to retry. The
  // shared "unknown" advice says to reload, which would wipe this unsaved form
  // (BUG-188), so the wizard words that one itself; the rest keep the shared,
  // already-Vietnamese wording `describeError` owns.
  const message =
    appError.kind === 'unknown'
      ? 'Hệ thống đã ghi nhận và sẽ kiểm tra. Bấm "Tạo dự án" để thử lại — những gì đã nhập vẫn còn.'
      : describeError(appError).description;
  return { notice: { level: 'violation', message }, fieldProblem: null };
}

/* -------------------------------------------------------------------------- */
/* The floor stack.                                                           */
/* -------------------------------------------------------------------------- */

interface FloorStack {
  readonly plans: readonly FloorPlan[];
  readonly problemById: ReadonlyMap<string, string>;
  readonly elevationLabelById: ReadonlyMap<string, string>;
  readonly collision: string | null;
  readonly collisionRowId: string | null;
}

const CHAIN_BROKEN_BY_HEIGHT = 'Chưa tính được cao độ vì tầng bên dưới còn thiếu chiều cao hợp lệ.';
const CHAIN_BROKEN_BY_ELEVATION = 'Chưa tính được cao độ vì một tầng bên dưới đã vượt giới hạn cao độ.';

function computeFloorStack(rows: readonly DraftFloorRow[]): FloorStack {
  const basement = rows.find((row) => row.kind === 'basement') ?? null;
  const aboveRows = rows.filter((row) => row.kind === 'floor');

  const plans: FloorPlan[] = [];
  const problemById = new Map<string, string>();
  const elevationLabelById = new Map<string, string>();

  let previousCeilingMm: Millimetres | null = null;
  // Why the rows above can no longer be placed — said in their own words, so a
  // row above a floor over the elevation limit never blames a height (BUG-213).
  let chainBroken: string | null = null;

  aboveRows.forEach((row, index) => {
    if (chainBroken !== null) {
      // A row with no height of its own says so; only a row that HAS one is
      // waiting on the floor below (BUG-120).
      problemById.set(row.id, row.clearHeightM === null ? 'Chưa nhập chiều cao tầng (sàn–sàn).' : chainBroken);
      return;
    }

    const heightProblem = heightProblemFor(row.clearHeightM);
    if (heightProblem !== null || row.clearHeightM === null) {
      problemById.set(row.id, heightProblem ?? 'Chưa nhập chiều cao tầng (sàn–sàn).');
      chainBroken = CHAIN_BROKEN_BY_HEIGHT;
      return;
    }

    let floorElevationMm: Millimetres;
    if (index === 0) {
      floorElevationMm = millimetres(0);
    } else if (previousCeilingMm === null) {
      // Defensive only: `chainBroken` already returns before this point once a
      // row fails, so a later row never reaches here with no ceiling to sit on.
      problemById.set(row.id, CHAIN_BROKEN_BY_HEIGHT);
      chainBroken = CHAIN_BROKEN_BY_HEIGHT;
      return;
    } else {
      floorElevationMm = previousCeilingMm;
    }

    const clearHeightMm = roundMeasurement(metresToMillimetres(metres(row.clearHeightM)));
    const elevationProblem = elevationProblemFor(floorElevationMm);
    if (elevationProblem !== null) {
      problemById.set(row.id, elevationProblem);
      chainBroken = CHAIN_BROKEN_BY_ELEVATION;
      return;
    }

    const plan: FloorPlan = {
      levelId: `L-${row.id}` as LevelId,
      name: row.name,
      floorElevationMm,
      clearHeightMm,
      axes: [],
    };
    plans.push(plan);
    previousCeilingMm = ceilingElevationMm(plan);
    elevationLabelById.set(row.id, formatElevationLabel(floorElevationMm));
  });

  if (basement !== null) {
    const heightProblem = heightProblemFor(basement.clearHeightM);
    if (heightProblem !== null || basement.clearHeightM === null) {
      problemById.set(basement.id, heightProblem ?? 'Chưa nhập chiều cao tầng (sàn–sàn).');
    } else {
      const clearHeightMm = roundMeasurement(metresToMillimetres(metres(basement.clearHeightM)));
      // The ONE downward negation for the basement datum: its ceiling has to
      // land exactly on the ground floor's own floor level (0), so its floor
      // level is the negative of its own clear height. Nowhere else in this
      // module computes an elevation by subtraction.
      const floorElevationMm = millimetres(-clearHeightMm);
      const elevationProblem = elevationProblemFor(floorElevationMm);
      if (elevationProblem !== null) {
        problemById.set(basement.id, elevationProblem);
      } else {
        plans.unshift({
          levelId: `L-${basement.id}` as LevelId,
          name: basement.name,
          floorElevationMm,
          clearHeightMm,
          axes: [],
        });
        elevationLabelById.set(basement.id, formatElevationLabel(floorElevationMm));
      }
    }
  }

  const overlaps = plans.length > 0 ? alignFloors(plans).issues.filter((issue) => issue.kind === 'overlap') : [];

  for (const issue of overlaps) {
    const upperId = rowIdFromLevelId(issue.levelId);
    problemById.set(upperId, issue.message);
    if (issue.relatedLevelId !== null) {
      const lowerId = rowIdFromLevelId(issue.relatedLevelId);
      if (!problemById.has(lowerId)) {
        problemById.set(lowerId, issue.message);
      }
    }
  }

  const firstOverlap = overlaps[0] ?? null;

  return {
    plans,
    problemById,
    elevationLabelById,
    collision: firstOverlap?.message ?? null,
    collisionRowId: firstOverlap ? rowIdFromLevelId(firstOverlap.levelId) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Compact viewport.                                                          */
/* -------------------------------------------------------------------------- */

const NARROW_VIEWPORT_QUERY = '(width < 1024px)';

/** `< 1024px` — the same floor `ProjectDashboard`'s three-column grid uses. */
function useNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    setIsNarrow(media.matches);
    const listener = (event: MediaQueryListEvent): void => setIsNarrow(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  return isNarrow;
}

/* -------------------------------------------------------------------------- */
/* The model and the actions.                                                  */
/* -------------------------------------------------------------------------- */

/** The id of the cap note — "Thêm tầng" and the basement switch point at it while it shows. */
export const FLOOR_CAP_NOTE_ID = 'create-project-floor-cap';

const FLOOR_CAP_NOTE = `Đã đủ ${formatNumber(PROJECT_LIMITS.floorCountMax)} tầng, mức tối đa (kể cả tầng hầm).`;

/** The id of step 2's "why can I not continue yet" line — `Tiếp tục` points at it. */
export const FLOORS_HINT_ID = 'create-project-floors-hint';

const FLOORS_HINT = 'Nhập chiều cao tầng (sàn–sàn) cho từng tầng, hoặc dùng "Áp cho mọi tầng", để sang bước xem lại.';

/** The same line once every height is in and something else still blocks step 2 (BUG-120). */
const FLOORS_FIX_HINT = 'Sửa các tầng đang báo lỗi để sang bước xem lại.';

export interface CreateProjectNotice {
  readonly level: 'attention' | 'violation';
  readonly message: string;
  /** The step that holds what the server refused; the notice's button goes there. */
  readonly fixStep?: 1 | 2;
  readonly actionLabel?: string;
}

export interface CreateProjectModel {
  readonly state: SevenState;
  readonly isCompact: boolean;
  readonly canCreate: boolean;
  readonly step: 1 | 2 | 3;
  readonly stepLabel: string;
  readonly isSubmitting: boolean;
  readonly isConfirmingDiscard: boolean;
  readonly isSelectOpen: boolean;
  readonly name: string;
  readonly address: string;
  readonly code: string;
  readonly buildingType: string;
  readonly notes: string;
  readonly buildingTypeOptions: SelectOption[];
  /** Shown on a field nobody has typed into yet; `null` once its value says it all. */
  readonly problems: {
    readonly name: string | null;
    readonly code: string | null;
    readonly address: string | null;
  };
  /** Why "Tên dự án" is required — the reason a pristine step 1 cannot continue yet. */
  readonly nameHint: string;
  /** The name field lost focus: a blank name now says so (G1-29). */
  readonly touchName: () => void;
  readonly notice: CreateProjectNotice | null;
  readonly floorRows: readonly CreateProjectFloorRowModel[];
  /** Why step 2 cannot continue — shown for as long as it cannot, so the locked "Tiếp tục" always says why (BUG-120). */
  readonly floorsHint: string | null;
  readonly hasBasement: boolean;
  readonly collision: string | null;
  readonly collisionRowId: string | null;
  readonly focusFloorId: string | null;
  readonly canAddFloor: boolean;
  /** Why "Thêm tầng" is locked once the stack is full (BUG-177); `null` below the cap. */
  readonly floorCapNote: string | null;
  /** Turning the basement ON adds a row, so it obeys the same cap; turning it off always works. */
  readonly canToggleBasement: boolean;
  /** The height typed into the "áp cho mọi tầng" field; `null` while empty. */
  readonly applyHeightM: number | null;
  readonly canApplyHeight: boolean;
  readonly canGoNext: boolean;
  readonly canSubmit: boolean;
}

export interface CreateProjectActions {
  readonly setName: (value: string) => void;
  readonly setAddress: (value: string) => void;
  readonly setCode: (value: string) => void;
  readonly setBuildingType: (value: string) => void;
  readonly setNotes: (value: string) => void;
  readonly setSelectOpen: (open: boolean) => void;
  readonly setHasBasement: (value: boolean) => void;
  readonly addFloor: () => void;
  readonly removeFloor: (id: string) => void;
  readonly setFloorName: (id: string, value: string) => void;
  readonly setFloorHeight: (id: string, valueM: number | undefined) => void;
  readonly setApplyHeightM: (valueM: number | undefined) => void;
  readonly applyHeightToAllFloors: () => void;
  readonly focusFloor: (id: string) => void;
  readonly acknowledgeFocus: () => void;
  readonly goNext: () => void;
  readonly goBack: () => void;
  /** The notice's "Sửa ở bước n": straight to the step that holds what the server refused. */
  readonly goToFixStep: () => void;
  readonly requestClose: () => void;
  /** The discard prompt's "tiếp tục sửa": the prompt goes, the form stays as it is. */
  readonly keepEditing: () => void;
  readonly confirmDiscard: () => void;
  readonly submit: () => void;
}

/**
 * Every prop the view (and its per-step siblings) render from — model plus
 * actions plus the one field the hook itself has no opinion about.
 *
 * Lives here rather than in `CreateProjectModal.tsx` so that a step split off
 * into its own file (mục D, once a view crosses R-22's 400-line ceiling) can
 * import it without creating an import cycle with the view file.
 */
export interface CreateProjectModalViewProps extends CreateProjectModel, CreateProjectActions {
  readonly isOpen: boolean;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly address: string;
  readonly code: string;
  readonly buildingType: string;
  readonly notes: string;
  readonly floors: readonly FloorPlan[];
}

/** The port this hook talks through — a fetch, an undo, and nothing else. */
export interface CreateProjectGateway {
  readonly create: (request: CreateProjectRequest) => Promise<Result<{ readonly id: string; readonly settingsSaved?: boolean }, unknown>>;
  readonly remove: (projectId: string) => Promise<Result<void, unknown>>;
}

export interface UseCreateProjectModalOptions {
  readonly gateway: CreateProjectGateway;
  readonly role?: ProjectRole;
  /** Overrides the viewport probe — for a story or a test that wants a fixed answer. */
  readonly forceCompact?: boolean;
  /** Số tầng có sẵn lúc mở hộp; mặc định 4. */
  readonly initialFloorCount?: number;
  /** Chiều cao điền sẵn cho mỗi tầng mới (UX-20); bỏ trống thì ô trống như trước. */
  readonly initialFloorHeightM?: number;
  readonly onCreated?: (projectId: string) => void;
  readonly onDismiss: () => void;
  /** Invariant A8's undoable toast. Injected — `Toast.Provider` is mounted by the caller. */
  readonly onToast?: (toast: { readonly message: string; readonly onUndo?: () => void }) => void;
}

export function useCreateProjectModal(
  options: UseCreateProjectModalOptions,
): { readonly model: CreateProjectModel; readonly actions: CreateProjectActions } {
  const { gateway } = options;
  const role = options.role ?? 'engineer';
  const defaultHeightM = options.initialFloorHeightM ?? null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setNameState] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddressState] = useState('');
  const [code, setCodeState] = useState('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [buildingType, setBuildingTypeState] = useState(DEFAULT_BUILDING_TYPE);
  const [notes, setNotesState] = useState('');
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [floorRows, setFloorRows] = useState<readonly DraftFloorRow[]>(() => createDefaultFloorRows(options.initialFloorCount, defaultHeightM));
  const [floorsTouched, setFloorsTouched] = useState(false);
  const [applyHeightM, setApplyHeightMState] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [serverProblem, setServerProblem] = useState<ServerProblem | null>(null);
  const [serverFloorProblem, setServerFloorProblem] = useState<
    (ServerFloorProblem & { readonly refused: DraftFloorRow }) | null
  >(null);
  const [notice, setNotice] = useState<CreateProjectNotice | null>(null);
  const [focusFloorId, setFocusFloorId] = useState<string | null>(null);

  const detectedCompact = useNarrowViewport();
  const isCompact = options.forceCompact ?? detectedCompact;

  const canCreate = can('create', 'project', { roles: [role] });

  const floorStack = useMemo(() => computeFloorStack(floorRows), [floorRows]);
  // The server's complaint about a floor, while that row still holds the values it refused.
  const serverFloor =
    serverFloorProblem !== null &&
    floorRows.some(
      (row) =>
        row.id === serverFloorProblem.rowId &&
        row.name === serverFloorProblem.refused.name &&
        row.clearHeightM === serverFloorProblem.refused.clearHeightM,
    )
      ? serverFloorProblem
      : null;
  const serverFloorMessage = (rowId: string, onName: boolean): string | null =>
    serverFloor !== null && serverFloor.rowId === rowId && serverFloor.onName === onName ? serverFloor.message : null;
  const hasAnyRowProblem =
    serverFloor !== null || floorRows.some((row) => floorStack.problemById.has(row.id) || row.name.trim() === '');
  /** The server's complaint about `field`, while that field still holds the value it refused. */
  const serverProblemFor = (field: ServerField, value: string): string | null =>
    serverProblem !== null && serverProblem.field === field && serverProblem.value === value
      ? serverProblem.message
      : null;
  const serverNameProblem = serverProblemFor('name', name);
  const nameProblem = serverNameProblem ?? localNameProblemFor(name);
  const codeProblem =
    serverProblemFor('code', code) ?? lengthProblemFor('Mã dự án', code, PROJECT_LIMITS.codeMaxLength);
  const addressProblem =
    serverProblemFor('address', address) ?? lengthProblemFor('Địa chỉ', address, PROJECT_LIMITS.addressMaxLength);
  // A form nobody has typed into is not wrong yet (BUG-133): the name's own
  // complaint waits for the first keystroke; a server refusal shows at once.
  const problems = {
    name: nameTouched || serverNameProblem !== null ? nameProblem : null,
    code: codeProblem,
    address: addressProblem,
  };

  const canGoNextStep1 = nameProblem === null && codeProblem === null && addressProblem === null;
  const canGoNextStep2 = floorRows.length > 0 && !hasAnyRowProblem && floorStack.collision === null;
  const canGoNext = step === 1 ? canGoNextStep1 : step === 2 ? canGoNextStep2 : true;
  const canSubmit = canGoNextStep1 && canGoNextStep2 && !isSubmitting;
  const canAddFloor = floorRows.length < PROJECT_LIMITS.floorCountMax;
  const hasBasement = floorRows.some((row) => row.kind === 'basement');
  const canApplyHeight = applyHeightM !== null && floorRows.length > 0;

  const state = useMemo<SevenState>(() => {
    if (isCompact) return 'collapsed';
    if (!canCreate) return 'forbidden';
    if (isSubmitting) return 'loading';
    if (notice !== null && notice.level === 'violation') return 'error';
    if (step === 2 && floorRows.length === 0) return 'empty';
    if (!canGoNextStep1 || floorStack.collision !== null || hasAnyRowProblem) return 'partial';
    return 'success';
  }, [
    isCompact,
    canCreate,
    isSubmitting,
    notice,
    step,
    floorRows.length,
    canGoNextStep1,
    floorStack.collision,
    hasAnyRowProblem,
  ]);

  const floorRowModels: readonly CreateProjectFloorRowModel[] = floorRows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    clearHeightM: row.clearHeightM,
    clearHeightLabel: row.clearHeightM === null ? null : `${formatNumber(row.clearHeightM)} m`,
    elevationLabel: floorStack.elevationLabelById.get(row.id) ?? null,
    // Step 2 opens neutral (BUG-120): a row complains once a height has been typed or applied — or the server refused it.
    problem:
      serverFloorMessage(row.id, false) ?? (floorsTouched ? (floorStack.problemById.get(row.id) ?? null) : null),
    nameProblem: row.name.trim() === '' ? 'Chưa nhập tên tầng.' : serverFloorMessage(row.id, true),
  }));
  const floorsHint =
    floorRows.length === 0 || canGoNextStep2
      ? null
      : floorRows.some((row) => row.clearHeightM === null)
        ? FLOORS_HINT
        : FLOORS_FIX_HINT;

  /** Every mutating action goes through this: it marks the form worth confirming before a close. */
  const markDirty = (): void => {
    setIsDirty(true);
    setIsConfirmingDiscard(false);
    // Any edit makes the last server answer stale.
    setNotice(null);
  };

  /**
   * A height typed or applied: the form is dirty and the rows may now complain. Renaming,
   * adding, removing a row or the basement switch are not — before any height they
   * turned every empty cell red at once (BUG-120, run-15).
   */
  const touchFloors = (): void => {
    markDirty();
    setFloorsTouched(true);
  };

  const setName = (value: string): void => {
    markDirty();
    setNameTouched(true);
    setNameState(value);
    if (!codeManuallyEdited) {
      setCodeState(generateProjectCode(value));
    }
  };

  const setCode = (value: string): void => {
    markDirty();
    setCodeManuallyEdited(true);
    setCodeState(value);
  };

  const setAddress = (value: string): void => {
    markDirty();
    setAddressState(value);
  };

  const setBuildingType = (value: string): void => {
    markDirty();
    setBuildingTypeState(value);
  };

  const setNotes = (value: string): void => {
    markDirty();
    setNotesState(value);
  };

  const addFloor = (): void => {
    if (!canAddFloor) return;
    markDirty();
    setFloorRows((current) => {
      // Numbered after the floors above ground, skipping a name already in the table: after a
      // delete or a rename the plain count repeated "Tầng 3" (BUG-217).
      const taken = new Set(current.map((row) => row.name.trim()));
      let number = current.filter((row) => row.kind === 'floor').length;
      while (taken.has(nextFloorName(number))) number += 1;
      return [...current, { id: createUuid(), name: nextFloorName(number), kind: 'floor', clearHeightM: defaultHeightM, isAutoName: true }];
    });
  };

  const removeFloor = (id: string): void => {
    if (floorRows.length <= 1) return; // At least one floor stays (G1-30).
    markDirty();
    setFloorRows((current) => {
      // Floors still carrying their automatic name ("Tầng trệt", "Tầng 2") follow their new position (G1-30);
      // a name the user typed stays, even when it looks automatic ("Tầng 5" matching the drawing).
      let above = 0;
      return current
        .filter((row) => row.id !== id)
        .map((row) => {
          if (row.kind !== 'floor') return row;
          const position = above;
          above += 1;
          return row.isAutoName === true ? { ...row, name: nextFloorName(position) } : row;
        });
    });
  };

  const setFloorName = (id: string, value: string): void => {
    markDirty();
    setFloorRows((current) => current.map((row) => (row.id === id ? { ...row, name: value, isAutoName: false } : row)));
  };

  const setFloorHeight = (id: string, valueM: number | undefined): void => {
    touchFloors();
    setFloorRows((current) =>
      current.map((row) => (row.id === id ? { ...row, clearHeightM: valueM ?? null } : row)),
    );
  };

  const setApplyHeightM = (valueM: number | undefined): void => {
    setApplyHeightMState(valueM ?? null);
  };

  /** The one place a height is written to every row at once, rather than row by row. */
  const applyHeightToAllFloors = (): void => {
    if (!canApplyHeight || applyHeightM === null) return;
    touchFloors();
    setFloorRows((current) => current.map((row) => ({ ...row, clearHeightM: applyHeightM })));
  };

  const setHasBasement = (value: boolean): void => {
    markDirty();
    setFloorRows((current) => {
      const already = current.some((row) => row.kind === 'basement');
      if (value === already) return current;
      // The basement counts toward the cap like any floor (LIM "basement included", BUG-150).
      if (value && current.length >= PROJECT_LIMITS.floorCountMax) return current;
      if (value) {
        return [{ id: createUuid(), name: 'Tầng hầm', kind: 'basement', clearHeightM: defaultHeightM }, ...current];
      }
      return current.filter((row) => row.kind !== 'basement');
    });
  };

  const goNext = (): void => {
    if (step === 1 && !canGoNextStep1) return;
    if (step === 2 && !canGoNextStep2) return;
    // Moving through the wizard is an answer to the discard prompt: keep editing (BUG-189).
    setIsConfirmingDiscard(false);
    setStep((current) => (current < 3 ? ((current + 1) as 1 | 2 | 3) : current));
  };

  const goBack = (): void => {
    setIsConfirmingDiscard(false);
    setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current));
  };

  /**
   * Invariant A12: Esc reaches here through `Modal.Root`'s `onClose`. Locked
   * while a create is in flight (see the first guard). A first
   * Esc on a dirty form only warns — the inline alert `CreateProjectModal.tsx`
   * renders when `isConfirmingDiscard` is true; a second Esc, or the alert's
   * own button (both land here), really closes.
   */
  const requestClose = (): void => {
    // While "Tạo dự án" is in flight the dialog stays shut to closing: the POST
    // cannot be taken back, so "bỏ thay đổi" would be a promise it breaks (BUG-184).
    if (isSelectOpen || isSubmitting) return;
    if (!isDirty) {
      options.onDismiss();
      return;
    }
    if (isConfirmingDiscard) {
      options.onDismiss();
      return;
    }
    setIsConfirmingDiscard(true);
  };

  const confirmDiscard = (): void => {
    if (isSubmitting) return;
    options.onDismiss();
  };

  const submit = (): void => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setIsConfirmingDiscard(false);
    setNotice(null);

    const request: CreateProjectRequest = {
      name: name.trim(),
      address: address.trim(),
      code: code.trim(),
      buildingType,
      notes: notes.trim(),
      floors: floorStack.plans,
    };

    void gateway.create(request).then((result) => {
      setIsSubmitting(false);

      if (!result.ok) {
        const failure = describeCreateFailure(result.error, request.floors);
        const refused = failure.fieldProblem;
        setNotice(failure.notice);
        setServerProblem(refused === null ? null : { ...refused, value: { name, code, address }[refused.field] });
        const floorRefused = failure.floorProblem;
        const refusedRow = floorRows.find((row) => row.id === floorRefused?.rowId);
        setServerFloorProblem(
          floorRefused === undefined || refusedRow === undefined ? null : { ...floorRefused, refused: refusedRow },
        );
        return;
      }

      const created = result.data;
      // Invariant A8: even a freshly created project is undoable — the toast's
      // undo removes exactly what was just made.
      options.onToast?.({
        message: `Đã tạo dự án "${request.name}".`,
        onUndo: () => {
          void gateway.remove(created.id).then((undone) => {
            if (undone.ok) return;
            // Hết cửa sổ huỷ tạo (hoặc dự án đã có người/thay đổi khác): nói rõ, không im lặng.
            const closed = readWireError(undone.error)?.code === 'CREATE_UNDO_CLOSED';
            options.onToast?.({
              message: closed
                ? `Không hoàn tác được: dự án "${request.name}" đã quá thời gian huỷ hoặc đã có thay đổi. Xoá trong Cài đặt dự án nếu cần.`
                : `Không hoàn tác được việc tạo dự án "${request.name}". Hãy thử lại.`,
            });
          });
        },
      });
      // Dự án đã có; chỉ hai trường khởi tạo chưa lưu được. Nói ra, không làm hỏng lượt tạo.
      if (created.settingsSaved === false) {
        options.onToast?.({
          message: 'Chưa lưu được loại công trình và ghi chú. Bạn có thể nhập lại trong Cài đặt dự án.',
        });
      }
      options.onCreated?.(created.id);
      options.onDismiss();
    });
  };

  const model: CreateProjectModel = {
    state,
    isCompact,
    canCreate,
    step,
    stepLabel: `Bước ${String(step)} / 3`,
    isSubmitting,
    isConfirmingDiscard,
    isSelectOpen,
    name,
    address,
    code,
    buildingType,
    notes,
    buildingTypeOptions: BUILDING_TYPE_OPTIONS,
    problems,
    nameHint:
      name.trim().normalize('NFC').length >= PROJECT_LIMITS.nameMaxLength
        ? `Đã đủ ${formatNumber(PROJECT_LIMITS.nameMaxLength)} ký tự, phần nhập thêm không được nhận.`
        : NAME_HINT,
    touchName: () => setNameTouched(true),
    notice,
    floorRows: floorRowModels,
    floorsHint,
    hasBasement,
    collision: floorStack.collision,
    collisionRowId: floorStack.collisionRowId,
    focusFloorId,
    canAddFloor,
    floorCapNote: canAddFloor ? null : FLOOR_CAP_NOTE,
    canToggleBasement: hasBasement || canAddFloor,
    applyHeightM,
    canApplyHeight,
    canGoNext,
    canSubmit,
  };

  const actions: CreateProjectActions = {
    setName,
    setAddress,
    setCode,
    setBuildingType,
    setNotes,
    setSelectOpen: setIsSelectOpen,
    setHasBasement,
    addFloor,
    removeFloor,
    setFloorName,
    setFloorHeight,
    setApplyHeightM,
    applyHeightToAllFloors,
    focusFloor: (id: string) => setFocusFloorId(id),
    acknowledgeFocus: () => setFocusFloorId(null),
    goNext,
    goBack,
    goToFixStep: () => {
      if (notice?.fixStep !== undefined) setStep(notice.fixStep);
    },
    requestClose,
    keepEditing: () => setIsConfirmingDiscard(false),
    confirmDiscard,
    submit,
  };

  return { model, actions };
}
