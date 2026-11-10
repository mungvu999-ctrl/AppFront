/**
 * Trang xem công khai của một liên kết chia sẻ: `/share/:token`.
 *
 * Không cần phiên: `GET /share/{token}` đi client trần. Máy chủ là nơi duy nhất
 * phán token còn hiệu lực; lạ/hết hạn/thu hồi đều là cùng một 404.
 * Trình xem là mặt bằng 2D chỉ đọc (phòng có tên, tường, cửa; phóng/kéo được) vẽ thẳng từ đồ thị
 * trả về, vì các màn 2D/3D sẵn có đều đọc store của dự án đang mở chứ không nhận đồ thị.
 * Thẻ 3D (U17) nạp lười `SharedModel3D`: 2D vẫn là mặc định cho máy yếu, three.js chỉ tải khi bấm 3D.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ApiClient, SharedModel } from '@/api/client';
import { ROUTES } from '@/routes/paths';

import { SharedPlan } from './SharedPlan';
import { useSharedModel } from './useSharedModel';
import { isNotFound, SHARE_LINK_GONE_MESSAGE, shareGoneReason } from './shareGone';

const SharedModel3D = lazy(() => import('./SharedModel3D').then((loaded) => ({ default: loaded.SharedModel3D })));

type ShareView = '2d' | '3d';
const VIEW_TABS: readonly { readonly id: ShareView; readonly label: string }[] = [
  { id: '2d', label: 'Mặt bằng 2D' },
  { id: '3d', label: 'Mô hình 3D' },
];

export const PROVISIONAL_AREA_NOTE = 'Diện tích là số tạm tính, bản vẽ chưa đặt tỷ lệ nên kích thước có thể lệch.';

export function SharedModelView({ model }: { model: SharedModel }) {
  const { graph } = model.graph;
  const levels = [...graph.levels].sort((a, b) => a.order - b.order);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<ShareView>('2d');
  const levelId = picked ?? levels[0]?.id ?? '';
  // U03: tầng chưa đặt tỷ lệ thì diện tích chỉ là số tạm tính — nói rõ, không để người nhận tin là số thật.
  const provisionalArea = levels.find((level) => level.id === levelId)?.scaleMillimetresPerPixel === undefined;
  const onLevel = useMemo(
    () => ({
      walls: graph.walls.filter((wall) => wall.levelId === levelId),
      rooms: graph.rooms.filter((room) => room.levelId === levelId),
    }),
    [graph, levelId],
  );
  const openings = useMemo(() => {
    const wallIds = new Set(onLevel.walls.map((wall) => wall.id));
    return graph.openings.filter((opening) => wallIds.has(opening.wallId));
  }, [graph, onLevel]);

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-text-primary">{model.projectName}</h1>
          <p className="text-sm text-text-secondary">Bản xem chỉ đọc qua liên kết chia sẻ.</p>
          {provisionalArea ? <p className="text-sm text-text-secondary">{PROVISIONAL_AREA_NOTE}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Kiểu xem" className="flex gap-1 rounded-md border border-border-control bg-bg-surface p-1">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                className={`h-8 rounded px-3 text-sm ${view === tab.id ? 'bg-bg-app font-medium text-text-primary' : 'text-text-secondary'}`}
                onClick={() => { setView(tab.id); }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {levels.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Tầng
              <select
                className="h-9 rounded-md border border-border-control bg-bg-surface px-2 text-text-primary"
                value={levelId}
                onChange={(event) => { setPicked(event.target.value); }}
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>
      {view === '2d' ? (
        <SharedPlan key={levelId} walls={onLevel.walls} rooms={onLevel.rooms} openings={openings} provisionalArea={provisionalArea} />
      ) : (
        <Suspense fallback={<p className="text-sm text-text-secondary">Đang mở mô hình 3D…</p>}>
          <SharedModel3D key={levelId} graph={graph} levelId={levelId} provisionalArea={provisionalArea} />
        </Suspense>
      )}
    </div>
  );
}

export function SharedModelPage({ client }: { client?: Pick<ApiClient, 'share'> }) {
  const { token = '' } = useParams();
  const query = useSharedModel(token, client);

  return (
    <main className="flex h-screen flex-col bg-bg-app p-6">
      {query.isPending ? <p className="text-sm text-text-secondary">Đang mở liên kết…</p> : null}
      {query.isError ? (
        <div role="alert" className="flex flex-col gap-1">
          <h1 className="text-title text-text-primary">{isNotFound(query.error) ? SHARE_LINK_GONE_MESSAGE : 'Không mở được liên kết'}</h1>
          <p className="text-sm text-text-secondary">
            {isNotFound(query.error)
              ? shareGoneReason(query.error)
              : 'Không kết nối được máy chủ. Thử tải lại trang sau ít phút.'}
          </p>
          {/* Trang cụt thì có lối ra (A-09). */}
          {isNotFound(query.error) ? (
            <Link
              className="mt-2 inline-flex min-h-6 w-fit items-center rounded-sm text-sm text-accent-hover outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-accent coarse:min-h-11"
              to={ROUTES.login}
            >
              Về trang đăng nhập
            </Link>
          ) : null}
        </div>
      ) : null}
      {query.data === undefined ? null : <SharedModelView model={query.data} />}
    </main>
  );
}
