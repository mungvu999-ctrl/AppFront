import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';

const COLLAPSE_LABEL = 'Thu gọn hai panel';
const EXPAND_LABEL = 'Mở lại hai panel';
const COLLAPSE_SHORT_LABEL = 'Thu gọn';
const EXPAND_SHORT_LABEL = 'Mở panel';

/** Nút thu gọn / mở lại hai panel, cuối ray công cụ, cùng một chỗ ở các bước duyệt (BT-16). */
export function QcRailCollapse({ isCollapsed, onToggle }: { readonly isCollapsed: boolean; readonly onToggle: () => void }) {
  const label = isCollapsed ? EXPAND_LABEL : COLLAPSE_LABEL;
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="relative mt-1 flex w-full flex-col items-center gap-0.5">
      <Tooltip label={label}>
        <IconButton
          aria-label={label}
          icon={<Icon aria-hidden="true" className="h-[18px] w-[18px]" />}
          onClick={onToggle}
          size="lg"
          tooltip={false}
        />
      </Tooltip>
      <span aria-hidden="true" className="w-full px-1 text-center text-[11px] leading-tight text-text-muted">{isCollapsed ? EXPAND_SHORT_LABEL : COLLAPSE_SHORT_LABEL}</span>
    </div>
  );
}
