/**
 * K-23 — Ảnh và OBJ không xuất được ngay trong màn Xuất (không có khung nhìn 3D sống ở đây), nên
 * mỗi cái là một lối sang trình xem 3D, đúng nút cần bấm. Không có thẻ xám: thiếu thì có lối đi
 * hoặc một dòng nói thật là chưa có (R-69).
 */
import { cn } from '@/lib/utils';

import type { EditorExportTarget } from './types';

interface ViewerLinkProps {
  readonly label: string;
  readonly hint: string;
  readonly onClick: () => void;
  readonly ringClassName: string;
}

function ViewerLink({ label, hint, onClick, ringClassName }: ViewerLinkProps) {
  return (
    <li className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={onClick}
        className={cn('rounded-sm min-h-6 coarse:min-h-11 text-[13px] font-medium text-accent hover:underline', ringClassName)}
      >
        {label}
      </button>
      <span className="text-xs text-text-secondary">{hint}</span>
    </li>
  );
}

export interface ExportPanelViewerLinksProps {
  /** `false` khi thẻ Ảnh là thẻ thật (có khung nhìn để chụp): khi đó không cần lối sang trình xem cho ảnh. */
  readonly showImage: boolean;
  readonly onOpenEditor: (target: EditorExportTarget) => void;
  /** Vòng focus của thư mục, truyền xuống để khỏi nhập vòng với `ExportPanelFormats`. */
  readonly ringClassName: string;
}

export function ExportPanelViewerLinks({ showImage, onOpenEditor, ringClassName }: ExportPanelViewerLinksProps) {
  return (
    <section aria-label="Ảnh và OBJ" className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-surface p-4">
      <h3 className="text-sm font-medium text-text-primary">Ảnh và OBJ: làm trong trình xem 3D</h3>
      <ul className="flex flex-col gap-2">
        {showImage && (
          <ViewerLink
            label="Mở trình xem 3D để chụp ảnh"
            hint="Chọn góc nhìn rồi bấm Ảnh để tải PNG."
            onClick={() => {
              onOpenEditor('snapshot');
            }}
            ringClassName={ringClassName}
          />
        )}
        <ViewerLink
          label="Mở trình xem 3D để xuất OBJ"
          hint="Nút Xuất OBJ nằm trong tab Cài đặt. OBJ chỉ có hình khối, không có vật liệu."
          onClick={() => {
            onOpenEditor('settings');
          }}
          ringClassName={ringClassName}
        />
      </ul>
      <p className="text-xs text-text-secondary">IFC và DXF: dự án chưa có bộ xuất cho hai định dạng này.</p>
    </section>
  );
}
