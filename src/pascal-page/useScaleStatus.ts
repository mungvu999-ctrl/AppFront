/**
 * `useScaleStatus` — trang 3D có nên cảnh báo "bản vẽ chưa hiệu chỉnh tỷ lệ" không (WP8).
 *
 * Cùng một luật với QC (Codex P1, `floorScaleMissingOf` ở Quản lý tầng): chỉ tầng N16 báo
 * `scaleStatus: 'unresolved'` mới bị xét; tầng người đã đặt tỷ lệ thì để yên, kể cả nhà nhỏ.
 * Trong số đó, `floorScaleStateOf` + `scaleImplausibleOf` chia hai nhóm: `missing` — máy không đo
 * được tỷ lệ (`project_default`) hoặc đo ra hình vô lý (trung vị tường < 50 mm, khối tường < 3 m),
 * kích thước 3D sai hẳn; `provisional` — tỷ lệ máy đo, chưa ai xác nhận. `floorId` là tầng cần sửa
 * trước (tầng sai hẳn đầu tiên).
 *
 * R9: N16 có `scaleState` thì tách thêm — `measured` (đọc từ bản vẽ) và `confirmed` ra khỏi dải;
 * `estimated` (chỉ ước) và `undetermined` (chưa xác định) mỗi nhóm một dòng, kèm câu lý do. Không nhóm
 * R9 nào bị bỏ khỏi cảnh 3D trừ `missing` (mặc định dự án / hình vô lý) — như trước.
 *
 * Tầng đọc N16 lỗi thì không biết tỷ lệ của nó (chỉ ghi log một lần): không giấu tầng ấy khỏi cảnh,
 * nhưng hình vô lý thì vẫn nhắc "có thể sai" — để một tầng hỏng không giấu cảnh báo của cả nhà.
 *
 * Một nguồn cho cả trang (Codex P1): dải cảnh báo và cầu dựng cảnh (`bridge`, bỏ tầng `missingIds`
 * khỏi cảnh 3D) cùng đợi `scaleStatusOf`, nên N16 chỉ đọc một lượt và hai bên không lệch nhau.
 */
import { useEffect, useState } from 'react';

import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { denormalizeSpatial } from '@/domain/spatial/normalize';
import type { Level } from '@/domain/spatial/types';
import { scaleStateMessageOf } from '@/lib/viewmodel/provisionalScale';
import { floorScaleStateOf, scaleImplausibleOf } from '@/screens/qc/shared/floorReviewGateModel';
import { type RootState, useStore } from '@/store';

export type ScaleStatus =
  | { readonly status: 'unknown' }
  | { readonly status: 'resolved' }
  | {
      readonly status: 'unresolved';
      readonly floorId: string;
      /** Tên tầng sai hẳn (không đo được tỷ lệ, hoặc đo ra hình vô lý). */
      readonly missing: readonly string[];
      /** Mã các tầng `missing` — cầu bỏ chúng khỏi cảnh 3D. */
      readonly missingIds: readonly string[];
      /** Mọi tầng đều sai hẳn: cảnh 3D trống. */
      readonly allMissing: boolean;
      /** Tên tầng tỷ lệ máy đo, chưa xác nhận (máy chủ cũ, không có `scaleState`). */
      readonly provisional: readonly string[];
      /** R9: tên tầng tỷ lệ chưa xác định (thiếu căn cứ / nguồn mâu thuẫn). */
      readonly undetermined: readonly string[];
      /** R9: tên tầng tỷ lệ chỉ ước lượng. */
      readonly estimated: readonly string[];
      /** R9: câu trạng thái + lý do của tầng đầu mỗi nhóm (`scaleStateMessageOf`); `null` khi không có. */
      readonly undeterminedNote: string | null;
      readonly estimatedNote: string | null;
    };

/** Phần N16 cần đọc: trạng thái, nguồn tỷ lệ và mm/px của tầng (dự phòng khi kho thiếu). */
export type ReadScale = (
  floorId: string,
) => Promise<
  Pick<FloorLayerDocument, 'scaleStatus' | 'scaleSource' | 'scaleState' | 'scaleReasons'> & { readonly level?: { readonly scaleMillimetresPerPixel?: number } }
>;

let failureLogged = false;

/** Một client cho mọi tầng (nạp mô-đun một lần, không mỗi tầng một lượt). */
function defaultReadScale(projectId: string): ReadScale {
  const client = import('@/api/appClient').then(({ createAppApiClient }) => createAppApiClient());
  return async (floorId) => {
    const result = await (await client).spatial.readLayer({ projectId, floorId });
    if (!result.ok) throw result.error;
    return result.data;
  };
}

type Spatial = NonNullable<RootState['spatial']>;

type FloorMeta = RootState['floorMeta'];

/**
 * UX-R2 K39: tầng mà kho đã biết là tỷ lệ tạm (`floorMeta` có `scaleStatus`, đọc từ N16 trước đó)
 * thì dùng luôn, không đọc lại N16. Tầng kho không ghi gì vẫn phải đọc: N15 không mang
 * `scaleStatus`, nên "vắng" có thể là "đã đặt" hoặc "chưa biết".
 */
const readOrKnown = (read: ReadScale, floorMeta: FloorMeta) => (floorId: string) => {
  const { scaleReasons, scaleSource, scaleState, scaleStatus } = floorMeta[floorId] ?? {};
  if (scaleStatus === undefined) return read(floorId);
  return Promise.resolve({
    scaleStatus,
    ...(scaleSource === undefined ? {} : { scaleSource }),
    ...(scaleState === undefined ? {} : { scaleState }),
    ...(scaleReasons === undefined ? {} : { scaleReasons }),
  });
};

async function readScaleStatus(spatial: Spatial, read: ReadScale, floorMeta: FloorMeta): Promise<ScaleStatus> {
  const { levels } = denormalizeSpatial(spatial);
  const readFloor = readOrKnown(read, floorMeta);
  const results = await Promise.allSettled(levels.map((level) => readFloor(level.id)));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure !== undefined && !failureLogged) {
    failureLogged = true;
    console.warn('[pascal] không đọc được trạng thái tỷ lệ tầng', failure.reason);
  }
  const missing: Level[] = [];
  const provisional: Level[] = [];
  const undetermined: Level[] = [];
  const estimated: Level[] = [];
  const notes: { undetermined: string | null; estimated: string | null } = { undetermined: null, estimated: null };
  levels.forEach((level, index) => {
    const result = results[index];
    const implausible = scaleImplausibleOf(spatial, level.id);
    if (result?.status !== 'fulfilled') {
      if (implausible) provisional.push(level);
      return;
    }
    const { scaleReasons, scaleStatus, scaleSource, scaleState } = result.value;
    const document = 'level' in result.value ? result.value.level : undefined;
    if (scaleStatus !== 'unresolved') return;
    const millimetresPerPixel = level.scaleMillimetresPerPixel ?? document?.scaleMillimetresPerPixel;
    const state = floorScaleStateOf(scaleStatus, scaleSource, millimetresPerPixel, implausible, scaleState);
    if (state === 'measured' || state === 'confirmed') return;
    if (state === 'undetermined' || state === 'estimated') {
      (state === 'undetermined' ? undetermined : estimated).push(level);
      notes[state] ??= scaleStateMessageOf(state, scaleReasons);
      return;
    }
    (state === 'missing' ? missing : provisional).push(level);
  });
  const first = missing[0] ?? undetermined[0] ?? provisional[0] ?? estimated[0];
  const names = (list: readonly Level[]) => list.map((level) => level.name);
  return first === undefined
    ? { status: 'resolved' }
    : {
        status: 'unresolved',
        floorId: first.id,
        missing: names(missing),
        missingIds: missing.map((level) => level.id),
        allMissing: missing.length === levels.length,
        provisional: names(provisional),
        undetermined: names(undetermined),
        estimated: names(estimated),
        undeterminedNote: notes.undetermined,
        estimatedNote: notes.estimated,
      };
}

/** Lượt đọc gần nhất — cùng dự án, cùng cảnh vừa nạp, cùng hàm đọc thì dùng lại (một lượt N16 cho cả trang). */
let memo: { projectId: string; spatial: Spatial; read: ReadScale | undefined; status: Promise<ScaleStatus> } | null = null;

/** Trạng thái tỷ lệ của cảnh đang nằm trong kho; `resolved` khi kho chưa có cảnh. */
export function scaleStatusOf(projectId: string, readScale?: ReadScale): Promise<ScaleStatus> {
  const { floorMeta, spatial } = useStore.getState();
  if (spatial === null) return Promise.resolve({ status: 'resolved' });
  if (memo?.projectId === projectId && memo.spatial === spatial && memo.read === readScale) return memo.status;
  const read = readScale ?? defaultReadScale(projectId);
  memo = { projectId, spatial, read: readScale, status: readScaleStatus(spatial, read, floorMeta) };
  return memo.status;
}

/** Chạy một lần mỗi dự án, khi kho đã có cảnh (cầu nạp xong). */
export function useScaleStatus(projectId: string, readScale?: ReadScale): ScaleStatus {
  const loaded = useStore((state) => state.spatial !== null);
  const [status, setStatus] = useState<ScaleStatus>({ status: 'unknown' });

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void scaleStatusOf(projectId, readScale).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, projectId, readScale]);

  return status;
}
