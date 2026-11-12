/**
 * Codex M17-4 — toPascal dựng theo quyết định của bộ chọn: #1 áp lưng tường cỡ thật theo VAI HIỆU LỰC của bộ chọn
 * (`roomSetRoleOf`), không vai gốc; #2 bộ chọn từ chối rõ (`to: null`) ở vai ngữ cảnh → khung giữ chỗ, không mẫu vai gốc.
 * Bàn AI 0,4 × 0,4 m phòng ngủ, không giường: vai gốc nightstand (tựa tường), vai ngữ cảnh coffeeTable.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import type { PascalItemNode } from '../types';

const TABLE = 'F-0000ROLE17T';
/** Giả lập sổ bộ chọn cho riêng bàn: `real` = dựng cỡ thật vai coffeeTable; `rejected` = từ chối mọi mẫu. */
const SEL = vi.hoisted(() => ({ real: false, rejected: false, hidden: false, hideDress: false }));
vi.mock('../sceneVariety', async (importOriginal) => {
  interface Real {
    roomSetUniformOf: (id: string, folder: string) => boolean | 'real';
    roomSetRoleOf: (id: string) => string | undefined;
    roomSetRejectedOf: (id: string) => boolean;
    roomSetHiddenOf: (id: string) => boolean;
    modelFolderOf: (f: { id: string }, ...rest: unknown[]) => string | null;
  }
  const real = await importOriginal<Real>();
  const mine = (id: string) => id === 'F-0000ROLE17T';
  return {
    ...real,
    roomSetUniformOf: (id: string, folder: string) => (SEL.real && mine(id) ? 'real' : real.roomSetUniformOf(id, folder)),
    roomSetRoleOf: (id: string) => (SEL.real && mine(id) ? 'coffeeTable' : real.roomSetRoleOf(id)),
    roomSetRejectedOf: (id: string) => (SEL.rejected && mine(id)) || real.roomSetRejectedOf(id),
    roomSetHiddenOf: (id: string) => (SEL.hidden && mine(id)) || (SEL.hideDress && id.startsWith('DRESS-')) || real.roomSetHiddenOf(id),
    // Vai ngữ cảnh (`roleOverride`) của bàn: bộ chọn trả null. Đường mẫu vai gốc (không roleOverride) giữ thật.
    modelFolderOf: (f: { id: string }, ...rest: unknown[]) => (SEL.rejected && mine(f.id) && rest[2] !== undefined ? null : real.modelFolderOf(f, ...rest)),
  };
});

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const ROOM = 'R-0000ROLE17R';
const LVL = 'L-0000ROLE17L';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const graph = (): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-000ROLE17W${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng ngủ', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room],
    furniture: [
      {
        source: 'ai',
        reviewed: false,
        confidence: 0.8,
        id: TABLE,
        levelId: LVL,
        roomId: ROOM,
        kind: 'table',
        centre: { x: 2500, y: 2000 },
        boundingBox: { min: { x: 2300, y: 1800 }, max: { x: 2700, y: 2200 } },
        rotationDeg: 0,
      } as unknown as Furniture,
    ],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;
const style: LayerStyle = { ...sceneStyleOf(undefined), roomSet: false, layout: new Set() };
const tableNode = (): PascalItemNode => standardSceneOf(graph(), { style }).scene.nodes[`item_${TABLE}`] as PascalItemNode;

describe('Codex M17-4', () => {
  it('tiền đề: không sổ bộ chọn → bàn dựng mẫu vai ngữ cảnh (bàn trà), không phải tủ đầu giường', () => {
    expect(tableNode().asset.src).not.toMatch(/bedside-table/);
  });

  it('#1: món cỡ thật áp lưng theo vai hiệu lực của bộ chọn (coffeeTable không tựa tường), không vai gốc nightstand', () => {
    SEL.real = true;
    try {
      const n = tableNode();
      const fit = n.metadata?.appfront?.fields?.['realFit'] as { folder: string } | undefined;
      expect(fit?.folder, 'dựng cỡ thật').toBeDefined();
      // Mẫu sâu hơn hộp 0,4 m: vai nightstand (tựa tường) sẽ áp lưng ≠ 0.
      expect(n.metadata?.appfront?.fields?.['realBackShiftM']).toBeUndefined();
    } finally {
      SEL.real = false;
    }
  });

  it('#2: bộ chọn từ chối rõ (to: null) ở vai ngữ cảnh → khung giữ chỗ, không mẫu vai gốc (bedside-table)', () => {
    SEL.rejected = true;
    try {
      expect(tableNode().asset.src).toBe('asset://appfront/table');
      expect(tableNode().visible).not.toBe(false);
    } finally {
      SEL.rejected = false;
    }
  });

  it('món chưa xác nhận bị từ chối mọi mẫu → node ẩn (visible false), vẫn có node để lượt lưu không xoá', () => {
    SEL.rejected = true;
    SEL.hidden = true;
    try {
      const n = tableNode();
      expect(n).toBeDefined();
      expect(n.visible).toBe(false);
    } finally {
      SEL.rejected = false;
      SEL.hidden = false;
    }
  });

  it('đồ SINH bị từ chối mọi mẫu cũng ẩn (vòng lặp đồ sinh) — Codex M17-6 #1', () => {
    SEL.hideDress = true;
    try {
      const scene = standardSceneOf(graph(), { style }).scene;
      const dress = Object.values(scene.nodes).filter((n) => n.type === 'item' && n.id.startsWith('item_DRESS-'));
      expect(dress.length, 'phòng ngủ trống có đồ sinh').toBeGreaterThan(0);
      for (const n of dress) expect(n.visible, n.id).toBe(false);
    } finally {
      SEL.hideDress = false;
    }
  });
});
