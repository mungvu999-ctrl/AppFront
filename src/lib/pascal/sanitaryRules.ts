/**
 * Luật thiết bị vệ sinh (chỉ báo, không dời/xoá đồ), chung cho mọi dự án:
 * - `roomMismatch`: bồn cầu/lavabo/sen/bồn tắm có tâm trong phòng ngủ, phòng khách hay bếp
 *   (bếp: lavabo không tính — chậu rửa bếp dò được cũng là `sanitaryFixture`).
 * - `duplicateFixture`: một phòng có ≥ 2 bồn cầu hoặc ≥ 2 bồn tắm.
 * - `facing`: bồn cầu và lavabo cùng phòng quay mặt vào nhau (±30°) và tâm cách nhau ≤ 1500 mm.
 * Công năng phòng: `furnishingUsageOf` (usage đã lưu, `other` thì đoán theo tên). Vai trò thiết bị:
 * `roleOf` (variant, không có thì theo cỡ). Đồ AI góc 0 được quay như cảnh 3D (`orientDetected`)
 * trước khi xét hướng. Tách khỏi `placement.ts` vì `sceneVariety` đã nhập `placement` (vòng import).
 */

import { outlineContains } from '@/domain/rooms/area';
import type { Furniture, Room, RoomUsage, SpatialGraph } from '@/domain/spatial/types';
import { toPointMm } from '@/lib/commands/business/shared';

import { orientDetectedFurniture } from './orientDetected';
import type { PlacementIssue } from './placement';
import { roleOf } from './sceneVariety';
import { furnishingUsageOf } from './structureFixes';

/** Hai thiết bị quay mặt vào nhau khi mỗi mặt trước lệch hướng tới món kia không quá chừng này. */
const FACING_MAX_DEG = 30;
/** Và tâm hai món cách nhau không quá chừng này, mm. */
const FACING_MAX_MM = 1500;

const SANITARY_LABELS = { toilet: 'bồn cầu', basin: 'lavabo', shower: 'khu tắm vòi sen', bathtub: 'bồn tắm' } as const;
type SanitaryRole = keyof typeof SANITARY_LABELS;

const ROOM_LABELS: Partial<Record<RoomUsage, string>> = { bedroom: 'phòng ngủ', livingRoom: 'phòng khách', kitchen: 'bếp' };

const sanitaryRoleOf = (f: Furniture): SanitaryRole | null => {
  if (f.kind !== 'sanitaryFixture' && f.kind !== 'shower') return null;
  // Không truyền công năng phòng: roleOf trong bếp luôn trả chậu rửa bếp, che mất bồn cầu đặt nhầm.
  const role = roleOf(f);
  return role in SANITARY_LABELS ? (role as SanitaryRole) : null;
};

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const frontOf = (f: Furniture): { x: number; y: number } => {
  const t = (f.rotationDeg * Math.PI) / 180;
  return { x: -Math.sin(t), y: Math.cos(t) };
};

/** Mặt trước `f` hướng về tâm `g` lệch không quá FACING_MAX_DEG. */
const looksAt = (f: Furniture, g: Furniture): boolean => {
  const v = { x: g.centre.x - f.centre.x, y: g.centre.y - f.centre.y };
  const len = Math.hypot(v.x, v.y);
  const front = frontOf(f);
  return len > 0 && (front.x * v.x + front.y * v.y) / len >= Math.cos((FACING_MAX_DEG * Math.PI) / 180);
};

export const sanitaryPlacementIssues = (graph: SpatialGraph): PlacementIssue[] => {
  const fixtures = orientDetectedFurniture(
    graph.furniture.filter((f) => f.suggested !== true),
    graph.walls,
  ).flatMap((f) => {
    const role = sanitaryRoleOf(f);
    return role === null ? [] : [{ f, role }];
  });
  const issues: PlacementIssue[] = [];
  for (const room of graph.rooms as readonly Room[]) {
    const outline = room.outline.map(toPointMm);
    const inside = fixtures.filter(
      ({ f }) =>
        f.roomId === room.id ||
        (f.roomId === undefined && f.levelId === room.levelId && outlineContains(outline, toPointMm(f.centre))),
    );
    if (inside.length === 0) continue;
    const usage = furnishingUsageOf(room);
    const roomLabel = ROOM_LABELS[usage];
    if (roomLabel !== undefined) {
      for (const { f, role } of inside) {
        if (usage === 'kitchen' && role === 'basin') continue;
        issues.push({ kind: 'roomMismatch', furnitureIds: [f.id], message: `${capital(SANITARY_LABELS[role])} nằm trong ${roomLabel}` });
      }
    }
    for (const role of ['toilet', 'bathtub'] as const) {
      const same = inside.filter((x) => x.role === role);
      if (same.length >= 2)
        issues.push({
          kind: 'duplicateFixture',
          furnitureIds: same.map((x) => x.f.id),
          message: `${room.name.trim() || 'Phòng tắm'} có ${same.length} ${SANITARY_LABELS[role]}`,
        });
    }
    for (const { f: t } of inside.filter((x) => x.role === 'toilet')) {
      for (const { f: b } of inside.filter((x) => x.role === 'basin')) {
        if (Math.hypot(b.centre.x - t.centre.x, b.centre.y - t.centre.y) <= FACING_MAX_MM && looksAt(t, b) && looksAt(b, t))
          issues.push({ kind: 'facing', furnitureIds: [t.id, b.id], message: 'Bồn cầu đối diện lavabo' });
      }
    }
  }
  return issues;
};
