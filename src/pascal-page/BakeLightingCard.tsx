/**
 * Thẻ "Nướng ánh sáng" của trang 3D, trong cụm "Cảnh" cạnh "Ánh sáng". Chỉ hiện cho người sửa được
 * lớp (`main.tsx` ẩn khi `readOnly`, tức `!can('edit', 'layer')`). Logic ở `./useLightingBake`.
 */
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LightingBake } from '@/api/schemas/lightingBake';

import { MENU_SUMMARY_CLASS, menuPanelClass, SECTION_TITLE_CLASS, useMenuGroup } from './menuGroup';
import { bakeStatusLabel, isBakeActive, useLightingBake } from './useLightingBake';

const BUTTON =
  'flex h-9 w-full items-center rounded-lg px-2 text-left text-[var(--pa-text-2)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]';

export interface BakeLightingViewProps {
  readonly bake: LightingBake | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly previewing: boolean;
  readonly onStart: () => void;
  readonly onView: () => void;
  readonly onHide: () => void;
  /** Mục trong menu "Xem" (`./ViewMenu`) thay vì menu riêng. */
  readonly section?: boolean;
}

/** View thuần: test được chỉ từ props. */
export function BakeLightingView({ bake, busy, error, previewing, onStart, onView, onHide, section = false }: BakeLightingViewProps) {
  useMenuGroup();
  const status = error ?? bakeStatusLabel(bake) ?? 'Chưa nướng lần nào';
  const panel = (
      <div className={menuPanelClass(section, 'w-60')}>
        <p aria-live="polite" className="px-2 py-1.5 text-[var(--pa-text-3)]" role="status">
          {status}
        </p>
        <button className={BUTTON} disabled={busy || isBakeActive(bake)} onClick={onStart} type="button">
          {bake === null ? 'Nướng ánh sáng' : 'Nướng lại'}
        </button>
        {bake?.status === 'done' ? (
          <button className={BUTTON} disabled={busy} onClick={previewing ? onHide : onView} type="button">
            {previewing ? 'Tắt ánh sáng nướng' : 'Xem ánh sáng nướng'}
          </button>
        ) : null}
      </div>
  );
  if (section) {
    return (
      <section aria-label="Nướng ánh sáng">
        <h3 className={SECTION_TITLE_CLASS}>Nướng ánh sáng</h3>
        {panel}
      </section>
    );
  }
  return (
    <details className="relative" data-appfront-menu="">
      <summary
        aria-label="Nướng ánh sáng — mở bảng nướng"
        className={MENU_SUMMARY_CLASS}
      >
        Nướng ánh sáng
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-text-3)]" />
      </summary>
      {panel}
    </details>
  );
}

export interface BakeLightingCardProps {
  readonly projectId: string;
  readonly exportGlb: () => Promise<Blob | null>;
  readonly section?: boolean;
  /** Vẽ ngay trước thẻ (đường kẻ của menu); thẻ ẩn thì nó ẩn theo. */
  readonly before?: ReactNode;
}

export function BakeLightingCard({ projectId, exportGlb, section = false, before = null }: BakeLightingCardProps) {
  const state = useLightingBake(projectId, exportGlb);
  // Chưa biết hoặc tắt (API cũ, không có worker) thì ẩn hẳn, không mời người dùng chờ vô ích.
  if (!state.available) return null;
  return (
    <>
      {before}
      <BakeLightingView
        bake={state.bake}
        busy={state.busy}
        error={state.error}
        onHide={state.hide}
        onStart={state.start}
        onView={state.view}
        previewing={state.previewing}
        section={section}
      />
    </>
  );
}
