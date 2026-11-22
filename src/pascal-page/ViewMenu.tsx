/**
 * Menu "Xem" của thanh trên trang 3D: gộp Phong cách, Ánh sáng, Chất lượng hình và Nướng ánh sáng
 * vào MỘT menu thả xuống chia mục (thanh trên trước dài, bốn menu mở chồng nhau). Mỗi mục là thẻ cũ
 * ở chế độ `section`, logic giữ nguyên.
 */
import { ChevronDown, Eye } from 'lucide-react';
import type { ReactNode } from 'react';

import { BakeLightingCard } from './BakeLightingCard';
import { LightingCard, type LightingCardProps } from './LightingCard';
import { MENU_SUMMARY_CLASS, SECTION_TITLE_CLASS, useMenuGroup } from './menuGroup';
import { QualityCard } from './QualityCard';
import { SceneStyleCard, type SceneStyleCardProps } from './SceneStyleCard';

export interface ViewMenuProps {
  readonly projectId: string;
  readonly useViewer: LightingCardProps['useViewer'];
  readonly saveNow: SceneStyleCardProps['saveNow'];
  readonly flushAutosaves: SceneStyleCardProps['flushAutosaves'];
  readonly reload: SceneStyleCardProps['reload'];
  /** Không có (chỉ xem) thì ẩn mục Nướng ánh sáng. */
  readonly exportGlb?: () => Promise<Blob | null>;
  /** Mục "Hiển thị" cuối menu (lưới, bóng, đơn vị, kết xuất — `DisplayMenu` của Pascal); trước là nút riêng trên thanh. */
  readonly display?: ReactNode;
  /** Chỉ cho test: phong cách của dự án. */
  readonly source?: SceneStyleCardProps['source'];
}

const DIVIDER = 'mx-2 my-1 border-t border-[var(--pa-border)]';

export function ViewMenu({ projectId, useViewer, saveNow, flushAutosaves, reload, exportGlb, display, source }: ViewMenuProps) {
  useMenuGroup();
  return (
    <details className="relative" data-appfront-menu="">
      <summary aria-label="Xem — phong cách, ánh sáng, chất lượng hình, hiển thị" className={MENU_SUMMARY_CLASS} title="Phong cách, ánh sáng, chất lượng hình, hiển thị">
        <Eye aria-hidden="true" className="h-4 w-4 shrink-0" />
        Xem
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-text-3)]" />
      </summary>
      {/* 11rem = khoảng trên menu (~3.5rem) + thanh công cụ đáy (bottom-6 + ~3.5rem + khe): dòng cuối không lọt dưới thanh đáy. */}
      <div
        className="absolute top-full right-0 z-50 mt-1 max-h-[calc(100vh-11rem)] w-64 overflow-y-auto rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-1 shadow-[var(--pa-shadow-overlay)]"
      >
        <SceneStyleCard
          flushAutosaves={flushAutosaves}
          reload={reload}
          saveNow={saveNow}
          section
          {...(source === undefined ? {} : { source })}
        />
        <div aria-hidden="true" className={DIVIDER} />
        <LightingCard projectId={projectId} section useViewer={useViewer} />
        <div aria-hidden="true" className={DIVIDER} />
        <QualityCard section />
        {exportGlb === undefined ? null : (
          <BakeLightingCard
            before={<div aria-hidden="true" className={DIVIDER} />}
            exportGlb={exportGlb}
            projectId={projectId}
            section
          />
        )}
        {display === undefined ? null : (
          <>
            <div aria-hidden="true" className={DIVIDER} />
            <p className={SECTION_TITLE_CLASS}>Hiển thị</p>
            {display}
          </>
        )}
      </div>
    </details>
  );
}
