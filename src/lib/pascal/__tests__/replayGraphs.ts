/**
 * Đồ thị cảnh thật từ sổ chụp vòng 18 (23 căn của bộ chấm `sceneFurnish`, #73) — chỉ có trên máy dev
 * (`F:/runs/m18/shots/<căn>/<SHA>-VB/<căn>.json`; đổi gốc bằng `REPLAY_SHOTS`). Sổ chụp ghi đồ SAU sửa cảnh kèm
 * `repair.before`, nên món đã sửa được trả về chỗ gốc: luật sửa cảnh có việc thật để làm. Cách đổi giống bộ phát lại
 * `F:/runs/m18/LT1/zzLayoutReplay.local.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';

import type { SpatialGraph } from '@/domain/spatial/types';

export const REPLAY_FLATS = [
  'cn13', 'cn14', 'cn15', 'cn16', 'cn17', 'cn18', 'cn19', 'cn20', 'cn21', 'cn22', 'nt02t', 'nt03t',
  'm17sa', 'm17sb', 'm17sc', 'f22', 'f28', 'ch12', 'ch08', 'ch05', 'ch02', 'f14f', 'ch14',
] as const;

const ROOT = process.env.REPLAY_SHOTS ?? 'F:/runs/m18/shots';
const SHA = process.env.REPLAY_SHA ?? 'b7e0a6370';
const fileOf = (flat: string): string => `${ROOT}/${flat}/${SHA}-VB/${flat}.json`;

export const replayAvailable = (): boolean => REPLAY_FLATS.every((flat) => existsSync(fileOf(flat)));

const strip = (s: string): string => s.replace(/^(zone|level|wall|door|window|item)_/, '');
const AI = { source: 'ai', reviewed: false, confidence: 1 };
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const replayGraph = (flat: string): SpatialGraph => {
  const d = JSON.parse(readFileSync(fileOf(flat), 'utf8')) as J;
  const levels = new Set<string>();
  for (const r of d.rooms) levels.add(strip(r.levelId));
  for (const w of d.walls) levels.add(strip(w.parentId));
  const walls = d.walls.map((w: J) => ({
    ...AI,
    id: strip(w.id),
    levelId: strip(w.parentId),
    centreline: { start: { x: w.start[0] * 1000, y: w.start[1] * 1000 }, end: { x: w.end[0] * 1000, y: w.end[1] * 1000 } },
    thicknessMm: w.thickness * 1000,
    heightMm: w.height * 1000,
    kind: 'partition',
    openingIds: d.openings.filter((o: J) => o.wallId === w.id).map((o: J) => strip(o.id)),
  }));
  const openings = d.openings.map((o: J) => {
    const h = (o.node?.height ?? 2.1) * 1000;
    return {
      ...AI,
      id: strip(o.id),
      wallId: strip(o.wallId),
      kind: o.type,
      offsetMm: (o.position[0] - o.width / 2) * 1000,
      widthMm: o.width * 1000,
      heightMm: h,
      sillHeightMm: Math.max(0, o.position[1] * 1000 - h / 2),
      swing: o.node?.metadata?.appfront?.fields?.swing ?? 'left',
    };
  });
  const rooms = d.rooms.map((r: J) => ({
    ...AI,
    id: strip(r.id),
    levelId: strip(r.levelId),
    name: r.name,
    usage: r.usage,
    outline: r.polygon.map(([x = 0, y = 0]: number[]) => ({ x: x * 1000, y: y * 1000 })),
    areaM2: 1,
    wallIds: [],
  }));
  const furniture: J[] = [];
  for (const [nid, n] of Object.entries(d.nodes as Record<string, J>)) {
    const a = n.metadata?.appfront;
    const f = a?.fields;
    if (!nid.startsWith('item_F-') || f?.kind === undefined || f.boundingBox === undefined) continue;
    const { repair, ...rest } = f;
    let bb = f.boundingBox;
    let rotationDeg = ((f.rotationDeg as number) ?? 0) % 360;
    // Trả món đã sửa cảnh về chỗ gốc (dịch hộp theo tâm; `fit` ghi cả hộp gốc).
    if (repair?.before?.centre !== undefined && repair.after?.centre !== undefined) {
      const dx = repair.before.centre.x - repair.after.centre.x;
      const dy = repair.before.centre.y - repair.after.centre.y;
      bb = repair.before.boundingBox ?? { min: { x: bb.min.x + dx, y: bb.min.y + dy }, max: { x: bb.max.x + dx, y: bb.max.y + dy } };
      rotationDeg = (repair.before.rotationDeg ?? rotationDeg) % 360;
    }
    furniture.push({
      ...rest,
      ...(repair?.before?.roomId === undefined ? {} : { roomId: repair.before.roomId }),
      boundingBox: bb,
      rotationDeg,
      id: strip(nid),
      levelId: strip(n.parentId ?? ''),
      centre: { x: Math.round((bb.min.x + bb.max.x) / 2), y: Math.round((bb.min.y + bb.max.y) / 2) },
      source: a.source,
      reviewed: a.reviewed,
      confidence: a.confidence,
    });
  }
  return {
    building: { ...AI, name: 'b', datumElevationMm: 0 },
    levels: [...levels].map((id, i) => ({ ...AI, id, name: id, order: i, elevationMm: 0, heightMm: 3000 })),
    walls,
    openings,
    furniture,
    rooms,
    axes: [],
    dimensions: [],
    notes: [],
  } as unknown as SpatialGraph;
};
