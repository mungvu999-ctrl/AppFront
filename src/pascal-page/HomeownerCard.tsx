/**
 * Thẻ nổi cho chủ nhà (K7, K8): chọn đúng MỘT món đồ / cửa đi / cửa sổ ở chế độ Chọn thì hiện thẻ nhỏ
 * gần đáy với tên thường, nguồn ("AI thêm" / "Theo bản vẽ" / "Bạn thêm") và nút có chữ: Xoay 90° (đồ),
 * Xoá, Hoàn tác; cửa đi/cửa sổ thêm hàng chọn kiểu (hình nhỏ) + "Đổi hướng mở"; đồ vật thêm hàng
 * "Kích thước" Dài × Rộng × Cao mm (ghi `scale`, hàm thuần ở `itemSize.ts`).
 * Chỉ là đường tắt dễ hiểu — bảng tham số của Pascal vẫn nguyên; "Đổi mẫu" có thẻ riêng (`SwapModelCard`).
 *
 * Ghi = `useScene.updateNode` / `deleteNode` như bảng của Pascal (`nodes/src/door/panel.tsx`,
 * `window/panel.tsx`), nên Ctrl+Z ghi lại và bộ tự lưu → cầu `onSave` lo phần lưu. Trường ghi đúng tên
 * lược đồ Pascal (`core/src/schema/nodes/door.ts`, `window.ts`).
 *
 * Hàm thuần ở `homeowner/kinds.ts`. Không nhập `@pascal-app/*` (vitest không nạp được gói chưa dựng):
 * `HomeownerCardMount.tsx` truyền store thật.
 * Portal vào `body` như `BottomDock`: đặt trong trang thì cú bấm lọt xuống cảnh và chọn tường phía sau.
 */
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  doorFlipUpdate,
  type DoorKind,
  doorKindOf,
  doorKindUpdate,
  type Fields,
  type HomeownerNode,
  quarterTurn,
  SAVED_DOOR_KINDS,
  SAVED_WINDOW_KINDS,
  sourceLabelOf,
  windowFlipUpdate,
  type WindowKind,
  windowKindOf,
  windowKindUpdate,
} from './homeowner/kinds';
import { formatMm, isRigidItem, parseMm, resizedScale, RIGID_HINT, SIZE_FIELDS, type SizedItem, sizeMmOf, type Vec3 } from './itemSize';

/* -------------------------------------------------------------------------- */
/* Hình nhỏ (mặt bằng, nét `currentColor`).                                    */
/* -------------------------------------------------------------------------- */

const svg = (body: ReactNode) => (
  <svg aria-hidden="true" className="h-5 w-7 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1.5} viewBox="0 0 28 20">
    {body}
  </svg>
);
const WALL = <path d="M1 17h5M22 17h5" strokeWidth={2.5} />;

const DOOR_ICONS: Record<DoorKind, ReactNode> = {
  single: svg(<>{WALL}<path d="M6 17V3" /><path d="M6 3a14 14 0 0 1 16 14" strokeDasharray="2 2" /></>),
  double: svg(<>{WALL}<path d="M6 17V9M22 17V9" /><path d="M6 9a8 8 0 0 1 8 8M22 9a8 8 0 0 0-8 8" strokeDasharray="2 2" /></>),
  sliding: svg(<>{WALL}<path d="M6 15.5h9M13 18.5h9" strokeWidth={2} /><path d="M9 11h8m-2-2 2 2-2 2" /></>),
  pocket: svg(<><path d="M1 17h12M22 17h5" strokeWidth={2.5} /><path d="M3 15h10" /><path d="M20 11h-8m2-2-2 2 2 2" /></>),
  folding: svg(<>{WALL}<path d="M6 17l3-6 4 6 4-6 5 6" /></>),
  opening: svg(<>{WALL}<path d="M6 17V12M22 17V12" strokeDasharray="1.5 2" /></>),
};

const FRAME = <rect height={16} rx={1} width={22} x={3} y={2} />;
const WINDOW_ICONS: Record<WindowKind, ReactNode> = {
  fixed: svg(<>{FRAME}<path d="M14 2v16" opacity={0.4} /></>),
  sliding: svg(<>{FRAME}<path d="M14 2v16" /><path d="M7 10h5m-2-2 2 2-2 2" /></>),
  casement: svg(<>{FRAME}<path d="M25 2 3 10l22 8" strokeDasharray="2 2" /></>),
  casement2: svg(<>{FRAME}<path d="M14 2v16" /><path d="M3 2l11 8L3 18M25 2l-11 8 11 8" strokeDasharray="2 2" /></>),
  awning: svg(<>{FRAME}<path d="M3 18l11-16 11 16" strokeDasharray="2 2" /></>),
  louvered: svg(<>{FRAME}<path d="M6 6h16M6 10h16M6 14h16" /></>),
};

const DOOR_LABELS: Record<DoorKind, string> = {
  single: 'Cánh đơn',
  double: 'Cánh đôi',
  sliding: 'Cửa lùa',
  pocket: 'Lùa âm tường',
  folding: 'Cửa xếp',
  opening: 'Không cánh',
};
/** Mở hất, lá sách: `Opening.swing` không chứa được, mở lại là mất nên không mời chọn (nhãn vẫn cần cho cửa đã có sẵn). */
const SAVEABLE_WINDOW_KINDS: readonly WindowKind[] = ['fixed', 'sliding', 'casement', 'casement2'];
const WINDOW_LABELS: Record<WindowKind, string> = {
  fixed: 'Kính cố định',
  sliding: 'Cửa lùa',
  casement: 'Mở quay',
  casement2: 'Mở quay 2 cánh',
  awning: 'Mở hất',
  louvered: 'Lá sách',
};

/* -------------------------------------------------------------------------- */
/* Thẻ.                                                                        */
/* -------------------------------------------------------------------------- */

interface EditorState {
  readonly mode: string;
  readonly tool: unknown;
  readonly isPreviewMode: boolean;
  readonly isFirstPersonMode: boolean;
}

export interface HomeownerCardStores {
  readonly useViewer: {
    <T>(selector: (state: { selection: { selectedIds: readonly string[] } }) => T): T;
    getState(): { setSelection(selection: { selectedIds: string[] }): void };
  };
  readonly useScene: {
    <T>(selector: (state: { nodes: object }) => T): T;
    getState(): { updateNode(id: string, data: object): void; deleteNode(id: string): void; dirtyNodes?: Set<string> };
  };
  readonly useEditor: <T>(selector: (state: EditorState) => T) => T;
  /** `runUndo` của Pascal — cùng lệnh nút "Hoàn tác" ở thanh dưới / Ctrl+Z. */
  readonly undo: () => void;
  /** `useInteractive.removeDoorOpenState`: đổi kiểu thì bỏ trạng thái cửa đã mở tay (như bảng Pascal). */
  readonly forgetDoorOpenState?: (id: string) => void;
}

const BTN =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--pa-border)] bg-[var(--pa-surface)] px-2.5 font-medium text-[13px] text-[var(--pa-text)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-accent)]';
const KIND_BTN =
  'inline-flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-lg border border-transparent px-1 text-[11px] leading-tight text-[var(--pa-text-2)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] aria-pressed:border-[var(--pa-accent)] aria-pressed:bg-[var(--pa-selected)] aria-pressed:font-medium aria-pressed:text-[var(--pa-accent)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]';

const NOT_SAVED_NOTE = 'Chưa lưu vào dự án: tải lại trang sẽ mất kiểu này';

function KindRow<K extends string>({
  label,
  kinds,
  current,
  labels,
  icons,
  onPick,
}: {
  readonly label: string;
  readonly kinds: readonly K[];
  readonly current: K | undefined;
  readonly labels: Record<K, string>;
  readonly icons: Record<K, ReactNode>;
  readonly onPick: (kind: K) => void;
}) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-0.5" role="group">
      {kinds.map((kind) => (
        <button aria-pressed={current === kind} className={KIND_BTN} key={kind} onClick={() => onPick(kind)} type="button">
          {icons[kind]}
          <span>{labels[kind]}</span>
        </button>
      ))}
    </div>
  );
}

const SIZE_INPUT =
  'h-8 w-[4.25rem] rounded-lg border border-[var(--pa-border)] bg-[var(--pa-surface)] px-1.5 text-right text-[13px] tabular-nums text-[var(--pa-text)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--pa-accent)]';
const ADOPT_NOTE = 'Đổi kích thước thì món này thành đồ của bạn, không còn thuộc bộ bày sẵn của phòng';
/** Đồ máy gợi ý chưa xác nhận: tấm viền, sửa = nhận gợi ý, xoá = bỏ gợi ý (`usePascalEdits.suggestionEditOf`). */
export const UNCONFIRMED_NOTE = 'Máy gợi ý, chưa xác nhận. Sửa thì món được nhận vào bản vẽ, xoá thì bỏ gợi ý.';

/** Dài × Rộng × Cao (mm) + "Giữ tỉ lệ": Enter/rời ô ghi `scale` (một bước Hoàn tác). */
function SizeRow({
  dimensions,
  scale,
  rigid,
  generated,
  onScale,
}: {
  readonly dimensions: Vec3;
  readonly scale: Vec3;
  readonly rigid: boolean;
  readonly generated: boolean;
  readonly onScale: (scale: Vec3) => void;
}) {
  const [keepRatio, setKeepRatio] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const mm = sizeMmOf(dimensions, scale);

  const commit = (input: HTMLInputElement, axis: 0 | 1 | 2) => {
    const value = parseMm(input.value);
    if (value === mm[axis]) {
      input.value = formatMm(mm[axis]);
      return;
    }
    const result = resizedScale(dimensions, scale, axis, value, keepRatio, rigid);
    if (!result.ok) {
      input.value = formatMm(mm[axis]);
      setHint(result.reason);
      return;
    }
    setHint(result.clamped ? RIGID_HINT : null);
    // Kẹp về đúng số cũ thì ô không dựng lại — ghi số đã kẹp vào ô.
    input.value = formatMm(sizeMmOf(dimensions, result.scale)[axis]);
    onScale(result.scale);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, axis: 0 | 1 | 2) => {
    if (event.key === 'Enter') commit(event.currentTarget, axis);
    // Esc: bỏ số đang gõ và rời ô (phím tắt Pascal bỏ qua ô nhập; Esc lần nữa mới bỏ chọn).
    if (event.key === 'Escape') {
      event.currentTarget.value = formatMm(mm[axis]);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div aria-label="Kích thước (mm)" className="flex flex-wrap items-end gap-1" role="group">
        <span className="mr-0.5 pb-1.5 text-[12px] text-[var(--pa-text-2)]">Kích thước</span>
        {SIZE_FIELDS.map(({ axis, label }, i) => (
          <span className="inline-flex items-end gap-1" key={axis}>
            {i > 0 ? <span aria-hidden="true" className="pb-1.5 text-[var(--pa-text-3)]">×</span> : null}
            {/* Nhãn in trên ô: người dùng thấy số nào là Dài / Rộng / Cao (vendor "Thông tin" ghi W×H×D). */}
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--pa-text-2)]">
              {label}
              <input
                aria-label={`${label} (mm)`}
                className={SIZE_INPUT}
                defaultValue={formatMm(mm[axis])}
                inputMode="numeric"
                key={mm[axis]}
                onBlur={(event) => commit(event.currentTarget, axis)}
                onKeyDown={(event) => onKeyDown(event, axis)}
                type="text"
              />
            </label>
          </span>
        ))}
        <span className="pb-1.5 text-[12px] text-[var(--pa-text-2)]">mm</span>
        <button aria-pressed={keepRatio} className={`${BTN} aria-pressed:border-[var(--pa-accent)] aria-pressed:text-[var(--pa-accent)]`} onClick={() => setKeepRatio((v) => !v)} type="button">
          Giữ tỉ lệ
        </button>
      </div>
      {hint === null ? null : (
        <p className="text-[12px] text-[var(--pa-text-3)]" role="status">
          {hint}
        </p>
      )}
      {generated ? <p className="text-[12px] text-[var(--pa-text-3)]">{ADOPT_NOTE}</p> : null}
    </div>
  );
}

export interface HomeownerCardProps {
  readonly stores: HomeownerCardStores;
  readonly readOnly: boolean;
  /** Thẻ của món đang chọn (Đổi mẫu, Nguồn mẫu, Độ tin — main.tsx), cuối hàng nút; trước nằm trên thanh trên. */
  readonly extra?: ReactNode;
}

export function HomeownerCard({ stores, readOnly, extra }: HomeownerCardProps) {
  const ids = stores.useViewer((s) => s.selection.selectedIds);
  const node = stores.useScene((s) =>
    ids.length === 1 ? (s.nodes as Record<string, HomeownerNode | undefined>)[ids[0] as string] : undefined,
  );
  const idle = stores.useEditor((s) => s.mode === 'select' && s.tool == null && !s.isPreviewMode && !s.isFirstPersonMode);
  if (readOnly || !idle || node === undefined) return null;
  if (node.type !== 'item' && node.type !== 'door' && node.type !== 'window') return null;

  const scene = () => stores.useScene.getState();
  const touch = () => {
    // Như bảng Pascal: tường cha dựng lại lỗ khoét.
    const dirty = scene().dirtyNodes;
    dirty?.add(node.id);
    if (node.parentId) dirty?.add(node.parentId);
  };
  const update = (fields: Fields) => {
    if (node.type === 'door' && 'doorType' in fields) stores.forgetDoorOpenState?.(node.id);
    scene().updateNode(node.id, fields);
    if (node.type !== 'item') touch();
  };
  const remove = () => {
    scene().deleteNode(node.id);
    if (node.type !== 'item' && node.parentId) scene().dirtyNodes?.add(node.parentId);
    stores.useViewer.getState().setSelection({ selectedIds: [] });
  };

  const sized = node as HomeownerNode & SizedItem;
  const dimensions = node.type === 'item' ? sized.asset?.dimensions : undefined;
  const setScale = (scale: Vec3) => {
    scene().updateNode(node.id, { scale });
    // Như bảng Pascal: đồ treo tường thì tường cha dựng lại lỗ khoét.
    if (sized.asset?.attachTo === 'wall') touch();
  };

  const name = node.name || (node.type === 'door' ? 'Cửa đi' : node.type === 'window' ? 'Cửa sổ' : node.asset?.name || 'Đồ vật');
  const source = sourceLabelOf(node);
  const unconfirmed = node.metadata?.unconfirmed === true;
  const doorKind = node.type === 'door' ? doorKindOf(node) : undefined;
  const windowKind = node.type === 'window' ? windowKindOf(node) : undefined;
  const flip = node.type === 'door' ? doorFlipUpdate(node) : node.type === 'window' ? windowFlipUpdate(node) : undefined;
  const notSaved =
    (node.type === 'door' && (doorKind === undefined || !SAVED_DOOR_KINDS.has(doorKind))) ||
    (node.type === 'window' && (windowKind === undefined || !SAVED_WINDOW_KINDS.has(windowKind)));

  return createPortal(
    <section
      aria-label={`Thao tác nhanh: ${name}`}
      className="fixed bottom-[5.5rem] left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2 rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-2.5 text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-overlay)]"
      data-appfront-homeowner-card=""
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{name}</span>
        <span className="shrink-0 rounded-md bg-[var(--pa-sunken)] px-1.5 py-0.5 text-[11px] text-[var(--pa-text-2)]">{source}</span>
      </div>
      {node.type === 'door' ? (
        <KindRow
          current={doorKind}
          icons={DOOR_ICONS}
          kinds={Object.keys(DOOR_LABELS) as DoorKind[]}
          label="Kiểu cửa đi"
          labels={DOOR_LABELS}
          onPick={(kind) => update(doorKindUpdate(node, kind))}
        />
      ) : null}
      {node.type === 'window' ? (
        <KindRow
          current={windowKind}
          icons={WINDOW_ICONS}
          kinds={SAVEABLE_WINDOW_KINDS}
          label="Kiểu cửa sổ"
          labels={WINDOW_LABELS}
          onPick={(kind) => update(windowKindUpdate(node, kind))}
        />
      ) : null}
      {unconfirmed ? <p className="max-w-[24rem] text-[12px] text-[var(--pa-text-2)]">{UNCONFIRMED_NOTE}</p> : null}
      {dimensions === undefined ? null : (
        <SizeRow
          dimensions={dimensions}
          generated={source === 'AI thêm'}
          key={node.id}
          onScale={setScale}
          rigid={isRigidItem(sized.asset?.category)}
          scale={sized.scale ?? [1, 1, 1]}
        />
      )}
      {notSaved ? <p className="text-[12px] text-[var(--pa-text-3)]">{NOT_SAVED_NOTE}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {node.type === 'item' ? (
          <button className={BTN} onClick={() => update({ rotation: quarterTurn(node.rotation) })} type="button">
            Xoay 90°
          </button>
        ) : null}
        {flip === undefined ? null : (
          <button className={BTN} onClick={() => update(flip)} type="button">
            Đổi hướng mở
          </button>
        )}
        <button className={BTN} onClick={remove} type="button">
          Xoá
        </button>
        <button className={BTN} onClick={() => stores.undo()} type="button">
          Hoàn tác
        </button>
        {extra}
      </div>
    </section>,
    document.body,
  );
}
