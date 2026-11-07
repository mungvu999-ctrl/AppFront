/**
 * Thẻ "Phong cách" của trang 3D: chọn một trong năm bộ vật liệu/đồ đạc của cảnh (J6).
 * Phong cách chỉ đọc lúc mở trang (J9), nên đổi = ghi khoá rồi nạp lại trang — trước đó
 * lưu hết việc đang dở: Pascal lưu ngay → bộ tự lưu tầng xả → nạp lại.
 *
 * W4a: phong cách lưu THEO DỰ ÁN (cộng sự thấy cùng một nhà). Ai sửa được cài đặt thì PUT vào
 * dự án trước; người khác chỉ xem thử trên máy này (khoá riêng dự án, không gửi đi).
 */
import { ChevronDown, Palette } from 'lucide-react';
import { useState } from 'react';

import {
  DEFAULT_SCENE_STYLE,
  SCENE_STYLE_IDS,
  SCENE_STYLE_STORAGE_KEY,
  SCENE_STYLES,
  sceneStylePreviewKey,
  type SceneStyleId,
} from '@/lib/pascal/sceneStyles';

import { DESIGN_STYLE_IDS, type DesignStyleId } from '@/api/schemas/designConcept';
import { DESIGN_STYLE_LABELS } from '@/lib/pascal/designStyles';

import {
  currentProjectSceneStyle,
  type ProjectDesignConcept,
  type ProjectSceneStyle,
} from './bridge';
import { MENU_SUMMARY_CLASS, menuPanelClass, SECTION_TITLE_CLASS, useMenuGroup } from './menuGroup';

/** AID-01 — thăm dò N47 mỗi 3 s, tối đa 2 phút. */
export const CONCEPT_POLL_MS = 3000;
export const CONCEPT_POLL_LIMIT_MS = 120_000;
export const CONCEPT_WORKING = 'Đang hoàn thiện nội thất…';
export const CONCEPT_FAILED = 'Chưa hoàn thiện được nội thất, đang dùng cách bày mặc định';
const AI_SUGGESTION = 'AI đề xuất cho căn này';

const ITEM_CLASS =
  'flex h-8 w-full items-center whitespace-nowrap rounded-lg px-2 text-left text-[var(--pa-text-2)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] aria-pressed:bg-[var(--pa-selected)] aria-pressed:font-medium aria-pressed:text-[var(--pa-accent)] disabled:opacity-50 motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]';
const NOTE_CLASS = 'px-2 py-1 text-[12px] text-[var(--pa-text-3)]';

/** Đợi lượt `id` xong: `true` = done, `false` = hỏng hoặc quá 2 phút. Lỗi đọc N47 bỏ qua, thử lại lượt sau. */
const waitConceptDone = async (concept: ProjectDesignConcept, id: string): Promise<boolean> => {
  const deadline = Date.now() + CONCEPT_POLL_LIMIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CONCEPT_POLL_MS));
    const active = (await concept.read().catch(() => null))?.active;
    if (active?.id === id && active.status === 'done') return true;
    if (active?.id === id && active.status === 'failed') return false;
  }
  return false;
};

/**
 * AID-01 — danh sách khi AI phong cách bật: "AI đề xuất cho căn này" đứng đầu rồi 12 kiểu. Chọn → N48;
 * lượt đang chạy thì thăm dò N47; xong → lưu → xả → nạp lại (cầu áp concept lúc mở trang); hỏng → câu nhẹ.
 */
function DesignConceptList({
  concept,
  saveNow,
  flushAutosaves,
  reload,
}: { readonly concept: ProjectDesignConcept } & Omit<SceneStyleCardProps, 'source'>) {
  const { active, suggestedStyleId } = concept.state;
  const [phase, setPhase] = useState<'idle' | 'working' | 'failed'>('idle');
  const choose = async (styleId: DesignStyleId | undefined) => {
    if (phase === 'working') return;
    setPhase('working');
    try {
      const picked = await concept.select(styleId);
      const done =
        picked.status === 'done' ||
        (picked.status !== 'failed' && (await waitConceptDone(concept, picked.id)));
      if (!done) {
        setPhase('failed');
        return;
      }
      await saveNow();
      await flushAutosaves();
      reload();
    } catch {
      setPhase('failed');
    }
  };
  const suggestionLabel =
    suggestedStyleId === undefined
      ? AI_SUGGESTION
      : `${AI_SUGGESTION}: ${DESIGN_STYLE_LABELS[suggestedStyleId]}`;

  return (
    <>
      <li>
        <button
          aria-pressed={active?.suggested === true}
          className={ITEM_CLASS}
          disabled={phase === 'working'}
          onClick={() => void choose(undefined)}
          type="button"
        >
          {suggestionLabel}
        </button>
      </li>
      {DESIGN_STYLE_IDS.map((id) => (
        <li key={id}>
          <button
            aria-pressed={active !== undefined && !active.suggested && active.styleId === id}
            className={ITEM_CLASS}
            disabled={phase === 'working'}
            onClick={() => void choose(id)}
            type="button"
          >
            {DESIGN_STYLE_LABELS[id]}
          </button>
        </li>
      ))}
      {phase === 'working' ? (
        <li className={NOTE_CLASS} role="status">
          {CONCEPT_WORKING}
        </li>
      ) : null}
      {phase === 'failed' ? (
        <li className={NOTE_CLASS} role="status">
          {CONCEPT_FAILED}
        </li>
      ) : null}
    </>
  );
}


export interface SceneStyleCardProps {
  /** Lưu ngay cảnh Pascal (lối Ctrl+S của editor) và đợi lượt ghi qua cầu. */
  readonly saveNow: () => Promise<void>;
  /** Xả mọi bộ tự lưu của AppFront (`flushAutosaves`). */
  readonly flushAutosaves: () => Promise<unknown>;
  readonly reload: () => void;
  /** Phong cách của dự án đang mở; mặc định đọc từ cầu (test cắm thẳng vào). */
  readonly source?: ProjectSceneStyle | null;
  /** Mục trong menu "Xem" (`./ViewMenu`) thay vì menu riêng. */
  readonly section?: boolean;
}

export function SceneStyleCard({ saveNow, flushAutosaves, reload, source = currentProjectSceneStyle(), section = false }: SceneStyleCardProps) {
  useMenuGroup();
  const current = source?.id ?? DEFAULT_SCENE_STYLE;
  const concept = source?.designConcept;
  const saveToProject = source?.saveToProject;
  // Khoá xem thử của dự án; chưa có dự án (không xảy ra sau khi cầu nạp xong) thì khoá chung J9.
  const localKey = source == null ? SCENE_STYLE_STORAGE_KEY : sceneStylePreviewKey(source.projectId);
  const [saving, setSaving] = useState(false);
  /** Phong cách vừa lưu hỏng (để nút "Thử lại" chọn lại đúng nó); null = không lỗi. */
  const [failed, setFailed] = useState<SceneStyleId | null>(null);

  const choose = async (id: SceneStyleId) => {
    if (saving || id === current) return;
    if (saveToProject === undefined) {
      try {
        localStorage.setItem(localKey, id);
      } catch {
        // Bộ nhớ bị chặn: vẫn lưu + nạp lại, trang mở với phong cách mặc định.
      }
    }
    setSaving(true);
    setFailed(null);
    try {
      if (saveToProject !== undefined) {
        await saveToProject(id);
        // Bỏ bản xem thử cũ (nếu có) để phong cách của dự án thắng.
        try {
          localStorage.removeItem(localKey);
        } catch {
          // Bộ nhớ bị chặn: không có bản xem thử nào để bỏ.
        }
      }
      await saveNow();
      await flushAutosaves();
      reload();
    } catch {
      // Lưu hỏng thì KHÔNG nạp lại (mất việc dở). Lối máy: khoá đã ghi, lần mở sau vẫn theo phong cách mới.
      setSaving(false);
      setFailed(id);
    }
  };

  const list = (
      <ul
        aria-label="Danh sách phong cách"
        className={menuPanelClass(section, 'min-w-44')}
      >
        {/* A2-09/L1-11: chọn phong cách là dựng lại cả mô hình — báo trước. */}
        <li className="px-2 pt-1 pb-1 text-[12px] text-[var(--pa-text-3)]">Mô hình sẽ dựng lại vài giây</li>
        {concept !== undefined ? (
          <DesignConceptList concept={concept} flushAutosaves={flushAutosaves} reload={reload} saveNow={saveNow} />
        ) : (
          SCENE_STYLE_IDS.map((id) => (
          <li key={id}>
            <button
              aria-pressed={id === current}
              className={ITEM_CLASS}
              disabled={saving}
              onClick={() => void choose(id)}
              type="button"
            >
              {SCENE_STYLES[id].label}
            </button>
          </li>
          ))
        )}
        {concept === undefined && saveToProject === undefined ? <li className="px-2 py-1 text-[12px] text-[var(--pa-text-3)]">Chỉ áp dụng trên máy này</li> : null}
        {saving ? <li className="px-2 py-1 text-[12px] text-[var(--pa-text-3)]">Đang lưu rồi tải lại…</li> : null}
        {failed !== null ? (
          <li className="flex items-center gap-2 px-2 py-1 text-[12px] text-[var(--pa-danger)]" role="alert">
            <span className="min-w-0 flex-1">Chưa lưu được phong cách, cảnh giữ nguyên.</span>
            <button
              className="h-8 shrink-0 rounded-lg px-2 font-medium text-[var(--pa-accent)] hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-accent-hover)] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]"
              onClick={() => void choose(failed)}
              type="button"
            >
              Thử lại
            </button>
          </li>
        ) : null}
      </ul>
  );
  if (section) {
    return (
      <section aria-label="Phong cách">
        <h3 className={SECTION_TITLE_CLASS}>Phong cách</h3>
        {list}
      </section>
    );
  }

  return (
    <details className="relative" data-appfront-menu="">
      <summary
        aria-label={`Phong cách: ${SCENE_STYLES[current].label} — mở danh sách phong cách`}
        className={MENU_SUMMARY_CLASS}
        title={`Đổi phong cách cảnh (đang dùng: ${SCENE_STYLES[current].label})`}
      >
        <Palette aria-hidden="true" className="h-4 w-4 shrink-0 @min-[1300px]/appbar:hidden" />
        <span className="hidden @min-[1300px]/appbar:inline">Phong cách</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-text-3)] @max-[1200px]/appbar:hidden" />
      </summary>
      {list}
    </details>
  );
}
