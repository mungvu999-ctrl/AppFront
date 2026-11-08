/**
 * Khối "GLB dựng trên máy chủ" (M1-01, hợp đồng §9). View thuần: mọi chữ số và trạng thái đến
 * từ {@link ServerGlbExportView} (`useServerGlbExport`). Không nút lưu (A7) — nút "Xuất .glb" ở
 * chân trang khởi động lượt dựng.
 */
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

import {
  GLB_ENGINE_LABELS,
  SERVER_GLB_DISCLAIMER,
  SERVER_GLB_SCOPE_NOTE,
  type GlbEngine,
  type ServerGlbExportView,
} from './useServerGlbExport';

const ENGINE_OPTIONS: { label: string; value: GlbEngine }[] = [
  { label: GLB_ENGINE_LABELS.server, value: 'server' },
  { label: GLB_ENGINE_LABELS.quick, value: 'quick' },
];

// A5: xanh `verified` chỉ cho việc người duyệt; kết quả máy dựng "Sẵn sàng" dùng `neutral`.
const TONE_TO_BADGE = { ok: 'neutral', attention: 'attention', violation: 'violation' } as const;

export function ServerGlbExportSection({ view }: { readonly view: ServerGlbExportView }) {
  const { result } = view;
  return (
    <section aria-label="Cách dựng GLB" className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-4">
      <SegmentedControl
        aria-label="Cách dựng GLB"
        options={ENGINE_OPTIONS}
        value={view.engine}
        onChange={view.onSelectEngine}
      />
      {view.engine === 'server' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-text-primary">{SERVER_GLB_SCOPE_NOTE}</p>
          <p className="text-[13px] text-text-secondary">{SERVER_GLB_DISCLAIMER}</p>
          {view.progressLabel !== null && (
            <p role="status" className="text-text-primary">
              {view.progressLabel}
            </p>
          )}
          {view.errorMessage !== null && <InlineAlert level="violation" message={view.errorMessage} />}
          {view.staleNote !== null && <InlineAlert level="attention" message={view.staleNote} />}
          {view.snapshotLine !== null && <p className="text-[13px] text-text-secondary">{view.snapshotLine}</p>}
          {result !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span>Chất lượng:</span>
                <Badge variant={TONE_TO_BADGE[result.qualityTone]}>{result.qualityLabel}</Badge>
                {result.glbSizeLabel !== null && <span className="text-text-secondary">{result.glbSizeLabel}</span>}
              </div>
              {result.issues.length > 0 && (
                <ul aria-label="Thiếu sót" className="flex flex-col gap-1">
                  {result.issues.map((issue) => (
                    <li key={issue.key} className="flex gap-2">
                      <span className="min-w-0 flex-1">{issue.reason}</span>
                      <span className="text-text-secondary">{issue.countLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {result.canDownloadGlb && (
                  <Button size="sm" onClick={() => view.onDownload('model.glb')}>
                    Tải model.glb
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => view.onDownload('report.json')}>
                  Tải report.json
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
