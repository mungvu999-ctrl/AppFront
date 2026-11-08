/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { SuggestionSchema, type Suggestion } from '@/api/schemas/suggestions';
import { CH04, goldenGraphOf, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { adoptedFurnitureOf, adoptionsOf } from '@/lib/suggestions/state';

import { toPascalId } from '../ids';
import { toPascalScene } from '../toPascal';
import { toSpatialGraph } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalWallNode, PascalWindowNode } from '../types';

/**
 * M2 — editor vẽ lớp đề xuất ĐÃ LƯU (hợp đồng §5, §6): vẽ bản lưu, tắt, nhận nuôi tạo `origin`, `stale` không vẽ.
 * Dữ liệu là ca vàng `ch-04` của AppBack (R1 len, R4 lan can, C2 khung cánh, F1 chọn mẫu, L1 đèn trần).
 */

const GRAPH = goldenGraphOf(CH04);
const STORED = storedSuggestionsOf(CH04);
const sceneOf = (suggestions?: readonly Suggestion[]) => toPascalScene(GRAPH, suggestions === undefined ? {} : { suggestions }).scene.nodes;
const BASE = sceneOf();
const SAVED = sceneOf(STORED);

const first = <K extends Suggestion['kind']>(kind: K) => STORED.find((s) => s.kind === kind) as Extract<Suggestion, { kind: K }>;
const replaced = (target: Suggestion, patch: Partial<Suggestion>) =>
  STORED.map((s) => (s.id === target.id ? SuggestionSchema.parse({ ...s, ...patch }) : s));
const node = <T extends PascalNode>(nodes: Record<string, PascalNode>, id: string) => nodes[id] as T | undefined;

const ITEM = SuggestionSchema.parse({
  id: 'DRESS-P1-R-03H62A4X025JVXK323QKP5BAE-bed',
  rule: 'P1',
  ruleVersion: 1,
  kind: 'item',
  hostRef: { room: 'R-03H62A4X025JVXK323QKP5BAE' },
  params: { furnitureKind: 'bed', modelId: 'bed-sf', centre: { x: 7495, y: 3061 }, sizeMm: [1800, 2000, 900], rotationDeg: 90 },
  state: 'active',
  createdRevision: 1,
}) as Extract<Suggestion, { kind: 'item' }>;

describe('M2 — vẽ lớp đề xuất đã lưu (toPascal)', () => {
  it('không có bản ghi → cảnh y như trước M2', () => {
    expect(sceneOf([])).toEqual(BASE);
  });

  it('R1: len tường theo bản ghi; điều chỉnh cao thắng; tắt → không len trong nhà', () => {
    const r1 = first('skirting');
    const wallId = toPascalId('wall', r1.hostRef.wall!);
    expect(node<PascalWallNode>(SAVED, wallId)?.skirting).toMatchObject({ enabled: true, height: 0.09, proud: 0.012 });

    const tall = sceneOf(replaced(r1, { state: 'overridden', override: { heightMm: 120 } }));
    expect(node<PascalWallNode>(tall, wallId)?.skirting?.height).toBe(0.12);

    const others = STORED.filter((s) => s.kind === 'skirting' && s.hostRef.wall === r1.hostRef.wall && s.id !== r1.id);
    const off = sceneOf(STORED.map((s) => (s.id === r1.id || others.includes(s) ? SuggestionSchema.parse({ ...s, state: 'disabled' }) : s)));
    const skirting = node<PascalWallNode>(off, wallId)?.skirting;
    expect(skirting?.enabled === false || skirting?.sides === 'exterior').toBe(true);
  });

  it('C2: khung cánh cửa sổ 40 × 45 mm', () => {
    const c2 = first('sash');
    expect(node<PascalWindowNode>(SAVED, toPascalId('window', c2.hostRef.opening!))).toMatchObject({ frameThickness: 0.04, frameDepth: 0.045 });
    expect(node<PascalWindowNode>(BASE, toPascalId('window', c2.hostRef.opening!))?.frameThickness).toBeUndefined();
  });

  it('F1: món chủ chưa có mẫu đổi sang mẫu luật chọn; tắt thì về mẫu cũ', () => {
    const f1 = STORED.find((s) => s.kind === 'modelPick' && s.params.modelId === 'toilet-sf')!;
    const id = toPascalId('item', f1.hostRef.furniture!);
    expect(node<PascalItemNode>(SAVED, id)?.asset.src).toContain('toilet-sf');
    const off = sceneOf(replaced(f1, { state: 'disabled' }));
    expect(node<PascalItemNode>(off, id)?.asset.src).toBe(node<PascalItemNode>(BASE, id)?.asset.src);
  });

  it('L1: đèn trần đặt ở tâm máy chủ; tắt hay cũ thì không có đèn', () => {
    const l1 = first('ceilingLight');
    const lightId = toPascalId('item', `LIGHT-${l1.hostRef.room!}`);
    const light = node<PascalItemNode>(SAVED, lightId);
    expect(light?.position[0]).toBeCloseTo(l1.params.centre.x / 1000, 6);
    expect(light?.position[2]).toBeCloseTo(l1.params.centre.y / 1000, 6);
    expect(node(sceneOf(replaced(l1, { state: 'disabled' })), lightId)).toBeUndefined();
    expect(node(sceneOf(replaced(l1, { stale: { since: 3, reasonVi: 'phòng đã bị xoá' } })), lightId)).toBeUndefined();
  });

  it('R4: lan can lô gia theo đoạn đã lưu, id là id đề xuất; tắt thì không tự dò lại', () => {
    const r4 = first('railing');
    const id = toPascalId('item', r4.id);
    expect(node<PascalItemNode>(SAVED, id)?.metadata?.generated).toBe('part');
    const off = sceneOf(STORED.map((s) => (s.kind === 'railing' ? SuggestionSchema.parse({ ...s, state: 'disabled' }) : s)));
    expect(node(off, id)).toBeUndefined();
    const auto = Object.keys(off).filter((key) => key.includes(`DRESS-railing-${r4.hostRef.room!}`));
    expect(auto).toEqual([]);
  });

  it('item: đồ ảo `DRESS-` qua đường generated:dressing; stale/disabled/adopted không vẽ', () => {
    const id = toPascalId('item', ITEM.id);
    const drawn = node<PascalItemNode>(sceneOf([...STORED, ITEM]), id);
    expect(drawn?.metadata?.generated).toBe('dressing');
    expect(drawn?.asset.src).toContain('bed-sf');
    for (const patch of [{ state: 'disabled' }, { stale: { since: 2, reasonVi: 'x' } }, { state: 'adopted', adoptedAs: 'F-X' }] as const) {
      expect(node(sceneOf([...STORED, SuggestionSchema.parse({ ...ITEM, ...patch })]), id)).toBeUndefined();
    }
  });

  it('nhận nuôi: đồ thật source human kèm origin {suggestionId, rule, ruleVersion}', () => {
    const adopted = adoptedFurnitureOf(ITEM, { levelId: GRAPH.levels[0]!.id, centre: { x: 7600, y: 3100 } });
    expect(adopted).toMatchObject({
      source: 'human',
      reviewed: true,
      kind: 'bed',
      centre: { x: 7600, y: 3100 },
      origin: { suggestionId: ITEM.id, rule: 'P1', ruleVersion: 1 },
    });
    expect(adopted.id.startsWith('F-')).toBe(true);
  });

  it('nhận nuôi trong cảnh: dời món đề xuất → đồ thật mang origin, lượt về giữ origin; bản ghi cần chuyển adopted', () => {
    const scene = toPascalScene(GRAPH, { suggestions: [...STORED, ITEM] }).scene;
    const id = toPascalId('item', ITEM.id);
    const node = scene.nodes[id] as PascalItemNode;
    const moved = { ...scene, nodes: { ...scene.nodes, [id]: { ...node, position: [node.position[0] + 0.4, node.position[1], node.position[2]] } } };
    const adopted = toSpatialGraph(moved as typeof scene, undefined, new Set([ITEM.hostRef.room!])).graph.furniture.find(
      (f) => f.origin?.suggestionId === ITEM.id,
    );
    expect(adopted?.origin).toEqual({ suggestionId: ITEM.id, rule: 'P1', ruleVersion: 1 });
    expect(adopted?.source).toBe('human');

    const again = toSpatialGraph(toPascalScene({ ...GRAPH, furniture: [...GRAPH.furniture, adopted!] }).scene).graph.furniture;
    expect(again.find((f) => f.id === adopted!.id)?.origin?.suggestionId).toBe(ITEM.id);
    expect(adoptionsOf([adopted!], [ITEM])).toEqual([[ITEM.id, adopted!.id]]);
    expect(adoptionsOf([adopted!], [{ ...ITEM, state: 'adopted', adoptedAs: adopted!.id }])).toEqual([]);
  });
});
