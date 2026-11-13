/**
 * AppFront (04/11): menu chuột phải của vật dưới con trỏ. Xem `../lib/node-context-menu.ts`.
 * Chọn vật như bấm chuột trái rồi hiện lại các nút của thanh nổi tại con trỏ. `canvas/ContextMenu.tsx` không dùng được ở
 * đây: nó viết bằng token của `globals.css`, trang 3D không nạp tệp đó; nên kiểu theo `--pa-*` như menu Xem.
 */
import { emitter } from '@pascal-app/core';
import { getMovingNode, useEditor } from '@pascal-app/editor';
import { useViewer } from '@pascal-app/viewer';
import { Copy, Group, Move, PencilRuler, Scissors, Search, Spline, Trash2, Ungroup, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';

import { getNodeActions, isPlainClick, runMenuAction, subscribeNodeActions, type NodeActions, type ScreenPoint } from '../lib/node-context-menu';

// Cùng thứ tự và cùng chữ với `NodeActionMenu` (`scripts/pascal-vi/materials-ui.mjs`).
const ITEMS: readonly { key: keyof NodeActions; label: string; icon: LucideIcon }[] = [
  { key: 'onFind', label: 'Tìm trong thư viện', icon: Search },
  { key: 'onMove', label: 'Di chuyển', icon: Move },
  { key: 'onEditMesh', label: 'Sửa lưới', icon: PencilRuler },
  { key: 'onGroup', label: 'Gom nhóm vùng chọn', icon: Group },
  { key: 'onUngroup', label: 'Bỏ nhóm vùng chọn', icon: Ungroup },
  { key: 'onCurve', label: 'Uốn cong', icon: Spline },
  { key: 'onDuplicate', label: 'Nhân bản', icon: Copy },
  { key: 'onAddHole', label: 'Khoét', icon: Scissors },
  { key: 'onDelete', label: 'Xoá', icon: Trash2 },
];

const VIEWPORT_MARGIN = 8;
const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-[var(--pa-hover)] focus-visible:bg-[var(--pa-hover)]';

const canOpen = () => useEditor.getState().mode === 'select' && !getMovingNode();

interface NodeHit {
  node: { id: string; type: string };
  nativeEvent: { nativeEvent: MouseEvent };
}

export function NodeContextMenu() {
  const [at, setAt] = useState<ScreenPoint | null>(null);
  const actions = useSyncExternalStore(subscribeNodeActions, getNodeActions);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let down: ScreenPoint | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setAt(null);
      down = event.button === 2 ? { x: event.clientX, y: event.clientY } : null;
    };

    // 2D: phần tử dưới con trỏ mang `data-node-id`.
    const onContextMenu = (event: MouseEvent) => {
      const up = { x: event.clientX, y: event.clientY };
      const under = document.elementFromPoint(up.x, up.y);
      if (!under?.closest('[data-pascal-floorplan-2d]') || !canOpen() || !isPlainClick(down, up)) return;
      const id = under.closest('[data-node-id]')?.getAttribute('data-node-id');
      if (!id) return;
      const { selection, setSelection } = useViewer.getState();
      if (!selection.selectedIds.includes(id)) setSelection({ selectedIds: [id] });
      setAt(up);
    };

    // 3D: tia chuột của R3F đã có vật. Phát lại đúng sự kiện bấm trái để `selection-manager` chọn theo luật của nó.
    const onNode = (event: NodeHit) => {
      const dom = event.nativeEvent.nativeEvent;
      const up = { x: dom.clientX, y: dom.clientY };
      if (!canOpen() || !isPlainClick(down, up)) return;
      const viewer = useViewer.getState();
      const before = viewer.selection.selectedIds;
      if (!before.includes(event.node.id)) {
        (emitter.emit as (type: string, payload: unknown) => void)(`${event.node.type}:click`, event);
        // Bấm vật đang chọn (qua vật con) là nhấc lên di chuyển: chuột phải không được nhấc.
        if (getMovingNode()) {
          useEditor.getState().setMovingNode(null);
          viewer.setSelection({ selectedIds: before });
        }
      }
      const after = useViewer.getState().selection.selectedIds;
      if (after.includes(event.node.id) || after.join() !== before.join()) setAt(up);
    };

    const on = emitter.on as (type: string, handler: (event: NodeHit) => void) => void;
    const off = emitter.off as (type: string, handler: (event: NodeHit) => void) => void;
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    on('node:context-menu', onNode);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      off('node:context-menu', onNode);
    };
  }, []);

  const items = at && actions ? ITEMS.filter((item) => actions[item.key]) : [];
  const open = items.length > 0;

  // Chiều cao chỉ biết sau khi vẽ: nâng menu lên nếu tràn đáy, rồi đưa tiêu điểm vào mục đầu.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || !at) return;
    const { clientWidth, clientHeight } = document.documentElement;
    menu.style.left = `${String(Math.max(VIEWPORT_MARGIN, Math.min(at.x, clientWidth - menu.offsetWidth - VIEWPORT_MARGIN)))}px`;
    menu.style.top = `${String(Math.max(VIEWPORT_MARGIN, Math.min(at.y, clientHeight - menu.offsetHeight - VIEWPORT_MARGIN)))}px`;
    menu.querySelector('button')?.focus();
  }, [open, at]);

  if (!open || !at || !actions) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') setAt(null);
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      aria-label="Thao tác với đối tượng"
      className="fixed z-[100] w-52 rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-1 shadow-[var(--pa-shadow-overlay)]"
      data-node-context-menu=""
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      ref={menuRef}
      role="menu"
      style={{ left: at.x, top: at.y }}
    >
      {items.map(({ key, label, icon: Icon }) => (
        <button
          className={`${ITEM_CLASS} ${key === 'onDelete' ? 'text-[var(--pa-danger)]' : 'text-[var(--pa-text)]'}`}
          key={key}
          onClick={(event) => {
            runMenuAction(() => actions[key]?.(event), useViewer.getState());
            setAt(null);
          }}
          role="menuitem"
          type="button"
        >
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}
