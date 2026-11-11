/**
 * Tab "Trực quan" — khối 3D của phiên bản CŨ trong cặp so (lùi về mô hình hiện tại khi bản cũ
 * chưa có nội dung), tô sáng những đối tượng đã đổi.
 *
 * Store Pascal là một singleton nên không dựng được hai cảnh cạnh nhau: tab dựng MỘT cảnh qua
 * khung `view` của nó, và rời tab thì `dispose` trả chỗ lại cho cảnh kế. `visual.caption` bắt
 * buộc hiện ở mọi nhánh có mô hình để người đọc biết đang nhìn bản nào.
 *
 * ## Vì sao nạp gói Pascal lúc chạy
 *
 * Pascal là gói dựng riêng (`pascalMount.tsx`); `defaultLoadMount` nạp nó bằng thẻ script
 * khi tab này mở, không kéo nó vào gói tĩnh của tuyến. Cảnh đến từ prop vì `toPascalScene` là
 * dữ liệu, mà `local/no-data-layer-in-view` chặn import chạy trong một view.
 */

import { Boxes, MonitorOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import type { PascalMountOptions } from '@/components/pascal/pascalMountTypes';
import { bodyOfPascalId } from '@/lib/pascal/ids';
import { assetRefreshStatus, subscribeAssetRefresh } from '@/lib/pascal/sceneLibrary';
import { defaultLoadMount, type MountModule } from '@/screens/viewer/PascalViewer/usePascalViewer';

import type { VisualDiffModel } from './types';

/* -------------------------------------------------------------------------- */
/* Chuỗi tiếng Việt tĩnh — khớp `compare.vi.json.fragment`.                     */
/* -------------------------------------------------------------------------- */

const UNAVAILABLE_TITLE = 'Chưa xem trực quan được';
const UNAVAILABLE_BODY = 'Không dựng được mô hình cho cặp phiên bản đang chọn.';
const WEBGL_TITLE = 'Máy này không dựng được 3D';
const WEBGL_BODY =
  'Trình duyệt không bật WebGL nên khối 3D không hiện. Hai tab còn lại vẫn mô tả đủ khác biệt.';
const BUILDING_LABEL = 'Đang dựng mô hình';
/** Cảnh dựng bản gốc, hoặc bản đối chiếu khi bản gốc trống (`useVersionHistory.ts` `sceneGraph`); caption nêu bản nào. */
const VISUAL_HINT =
  'Khối 3D dựng một bản (nêu ở câu trên), nên chỉ tô được đối tượng có trong bản ấy. Phần còn lại xem ở mặt bằng 2D hoặc thẻ "Thay đổi".';

/**
 * Mã node Pascal của các đối tượng AppFront đang được tô sáng (đã đổi, cộng hàng đang trỏ).
 * Mã đầu tường đã được `buildVisualModel` quy về mã tường, nên so thẳng với thân mã node.
 */
function highlightIdsOf(visual: VisualDiffModel): readonly string[] {
  if (visual.scene === null) {
    return [];
  }

  const wanted = new Set(visual.changedEntityIds);

  if (visual.hoveredEntityId !== null) {
    wanted.add(visual.hoveredEntityId);
  }

  return Object.keys(visual.scene.nodes).filter((nodeId) => wanted.has(bodyOfPascalId(nodeId)));
}

export interface VersionVisualDiffProps {
  readonly visual: VisualDiffModel;
}

export function VersionVisualDiff({ visual }: VersionVisualDiffProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [isRendererMissing, setRendererMissing] = useState(false);
  const handleRef = useRef<ReturnType<MountModule['mount']> | null>(null);

  /** Mã tô sáng đọc qua một ref để đổi chúng không dựng lại cảnh. */
  const highlightIds = highlightIdsOf(visual);
  const highlightKey = highlightIds.join('|');
  const highlightRef = useRef(highlightIds);

  useEffect(() => {
    highlightRef.current = highlightIds;
  });

  const hostRef = useCallback((next: HTMLDivElement | null): void => {
    setHost(next);
  }, []);

  const scene = visual.scene;
  /* Mẫu hết hạn không tải lại được sau khi gia hạn (`installAssetRefresh`): cùng câu báo với editor. */
  const assetNotice = useSyncExternalStore(subscribeAssetRefresh, () => assetRefreshStatus().notice);

  /* Chạy lại khi đổi cảnh (đổi cặp phiên bản): dựng lại đúng cảnh mới, dispose cảnh cũ. */
  useEffect(() => {
    if (host === null || scene === null) {
      return undefined;
    }

    let cancelled = false;

    // Không dựng được (không GPU, gói hỏng) là một nhánh hợp lệ: tab nói ra một câu bình
    // thường thay vì để lại một ô đen.
    const fail = (): void => {
      if (!cancelled) setRendererMissing(true);
    };

    defaultLoadMount()
      .then((module) => {
        if (cancelled) return;

        // Vừa khung bao cả cảnh và cho xoay/thu phóng (V1c); `MountModule` chưa khai hai khoá này.
        const options: Parameters<MountModule['mount']>[1] &
          Pick<PascalMountOptions, 'cameraControls' | 'fit'> = {
          scene,
          mode: 'view',
          readOnly: true,
          fit: 'scene',
          cameraControls: true,
          onReadyChange: (ready) => {
            if (ready) handleRef.current?.setHighlight?.(highlightRef.current);
          },
          onFatal: fail,
          onRendererUnavailable: fail,
        };
        handleRef.current = module.mount(host, options);
      })
      .catch(fail);

    return (): void => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [host, scene]);

  /* Trỏ vào một hàng diff, hoặc đổi cặp phiên bản: tô sáng lại. */
  useEffect(() => {
    handleRef.current?.setHighlight?.(highlightRef.current);
  }, [highlightKey]);

  if (!visual.isAvailable) {
    return (
      <EmptyState
        icon={<Boxes className="text-text-tertiary" />}
        title={UNAVAILABLE_TITLE}
        description={visual.unavailableReason ?? UNAVAILABLE_BODY}
      />
    );
  }

  if (isRendererMissing) {
    return (
      <EmptyState
        icon={<MonitorOff className="text-text-tertiary" />}
        title={WEBGL_TITLE}
        description={WEBGL_BODY}
      />
    );
  }

  const isReady = visual.scene !== null;

  /*
   * Trạng thái 3 — đang dựng. Khung xương, không phải màn trắng; và caption đi cùng ngay từ
   * lúc này để câu "đây là mô hình hiện tại" không đến sau khối 3D.
   */
  if (!isReady) {
    if (!visual.isBuilding) {
      return (
        <EmptyState
          icon={<Boxes className="text-text-tertiary" />}
          title={UNAVAILABLE_TITLE}
          description={visual.unavailableReason ?? UNAVAILABLE_BODY}
        />
      );
    }

    return (
      <figure className="flex flex-col gap-2">
        <Skeleton preset="canvas" aria-label={BUILDING_LABEL} role="status" />
        <figcaption className="text-[13px] leading-relaxed text-text-secondary">
          <span className="block">{visual.caption}</span>
          <span className="block">{VISUAL_HINT}</span>
          {visual.libraryNotice ? <span className="block" role="status">{visual.libraryNotice}</span> : null}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative aspect-video max-h-[55vh] w-full overflow-hidden rounded-lg bg-bg-sunken">
        <div ref={hostRef} aria-hidden="true" className="h-full w-full" />
        {visual.isBuilding ? (
          <div className="absolute inset-0">
            <Skeleton preset="canvas" aria-label={BUILDING_LABEL} role="status" />
          </div>
        ) : null}
      </div>
      <figcaption className="text-[13px] leading-relaxed text-text-secondary">
        <span className="block">{visual.caption}</span>
        <span className="block">{VISUAL_HINT}</span>
          {visual.libraryNotice ? <span className="block" role="status">{visual.libraryNotice}</span> : null}
        {assetNotice ? <span className="block text-text-primary" role="alert">{assetNotice}</span> : null}
      </figcaption>
    </figure>
  );
}
