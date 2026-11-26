/**
 * Mâu thuẫn giữa các nguồn và luật kiểm của khối "Ngôi nhà" (NHA-08b) — VIEW THUẦN.
 *
 * Mỗi mâu thuẫn là một nhóm chọn một có nhãn: người duyệt chọn nguồn đúng. Mỗi cảnh báo có nút "Đã xem"; lỗi
 * phải sửa ở bảng tầng hoặc thẻ mái, gợi ý chỉ để đọc.
 */

import { useId } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import type { HouseConflict, HouseViolationGroup } from '@/lib/viewmodel/setBuilding';
import type { HouseActions } from '@/lib/viewmodel/setBuildingDecisions';

const SEEN = 'Đã xem';
const BODY = 'text-[14px] text-text-secondary';

export function HouseConflictGroup({
  actions,
  conflict,
}: {
  actions: HouseActions;
  conflict: HouseConflict;
}) {
  const titleId = useId();

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[14px] text-text-primary" id={titleId}>
        {conflict.title}
      </p>
      <Radio.Group
        aria-labelledby={titleId}
        onChange={(value) => {
          const picked = conflict.candidates.find((candidate) => candidate.source === value);

          if (picked !== undefined) actions.pick(conflict.key, picked.source);
        }}
        value={conflict.candidates.find((candidate) => candidate.isChosen)?.source ?? ''}
      >
        {conflict.candidates.map((candidate) => (
          <Radio.Item
            key={candidate.source}
            label={`${candidate.text} · ${candidate.chip}`}
            value={candidate.source}
          />
        ))}
      </Radio.Group>
    </div>
  );
}

export function HouseViolationList({
  actions,
  group,
}: {
  actions: HouseActions;
  group: HouseViolationGroup;
}) {
  const titleId = useId();

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Badge id={titleId} variant={group.status}>
          {group.title}
        </Badge>
      </div>
      <ul aria-labelledby={titleId} className={`flex list-disc flex-col gap-1 pl-5 ${BODY}`}>
        {group.items.map((item) => (
          <li key={item.key} tabIndex={-1}>
            <span className="inline-flex flex-wrap items-center gap-2">
              {item.text}
              {group.level !== 'warning' ? null : item.isSeen ? (
                <Badge variant="verified">{SEEN}</Badge>
              ) : (
                <Button
                  aria-label={`${SEEN}: ${item.text}`}
                  onClick={(event) => {
                    actions.markSeen(item.key);
                    // Nút sắp đổi thành nhãn "Đã xem": giữ tiêu điểm ở dòng này cho người dùng bàn phím.
                    event.currentTarget.closest<HTMLLIElement>('li')?.focus();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {SEEN}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
