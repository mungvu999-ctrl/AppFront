/**
 * Nướng ánh sáng (C3): xuất GLB của cảnh đang sửa, gửi N42, hỏi N43 mỗi 5 s khi còn chờ/đang nướng,
 * và khi xong nạp ba tệp N44 (Blob → URL `blob:`) vào xem thử của `./realism/bakedPreview`.
 *
 * Không nhập `@pascal-app/*` (vitest không nạp được gói chưa dựng): `main.tsx` truyền `exportGlb`.
 */
import { useCallback, useEffect, useState } from 'react';

import type { ApiClient } from '@/api/client';
import type { LightingBake } from '@/api/schemas/lightingBake';

import { hideBakedPreview, showBakedPreview, type BakedManifest } from './realism/bakedPreview';

export const BAKE_POLL_MS = 5000;

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  LIGHTING_BAKE_TIMEOUT: 'quá thời gian cho phép',
  LIGHTING_BAKE_OUTPUT_INVALID: 'kết quả nướng không hợp lệ',
  LIGHTING_BAKE_STALLED: 'máy nướng ngừng phản hồi',
};

/** Câu trạng thái cho người đọc; `null` khi dự án chưa nướng lần nào. */
export function bakeStatusLabel(bake: LightingBake | null): string | null {
  if (bake === null) return null;
  if (bake.status === 'queued') return 'Đang chờ nướng…';
  if (bake.status === 'running') return 'Đang nướng ánh sáng…';
  if (bake.status === 'done') return 'Đã nướng xong';
  return `Nướng lỗi: ${FAILURE_TEXT[bake.failureCode ?? ''] ?? 'không nướng được'}`;
}

export const isBakeActive = (bake: LightingBake | null): boolean =>
  bake !== null && (bake.status === 'queued' || bake.status === 'running');

let clientPromise: Promise<ApiClient> | null = null;
const defaultClient = (): Promise<ApiClient> =>
  (clientPromise ??= import('@/api/appClient').then((m) => m.createAppApiClient()));

export interface LightingBakeState {
  /** `true` chỉ khi API báo bật; lỗi, 404 hay API cũ chưa có N49 đều là `false`. */
  available: boolean;
  bake: LightingBake | null;
  busy: boolean;
  error: string | null;
  previewing: boolean;
  start: () => void;
  view: () => void;
  hide: () => void;
}

export function useLightingBake(
  projectId: string,
  exportGlb: () => Promise<Blob | null>,
  loadClient: () => Promise<ApiClient> = defaultClient,
): LightingBakeState {
  const [bake, setBake] = useState<LightingBake | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let live = true;
    void loadClient()
      .then((client) => client.lightingBakes.readAvailability(projectId))
      .then((result) => live && setAvailable(result.ok && result.data.enabled === true))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [loadClient, projectId]);

  const refresh = useCallback(async () => {
    const result = await (await loadClient()).lightingBakes.readLatest(projectId);
    if (result.ok) setBake(result.data);
  }, [loadClient, projectId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const active = isBakeActive(bake);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => void refresh().catch(() => undefined), BAKE_POLL_MS);
    return () => clearTimeout(timer);
  }, [active, bake, refresh]);

  useEffect(() => hideBakedPreview, []);

  const start = useCallback(() => {
    // Cảnh nướng đang hiện thì gỡ trước, để bộ xuất chỉ thấy cảnh sống.
    hideBakedPreview();
    setPreviewing(false);
    setBusy(true);
    setError(null);
    void (async () => {
      const glb = await exportGlb();
      if (glb === null) {
        setError('Không xuất được mô hình để nướng.');
        return;
      }
      const client = await loadClient();
      const result = await client.lightingBakes.start(projectId, glb);
      if (result.ok) setBake(result.data);
      else if ('code' in result.error && result.error.code === 'LIGHTING_BAKE_IN_PROGRESS') await refresh();
      else setError('Không gửi được mô hình để nướng.');
    })()
      .catch(() => setError('Không gửi được mô hình để nướng.'))
      .finally(() => setBusy(false));
  }, [exportGlb, loadClient, projectId, refresh]);

  const view = useCallback(() => {
    if (bake?.status !== 'done') return;
    setBusy(true);
    setError(null);
    const urls: string[] = [];
    void (async () => {
      const client = await loadClient();
      const files = await Promise.all(
        (['baked.glb', 'lightmap.png', 'manifest.json'] as const).map((name) =>
          client.lightingBakes.readFile(projectId, bake.id, name),
        ),
      );
      const blobs = files.map((file) => (file.ok ? file.data : null));
      const [glb, lightmap, manifestBlob] = blobs;
      if (!glb || !lightmap || !manifestBlob) throw new Error('missing bake file');
      const manifest = JSON.parse(await manifestBlob.text()) as BakedManifest;
      const glbUrl = URL.createObjectURL(glb);
      const lightmapUrl = URL.createObjectURL(lightmap);
      urls.push(glbUrl, lightmapUrl);
      await showBakedPreview({ glbUrl, lightmapUrl, manifest });
      setPreviewing(true);
    })()
      .catch(() => setError('Không nạp được ánh sáng nướng.'))
      .finally(() => {
        for (const url of urls) URL.revokeObjectURL(url);
        setBusy(false);
      });
  }, [bake, loadClient, projectId]);

  const hide = useCallback(() => {
    hideBakedPreview();
    setPreviewing(false);
  }, []);

  return { available, bake, busy, error, previewing, start, view, hide };
}
