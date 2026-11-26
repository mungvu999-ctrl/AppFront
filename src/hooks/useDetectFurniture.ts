/**
 * QT-FURN-TOGGLE — thiết lập dự án "Nhận diện đồ đạc" (`detectFurniture` của N5/N6).
 *
 * Bật (mặc định của BE từ BENCH3D-FURN-ON) thì dựng cả đồ đạc AI; tắt thì lượt xử lý chỉ dựng tường, cửa và phòng.
 * Đổi chỉ có hiệu lực từ lượt xử lý sau. Ghi = đọc N5 mới nhất rồi PUT đủ thân kèm `detectFurniture`,
 * cùng khuôn `useSeparateUnits`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectSettingsBody } from '@/api/schemas/projectSettings';
import { queryKeys } from '@/lib/query/queryKeys';

import { loadSeparateUnitsClient, type SeparateUnitsApi } from './useSeparateUnitsFlag';

export const DETECT_FURNITURE_SAVE_ERROR = 'Chưa lưu được thiết lập nhận diện đồ đạc. Thử lại sau.';

export const detectFurnitureQueryKey = (projectId: string) =>
  [...queryKeys.project.detail(projectId), 'settings', 'detectFurniture'] as const;

export interface DetectFurnitureState {
  /** `false` khi đang tải, đọc hỏng hoặc dự án chưa lưu lần nào (mặc định của BE). */
  readonly detectFurniture: boolean;
  readonly isSaving: boolean;
  readonly saveError: string | null;
  readonly setDetectFurniture: (next: boolean) => void;
}

export function useDetectFurniture(projectId: string, api?: SeparateUnitsApi): DetectFurnitureState {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: detectFurnitureQueryKey(projectId),
    enabled: projectId !== '',
    queryFn: async () => {
      const result = await (await loadSeparateUnitsClient(api)).projectSettings.read({ projectId });
      if (!result.ok) throw new Error('project settings unavailable');
      return result.data.detectFurniture !== false;
    },
  });
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const client = await loadSeparateUnitsClient(api);
      const current = await client.projectSettings.read({ projectId });
      if (!current.ok) throw new Error('project settings unavailable');
      const { revision, ...settings } = current.data;
      const body: ProjectSettingsBody = { ...settings, detectFurniture: next };
      const saved = await client.projectSettings.replace({ projectId, baseVersion: revision, body });
      if (!saved.ok) throw new Error('project settings not saved');
      return saved.data.detectFurniture === true;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(detectFurnitureQueryKey(projectId), saved);
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.project.detail(projectId), 'settings'] });
    },
  });

  return {
    detectFurniture: (mutation.isPending ? mutation.variables : undefined) ?? data ?? true,
    isSaving: mutation.isPending,
    saveError: mutation.isError ? DETECT_FURNITURE_SAVE_ERROR : null,
    setDetectFurniture: (next) => mutation.mutate(next),
  };
}
