import type { DesignConceptApi } from '@/api/client';
import type { DesignAddition, DesignConcept, DesignConceptState } from '@/api/schemas/designConcept';
import { getSessionSnapshot } from '@/lib/auth/state';

import { sceneStyleFromConcept } from './designStyles';
import { absenceOf } from './serverLibrary';
import { SCENE_STYLES, type SceneStyle } from './sceneStyles';

/**
 * Concept AI (N47: phong cách + mẫu AI chọn + đồ bổ sung) cho MỌI viewer — editor (`bridge/loadProject`), lịch sử phiên
 * bản, viewer di động — cùng một quy tắc: chờ đúng kết quả (không đua đồng hồ riêng; hết giờ là của client HTTP chung),
 * 403/404 = không có concept (im lặng), lỗi đọc/ném = dự phòng CÓ câu báo, concept chưa `done` = không áp.
 */

/** Đọc concept AI (N47) hỏng: cảnh mở với phong cách cũ + tự bày đồ — báo rõ, không âm thầm. */
export const CONCEPT_FALLBACK_NOTICE = 'Chưa tải được phong cách thiết kế AI, đang hiện phong cách dự phòng. Tải lại trang để thử lại.';

export interface ConceptRead {
  readonly state: DesignConceptState | null;
  /** Kiểu lỗi khi lượt đọc hỏng (không tính 403/404). */
  readonly failure?: string;
}

/** Một lượt đọc N47; không bao giờ ném. */
export const readConcept = async (api: Pick<DesignConceptApi, 'read'>, projectId: string): Promise<ConceptRead> => {
  try {
    const result = await api.read({ projectId });
    if (result.ok) return { state: result.data };
    // 403/404: không được phép / không có concept — như "không có", không báo lỗi tải.
    return absenceOf(result.error) === undefined ? { state: null, failure: result.error.kind } : { state: null };
  } catch {
    return { state: null, failure: 'threw' };
  }
};

/**
 * Đồ bày trong 3D: có concept AI đã xong → AI quyết (không tự bày, chỉ đồ AI bổ sung); không có
 * (Design Director tắt, chưa chạy, đọc lỗi) → tự bày phòng trống làm dự phòng.
 */
export const furnishModeOf = (concept: DesignConcept['result']): 'on' | 'off' => (concept === undefined ? 'on' : 'off');

export interface SceneConcept {
  /** Phong cách của concept đã xong; `undefined` = không có concept, nơi gọi giữ phong cách của mình. */
  readonly style: SceneStyle | undefined;
  readonly additions: readonly DesignAddition[];
  readonly furnish: 'on' | 'off';
  /** `done` | `none` | `fallback:<lý do>`. */
  readonly source: string;
  readonly notice: string | null;
}

/** Kết quả đọc → tuỳ chọn cảnh. Concept đã xong thắng mọi phong cách khác; chưa xong/hỏng → không áp. */
export const sceneConceptOf = ({ state, failure }: ConceptRead): SceneConcept => {
  const concept = state?.active?.status === 'done' ? state.active.result : undefined;
  return {
    style: concept === undefined ? undefined : sceneStyleFromConcept(concept, SCENE_STYLES[concept.baseStyle], state?.active?.styleId),
    additions: concept?.additions ?? [],
    furnish: furnishModeOf(concept),
    source: failure !== undefined ? `fallback:${failure}` : concept === undefined ? 'none' : 'done',
    notice: failure !== undefined ? CONCEPT_FALLBACK_NOTICE : null,
  };
};

/** Tuỳ chọn `standardSceneOf` từ concept — cùng hình với `sceneOptions` của bridge. */
export const conceptSceneOptions = (
  concept: SceneConcept,
  fallbackStyle?: SceneStyle,
): { style?: SceneStyle; furnish: 'on' | 'off'; additions?: readonly DesignAddition[] } => {
  const style = concept.style ?? fallbackStyle;
  return {
    ...(style === undefined ? {} : { style }),
    furnish: concept.furnish,
    ...(concept.additions.length === 0 ? {} : { additions: concept.additions }),
  };
};

/** Trả client concept khi có phiên, `null` khi chưa có phiên. */
export type ConceptApiSource = () => Promise<Pick<DesignConceptApi, 'read'> | null>;

const defaultApi: ConceptApiSource = async () => {
  const [{ createAppApiClient }, { startAppSession }] = await Promise.all([
    import('@/api/appClient'),
    import('@/routes/sessionSetup'),
  ]);
  // `startAppSession` nhớ cả `false` của lượt chưa đăng nhập: đọc trạng thái phiên thật (đăng nhập sau, cùng thẻ).
  await startAppSession().catch(() => false);
  return getSessionSnapshot().status === 'authenticated' ? createAppApiClient().designConcept : null;
};

/**
 * Concept của dự án cho viewer ngoài editor. Mỗi lượt gọi đọc mới (concept đổi được trong phiên — không nhớ qua dự án);
 * nơi gọi tự bỏ kết quả khi đã đổi dự án/phiên bản (`cancelled`). Chưa có phiên = không có concept. Không ném.
 */
export const loadSceneConcept = async (projectId: string, getApi: ConceptApiSource = defaultApi): Promise<SceneConcept> => {
  const api = await getApi().catch(() => null);
  return sceneConceptOf(api === null ? { state: null } : await readConcept(api, projectId));
};
