import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpatialApi, SpatialLayer } from '@/api/client';
import { FloorLayerWriteResultSchema, FloorLayerWriteSchema } from '@/api/schemas/spatialLayer';
import type { Furniture } from '@/domain/spatial/types';
import type { HttpError } from '@/lib/http';

import {
  SAMPLE_BUILDING,
  sampleAxisId,
  sampleDimensionId,
  sampleFurnitureId,
  sampleLevelId,
  sampleWindowId,
} from '@/domain/spatial/__fixtures__/sampleBuilding';
import { applyPatch, readEntity } from '@/domain/spatial/applyPatch';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { isTransientWireError } from '@/lib/errors/wireError';
import { runExclusive } from '@/lib/mutations/entityQueue';
import { UNNAMED_ROOM_LABEL } from '@/lib/viewmodel/toViewModel';

import {
  changedDimensionLevelIds,
  changedLevelIds,
  classifyLayerSaveError,
  createFloorLayerSaver,
  type FloorLayerSaver,
  type FloorLayerSaverPorts,
  invalidWhereOf,
  LAYER_SAVE_MESSAGES,
  spatialLayerOf,
} from '../spatialLayerSave';

describe('invalidWhereOf', () => {
  it('hộp bao đồ đạc lẻ mm (kéo "Giữ tỉ lệ") → nêu id món + trường, không câu chung', () => {
    const furniture = { id: 'F-BED', boundingBox: { min: { x: 0, y: -1147.15 }, max: { x: 2102, y: 1147.15 } } };
    const body = { layer: { furniture: [furniture], openings: [], rooms: [], walls: [] } } as never;
    const parsed = FloorLayerWriteSchema.safeParse({ baseVersion: 1, body });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? '' : invalidWhereOf(parsed.error.issues, body)).toMatch(/^furniture F-BED › /);
    expect(invalidWhereOf([], body)).toBe('thân lưu');
  });
});

describe('spatialLayerOf', () => {
  it('chỉ lấy bốn danh sách của đúng một tầng — PUT không mang thực thể tầng khác', () => {
    const floor = sampleLevelId(1);
    const layer = spatialLayerOf(normalizeSpatial(SAMPLE_BUILDING), floor);
    const onFloor = SAMPLE_BUILDING.walls.filter((wall) => wall.levelId === floor);

    expect(layer.walls.map((wall) => wall.id)).toEqual(onFloor.map((wall) => wall.id));
    expect(layer.rooms.every((room) => room.levelId === floor)).toBe(true);
    expect(layer.furniture.every((item) => item.levelId === floor)).toBe(true);
    expect(layer.openings.every((opening) => onFloor.some((wall) => wall.id === opening.wallId))).toBe(true);
    expect(layer.walls.length + layer.openings.length).toBeGreaterThan(0);
  });

  it('23F-G-003/004: đồ đạc mang `model` (thay mẫu/đặt mẫu Pascal) ra thân PUT hợp lệ và giữ `model` (J-v3, W3b)', () => {
    const furnitureId = sampleFurnitureId(0);
    const model = { id: 'dining-chair', src: '/items/dining-chair/model.glb' };
    const swapped = applyPatch(normalizeSpatial(SAMPLE_BUILDING), [
      { changes: { model }, id: furnitureId, kind: 'furniture', op: 'update' },
    ]);
    const floor = readEntity(swapped, 'furniture', furnitureId)?.levelId ?? sampleLevelId(1);
    const layer = spatialLayerOf(swapped, floor);

    expect(readEntity(swapped, 'furniture', furnitureId)?.model).toEqual(model);
    expect(layer.furniture.find((item) => item.id === furnitureId)?.model).toEqual(model);
    expect(FloorLayerWriteSchema.safeParse({ baseVersion: 1, body: { layer } }).success).toBe(true);
  });
});

describe('changedLevelIds — B-V8-41: đích lưu là mọi tầng có thứ bị đổi', () => {
  const base = normalizeSpatial(SAMPLE_BUILDING);
  const furnitureId = sampleFurnitureId(0);
  const furniture = readEntity(base, 'furniture', furnitureId);

  if (furniture === null) {
    throw new Error('bộ mẫu thiếu đồ đạc 0');
  }

  it('cùng một đồ thị thì không tầng nào', () => {
    expect(changedLevelIds(base, base)).toEqual([]);
  });

  it('sửa một ô mở thì ra tầng của tường chủ', () => {
    const windowId = sampleWindowId(0);
    const opening = readEntity(base, 'opening', windowId);
    const host = opening === null ? null : readEntity(base, 'wall', opening.wallId);
    const next = applyPatch(base, [{ changes: { widthMm: 1234 }, id: windowId, kind: 'opening', op: 'update' }]);

    expect(changedLevelIds(base, next)).toEqual([host?.levelId]);
  });

  it('đồ đạc dời sang tầng khác thì ra cả tầng cũ lẫn tầng mới', () => {
    const target = furniture.levelId === sampleLevelId(2) ? sampleLevelId(3) : sampleLevelId(2);
    const next = applyPatch(base, [{ changes: { levelId: target }, id: furnitureId, kind: 'furniture', op: 'update' }]);

    expect([...changedLevelIds(base, next)].sort()).toEqual([furniture.levelId, target].sort());
  });

  it('thêm một đồ đạc thì ra tầng ấy; thêm rồi xoá thì không — lớp gửi đi y như cũ', () => {
    const extra: Furniture = { ...furniture, id: sampleFurnitureId(99) };
    const added = applyPatch(base, [{ entity: extra, kind: 'furniture', op: 'add' }]);
    const removed = applyPatch(added, [{ id: extra.id, kind: 'furniture', op: 'remove' }]);

    expect(changedLevelIds(base, added)).toEqual([furniture.levelId]);
    expect(changedLevelIds(base, removed)).toEqual([]);
  });

  it('G14/G22: đổi trục thì không tầng nào; đổi kích thước thì có (BUG-577: thân PUT mang dimensions)', () => {
    const axisId = sampleAxisId(0);
    const dimensionId = sampleDimensionId(0);
    const axis = readEntity(base, 'axis', axisId);
    const dimension = readEntity(base, 'dimension', dimensionId);

    if (axis === null || dimension === null) {
      throw new Error('bộ mẫu thiếu trục 0 hoặc kích thước 0');
    }

    const moved = applyPatch(base, [{ changes: { label: 'Z' }, id: axisId, kind: 'axis', op: 'update' }]);
    const resized = applyPatch(base, [
      { changes: { overrideValueMm: 1234 }, id: dimensionId, kind: 'dimension', op: 'update' },
    ]);
    const added = applyPatch(base, [{ entity: { ...axis, id: sampleAxisId(99) }, kind: 'axis', op: 'add' }]);

    expect(changedLevelIds(base, moved)).toEqual([]);
    expect(changedLevelIds(base, added)).toEqual([]);
    expect(changedLevelIds(base, resized)).toEqual([dimension.levelId]);
    expect(changedDimensionLevelIds(base, resized)).toEqual([dimension.levelId]);
    expect(changedDimensionLevelIds(base, moved)).toEqual([]);
  });

  it('tầng đã bị xoá khỏi đồ thị mới thì không ra', () => {
    const levelId = furniture.levelId;
    const next = applyPatch(base, [{ id: levelId, kind: 'level', op: 'remove' }]);

    expect(changedLevelIds(base, next)).not.toContain(levelId);
  });
});

/* ------------------------------------------------------------------------ */
/* createFloorLayerSaver — F-04x-1 bước 4                                    */
/* ------------------------------------------------------------------------ */

const FLOOR_A = 'L-LEVEL00';
const FLOOR_B = 'L-LEVEL01';
const PROJECT = 'project-1';

/** Lớp dây literal, qua schema đọc để có đúng kiểu `SpatialLayer`. */
const wireLayer = (wallLengthMm: number): SpatialLayer =>
  FloorLayerWriteResultSchema.parse({
    layer: {
      furniture: [],
      openings: [],
      rooms: [],
      walls: [
        {
          centreline: { end: { x: wallLengthMm, y: 0 }, start: { x: 0, y: 0 } },
          confidence: 0.82,
          heightMm: 3900,
          id: 'W-WALL000',
          kind: 'partition',
          levelId: FLOOR_A,
          openingIds: [],
          reviewed: false,
          source: 'ai',
          thicknessMm: 220,
        },
      ],
    },
    revision: 0,
  }).layer;

const httpError = (status: number, raw: Record<string, unknown>): HttpError => ({
  code: typeof raw.code === 'string' ? raw.code : 'UNKNOWN',
  kind: 'http',
  raw,
  requestId: 'req-1',
  retryable: false,
  status,
});

const TIMEOUT: HttpError = { kind: 'timeout', raw: undefined, requestId: 'req-2', retryable: true };

type WriteResult = Awaited<ReturnType<SpatialApi['writeLayer']>>;

const savedAt = (revision: number, layer: SpatialLayer = wireLayer(4800)): WriteResult => ({
  data: { layer, revision },
  ok: true,
});

const failed = (error: HttpError): WriteResult => ({ error, ok: false });

const deferred = (): { promise: Promise<WriteResult>; resolve: (value: WriteResult) => void } => {
  let resolve: (value: WriteResult) => void = () => undefined;
  const promise = new Promise<WriteResult>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

interface Harness {
  readonly layers: Map<string, SpatialLayer | null>;
  readonly revisions: Map<string, number | null>;
  readonly onSaved: ReturnType<typeof vi.fn<FloorLayerSaverPorts['onSaved']>>;
  readonly writeLayer: ReturnType<typeof vi.fn<SpatialApi['writeLayer']>>;
  readonly saver: FloorLayerSaver;
}

const harness = (queue?: FloorLayerSaverPorts['queue']): Harness => {
  const layers = new Map<string, SpatialLayer | null>([
    [FLOOR_A, wireLayer(4800)],
    [FLOOR_B, wireLayer(3600)],
  ]);
  const revisions = new Map<string, number | null>([
    [FLOOR_A, 3],
    [FLOOR_B, 7],
  ]);
  const onSaved = vi.fn<FloorLayerSaverPorts['onSaved']>();
  const writeLayer = vi.fn<SpatialApi['writeLayer']>().mockResolvedValue(savedAt(4));
  const saver = createFloorLayerSaver(PROJECT, {
    onSaved,
    readLayer: (floorId) => layers.get(floorId) ?? null,
    readRevision: (floorId) => revisions.get(floorId) ?? null,
    writeLayer,
    ...(queue ? { queue } : {}),
  });

  return { layers, onSaved, revisions, saver, writeLayer };
};

const sentWrite = (writeLayer: Harness['writeLayer'], call: number): { baseVersion: number; body: unknown } => {
  const input = writeLayer.mock.calls[call]?.[0];

  return { baseVersion: input?.baseVersion ?? -1, body: input?.body };
};

describe('createFloorLayerSaver — F-04x-1 bước 4', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lượt đầu lấy base từ readRevision, không đọc N16; thân gửi hợp FloorLayerWriteSchema', async () => {
    const { saver, writeLayer } = harness();

    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ floorId: FLOOR_A, projectId: PROJECT });

    const { baseVersion, body } = sentWrite(writeLayer, 0);

    expect(FloorLayerWriteSchema.parse({ baseVersion, body })).toStrictEqual({
      baseVersion: 3,
      body: { layer: wireLayer(4800) },
    });
  });

  it('lượt hai dùng revision của lượt một khi readRevision còn cũ; onSaved nhận kết quả', async () => {
    const { onSaved, saver, writeLayer } = harness();

    saver.markDirty([FLOOR_A]);
    await saver.flush();
    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(sentWrite(writeLayer, 1).baseVersion).toBe(4);
    expect(onSaved).toHaveBeenCalledWith(FLOOR_A, { layer: wireLayer(4800), revision: 4 }, { redirtied: false });
  });

  it('readRevision mới hơn revision đã lưu thì dùng readRevision (max)', async () => {
    const { revisions, saver, writeLayer } = harness();

    saver.markDirty([FLOOR_A]);
    await saver.flush();
    revisions.set(FLOOR_A, 9);
    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(sentWrite(writeLayer, 1).baseVersion).toBe(9);
  });

  it('timeout: ném đúng lỗi gốc, lượt sau gửi lại đúng thân và base cũ TRƯỚC thân mới', async () => {
    const { layers, onSaved, saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(TIMEOUT));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(TIMEOUT);
    expect(saver.hasDirty()).toBe(true);
    expect(saver.getBlock(FLOOR_A)).toBeNull();

    layers.set(FLOOR_A, wireLayer(6000));
    saver.markDirty([FLOOR_A]);
    writeLayer.mockResolvedValueOnce(savedAt(4)).mockResolvedValueOnce(savedAt(5));
    await saver.flush();

    expect(sentWrite(writeLayer, 1)).toStrictEqual(sentWrite(writeLayer, 0));
    expect(sentWrite(writeLayer, 2)).toStrictEqual({ baseVersion: 4, body: { layer: wireLayer(6000) } });
    expect(onSaved.mock.calls.map(([, , info]) => info.redirtied)).toStrictEqual([true, false]);
    expect(saver.hasDirty()).toBe(false);
  });

  it('timeout không có sửa mới: lượt sau chỉ gửi lại bản giữ', async () => {
    const { saver, writeLayer } = harness();

    writeLayer.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBeInstanceOf(TypeError);
    await saver.flush();

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(sentWrite(writeLayer, 1)).toStrictEqual(sentWrite(writeLayer, 0));
  });

  it('bản giữ lại hỏng tạm: thân mới chưa gửi, tầng vẫn bẩn để lượt sau chụp lại', async () => {
    const { saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(TIMEOUT)).mockResolvedValueOnce(failed(TIMEOUT));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(TIMEOUT);
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(TIMEOUT);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['409 VERSION_CONFLICT', httpError(409, { code: 'VERSION_CONFLICT', currentVersion: 8, remoteChanges: [], requestId: 'req-1' })],
    ['422 field baseVersion', httpError(422, { code: 'VALIDATION', field: 'baseVersion', requestId: 'req-1' })],
  ])('%s → reload: markDirty không gửi, hasDirty false, discardFloor gỡ', async (_name, error) => {
    const { saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(error);
    expect(saver.getBlock(FLOOR_A)).toStrictEqual({ kind: 'reload', message: LAYER_SAVE_MESSAGES.reload });
    expect(saver.blockedFloorIds()).toStrictEqual([FLOOR_A]);

    saver.markDirty([FLOOR_A]);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(saver.hasDirty()).toBe(false);

    saver.discardFloor(FLOOR_A);
    expect(saver.getBlock(FLOOR_A)).toBeNull();
    saver.markDirty([FLOOR_A]);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(2);
  });

  it('422 khác → blocked, câu nêu count; không tự gửi lại, markDirty mới thì gửi và gỡ khối', async () => {
    const { saver, writeLayer } = harness();
    const error = httpError(422, { code: 'LAYER_INTEGRITY_BROKEN', count: 3, requestId: 'req-1' });

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(error);
    expect(saver.getBlock(FLOOR_A)).toStrictEqual({ kind: 'blocked', message: LAYER_SAVE_MESSAGES.integrity(3) });
    expect(saver.getBlock(FLOOR_A)?.message).toContain('3');
    expect(saver.hasDirty()).toBe(false);

    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);

    saver.markDirty([FLOOR_A]);
    expect(saver.hasDirty()).toBe(true);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(saver.getBlock(FLOOR_A)).toBeNull();
  });

  it('phòng chưa đặt tên → vẫn PUT cả tầng, phòng đó mang tên tạm chưa duyệt, không khối', async () => {
    const { layers, saver, writeLayer } = harness();
    const named = FloorLayerWriteResultSchema.parse({
      layer: {
        furniture: [],
        openings: [],
        rooms: [
          {
            areaM2: 12,
            confidence: 0.6,
            id: 'R-ROOM00000',
            levelId: FLOOR_A,
            name: 'phòng ngủ',
            outline: [
              { x: 0, y: 0 },
              { x: 4000, y: 0 },
              { x: 4000, y: 3000 },
            ],
            reviewed: false,
            source: 'ai',
            usage: 'bedroom',
            wallIds: [],
          },
        ],
        walls: [],
      },
      revision: 0,
    }).layer;

    layers.set(FLOOR_A, { ...named, rooms: named.rooms.map((room) => ({ ...room, name: '' })) });
    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0].body.layer?.rooms[0]).toMatchObject({ name: UNNAMED_ROOM_LABEL, reviewed: false });
    expect(saver.getBlock(FLOOR_A)).toBeNull();
    expect(saver.hasDirty()).toBe(false);
  });

  it.each([
    [httpError(403, { code: 'FORBIDDEN', requestId: 'req-1' }), LAYER_SAVE_MESSAGES.forbidden],
    [httpError(413, { code: 'PAYLOAD_TOO_LARGE', requestId: 'req-1' }), LAYER_SAVE_MESSAGES.unknown],
    [httpError(422, { code: 'LAYER_INTEGRITY_BROKEN', requestId: 'req-1' }), LAYER_SAVE_MESSAGES.unknown],
    [httpError(400, { code: 'SOMETHING_ODD', requestId: 'req-1' }), LAYER_SAVE_MESSAGES.unknown],
    [
      httpError(422, { code: 'VALIDATION', count: 7, field: 'body.layer.furniture.2.variant', requestId: 'req-1' }),
      LAYER_SAVE_MESSAGES.rejected('body.layer.furniture.2.variant'),
    ],
    [httpError(422, { code: 'VALIDATION', requestId: 'req-1' }), LAYER_SAVE_MESSAGES.unknown],
  ])('câu khối theo mã; mã lạ không in mã (%#)', async (error, message) => {
    const { saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(error);

    expect(saver.getBlock(FLOOR_A)).toStrictEqual({ kind: 'blocked', message });
    expect(saver.getBlock(FLOOR_A)?.message).not.toContain(error.code ?? '');
  });

  it('flush() lúc đang gửi chỉ trả sau khi PUT về', async () => {
    const { saver, writeLayer } = harness();
    const pending = deferred();
    let secondDone = false;

    writeLayer.mockReturnValueOnce(pending.promise);
    saver.markDirty([FLOOR_A]);
    const first = saver.flush();
    const second = saver.flush().then(() => {
      secondDone = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(secondDone).toBe(false);
    expect(saver.hasDirty()).toBe(true);

    pending.resolve(savedAt(4));
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('sửa lại trong lúc bay → redirtied true, lượt sau dùng revision vừa về', async () => {
    const { onSaved, saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise);
    saver.markDirty([FLOOR_A]);
    const first = saver.flush();

    saver.markDirty([FLOOR_A]);
    pending.resolve(savedAt(4));
    await first;

    expect(onSaved).toHaveBeenCalledWith(FLOOR_A, expect.objectContaining({ revision: 4 }), { redirtied: true });
    await saver.flush();
    expect(sentWrite(writeLayer, 1).baseVersion).toBe(4);
  });

  it('khối của A không chặn B; lượt sau A không gửi lại → flush không ném, hasDirty false', async () => {
    const { onSaved, saver, writeLayer } = harness();
    const error = httpError(409, { code: 'VERSION_CONFLICT', currentVersion: 8, remoteChanges: [], requestId: 'req-1' });

    writeLayer.mockImplementation(async ({ floorId }) => (floorId === FLOOR_A ? failed(error) : savedAt(8)));
    saver.markDirty([FLOOR_A, FLOOR_B]);
    await expect(saver.flush()).rejects.toBe(error);
    expect(onSaved).toHaveBeenCalledWith(FLOOR_B, expect.objectContaining({ revision: 8 }), { redirtied: false });

    saver.markDirty([FLOOR_B]);
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(saver.hasDirty()).toBe(false);
    expect(saver.blockedFloorIds()).toStrictEqual([FLOOR_A]);
  });

  it('lỗi tạm được ném trước lỗi khối', async () => {
    const { saver, writeLayer } = harness();
    const blocked = httpError(403, { code: 'FORBIDDEN', requestId: 'req-1' });

    writeLayer.mockImplementation(async ({ floorId }) => failed(floorId === FLOOR_A ? blocked : TIMEOUT));
    saver.markDirty([FLOOR_A, FLOOR_B]);

    await expect(saver.flush()).rejects.toBe(TIMEOUT);
  });

  it('chỉ ném lỗi của tầng gửi trong lượt này', async () => {
    const { saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(savedAt(8));
    saver.markDirty([FLOOR_A]);
    const first = saver.flush();

    saver.markDirty([FLOOR_B]);
    const second = saver.flush();

    pending.resolve(failed(TIMEOUT));
    await expect(first).rejects.toBe(TIMEOUT);
    await expect(second).resolves.toBeUndefined();
  });

  it('thân không hợp FloorLayerWriteSchema → blocked nêu chỗ sai, không gửi, ném 422 không tạm thời', async () => {
    const { layers, saver, writeLayer } = harness();
    const [wall] = wireLayer(4800).walls;

    layers.set(FLOOR_A, { ...wireLayer(4800), walls: wall ? [{ ...wall, thicknessMm: -1 }] : [] });
    saver.markDirty([FLOOR_A]);

    const error: unknown = await saver.flush().catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ kind: 'http', retryable: false, status: 422 });
    expect(isTransientWireError(error)).toBe(false);
    expect(writeLayer).toHaveBeenCalledTimes(0);
    expect(saver.getBlock(FLOOR_A)).toStrictEqual({
      kind: 'blocked',
      message: LAYER_SAVE_MESSAGES.invalid(`walls ${wall?.id ?? ''} › thicknessMm`),
    });
    expect(saver.hasDirty()).toBe(false);
  });

  it('readRevision null → base 0', async () => {
    const { revisions, saver, writeLayer } = harness();

    revisions.set(FLOOR_A, null);
    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(sentWrite(writeLayer, 0).baseVersion).toBe(0);
  });

  it('readLayer null → không PUT, tầng vẫn bẩn', async () => {
    const { layers, saver, writeLayer } = harness();

    layers.set(FLOOR_A, null);
    saver.markDirty([FLOOR_A]);
    await saver.flush();

    expect(writeLayer).toHaveBeenCalledTimes(0);
    expect(saver.hasDirty()).toBe(true);
  });

  it('khoá riêng mỗi tầng qua queue; hai tầng bay song song', async () => {
    const keys: string[] = [];
    const queue: typeof runExclusive = (key, task) => {
      keys.push(key);

      return runExclusive(key, task);
    };
    const { saver, writeLayer } = harness(queue);
    const a = deferred();
    const b = deferred();

    writeLayer.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    saver.markDirty([FLOOR_A, FLOOR_B]);
    const flushed = saver.flush();

    await vi.advanceTimersByTimeAsync(0);
    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(keys).toStrictEqual([
      `layer:${PROJECT}:${FLOOR_A}`,
      `layer:${PROJECT}:${FLOOR_B}`,
    ]);

    b.resolve(savedAt(8));
    a.resolve(savedAt(4));
    await flushed;
  });

  it('subscribe nhận bẩn ∪ đang gửi ∪ bị khối; huỷ đăng ký thì thôi nhận', async () => {
    const { saver, writeLayer } = harness();
    const listener = vi.fn();
    const error = httpError(403, { code: 'FORBIDDEN', requestId: 'req-1' });
    const unsubscribe = saver.subscribe(listener);

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    expect(listener).toHaveBeenLastCalledWith([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(error);
    expect(listener).toHaveBeenLastCalledWith([FLOOR_A]);

    saver.discardFloor(FLOOR_A);
    expect(listener).toHaveBeenLastCalledWith([]);

    unsubscribe();
    saver.markDirty([FLOOR_B]);
    expect(listener).not.toHaveBeenLastCalledWith([FLOOR_B]);
  });

  it('sau dispose: lượt đang bay không gọi onSaved, flush không gửi', async () => {
    const { onSaved, saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise);
    saver.markDirty([FLOOR_A]);
    const flushed = saver.flush();

    saver.dispose();
    pending.resolve(savedAt(4));
    await flushed;
    expect(onSaved).not.toHaveBeenCalled();

    saver.markDirty([FLOOR_A]);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });
});

describe('saveScale — F-04x-2 bước 5', () => {
  const RATIO = 12.5;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saveScale gửi scaleEvidence — tầng sạch: thân chỉ tỉ lệ, base = max(readRevision, hint); onSaved có scaleSent', async () => {
    const { onSaved, saver, writeLayer } = harness();

    await saver.saveScale(FLOOR_A, RATIO, 'machineAccepted', 5);
    await saver.saveScale(FLOOR_B, RATIO, 'measured', 2);

    expect(sentWrite(writeLayer, 0)).toStrictEqual({
      baseVersion: 5,
      body: { scaleEvidence: 'machineAccepted', scaleMillimetresPerPixel: RATIO },
    });
    expect(sentWrite(writeLayer, 1)).toStrictEqual({
      baseVersion: 7,
      body: { scaleEvidence: 'measured', scaleMillimetresPerPixel: RATIO },
    });
    expect(onSaved).toHaveBeenCalledWith(FLOOR_A, expect.objectContaining({ revision: 4 }), {
      redirtied: false,
      scaleSent: true,
    });
  });

  it('tầng sạch không hint: base = readRevision', async () => {
    const { saver, writeLayer } = harness();

    await saver.saveScale(FLOOR_A, RATIO, 'measured');

    expect(sentWrite(writeLayer, 0).baseVersion).toBe(3);
  });

  it('PUT lớp + tỉ lệ mang scaleEvidence — tầng bẩn: MỘT PUT; hint lớn hơn vẫn giữ base của lớp; flush sau không gửi lại', async () => {
    const { saver, writeLayer } = harness();

    saver.markDirty([FLOOR_A]);
    await saver.saveScale(FLOOR_A, RATIO, 'machineAccepted', 9);

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(sentWrite(writeLayer, 0)).toStrictEqual({
      baseVersion: 3,
      body: { layer: wireLayer(4800), scaleEvidence: 'machineAccepted', scaleMillimetresPerPixel: RATIO },
    });

    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(saver.hasDirty()).toBe(false);
  });

  it('tầng bị khối: không PUT, ném lại đúng lỗi đang giữ', async () => {
    const { saver, writeLayer } = harness();
    const error = httpError(403, { code: 'FORBIDDEN', requestId: 'req-1' });

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(error);

    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured', 9)).rejects.toBe(error);
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('sửa lúc PUT tỉ lệ bay: không PUT tiếp, khối reload với câu tỉ lệ, tầng vẫn chưa lưu', async () => {
    const { onSaved, saver, writeLayer } = harness();
    const pending = deferred();
    const listener = vi.fn();

    saver.subscribe(listener);
    writeLayer.mockReturnValueOnce(pending.promise);
    const saving = saver.saveScale(FLOOR_A, RATIO, 'measured');

    await vi.advanceTimersByTimeAsync(0);
    saver.markDirty([FLOOR_A]);
    pending.resolve(savedAt(4));
    await saving;

    expect(onSaved).toHaveBeenCalledWith(FLOOR_A, expect.objectContaining({ revision: 4 }), {
      redirtied: true,
      scaleSent: true,
    });
    expect(saver.getBlock(FLOOR_A)).toStrictEqual({ kind: 'reload', message: LAYER_SAVE_MESSAGES.scaleRedirtied });
    expect(LAYER_SAVE_MESSAGES.scaleRedirtied).toBe(
      'Tỷ lệ tầng này vừa đổi trong lúc bạn sửa. Tải lại để sửa trên số đo mới.',
    );

    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([FLOOR_A]);

    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured')).rejects.toThrow(LAYER_SAVE_MESSAGES.scaleRedirtied);
    expect(writeLayer).toHaveBeenCalledTimes(1);

    saver.discardFloor(FLOOR_A);
    await saver.saveScale(FLOOR_A, RATIO, 'measured');
    expect(writeLayer).toHaveBeenCalledTimes(2);
  });

  it('chờ PUT lớp đang bay của cùng tầng, rồi lấy base từ revision vừa về', async () => {
    const { saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(savedAt(5));
    saver.markDirty([FLOOR_A]);
    const flushed = saver.flush();
    const saving = saver.saveScale(FLOOR_A, RATIO, 'measured');

    await vi.advanceTimersByTimeAsync(0);
    expect(writeLayer).toHaveBeenCalledTimes(1);

    pending.resolve(savedAt(4));
    await Promise.all([flushed, saving]);

    expect(sentWrite(writeLayer, 1)).toStrictEqual({ baseVersion: 4, body: { scaleEvidence: 'measured', scaleMillimetresPerPixel: RATIO } });
  });

  it('thân chỉ tỉ lệ hỏng 422: ném lỗi gốc, không khối, không tự gửi lại', async () => {
    const { saver, writeLayer } = harness();
    const error = httpError(422, { code: 'VALIDATION', field: 'scaleMillimetresPerPixel', requestId: 'req-1' });

    writeLayer.mockResolvedValueOnce(failed(error));
    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured')).rejects.toBe(error);

    expect(saver.getBlock(FLOOR_A)).toBeNull();
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('thân chỉ tỉ lệ hỏng tạm: không giữ bản để gửi lại', async () => {
    const { saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(TIMEOUT));
    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured')).rejects.toBe(TIMEOUT);

    expect(saver.hasDirty()).toBe(false);
    await saver.flush();
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('lớp + tỉ lệ hỏng tạm: tầng bẩn lại, lượt sau chỉ gửi lớp', async () => {
    const { saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(TIMEOUT));
    saver.markDirty([FLOOR_A]);
    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured')).rejects.toBe(TIMEOUT);

    expect(saver.hasDirty()).toBe(true);
    await saver.flush();
    expect(sentWrite(writeLayer, 1)).toStrictEqual({ baseVersion: 3, body: { layer: wireLayer(4800) } });
  });

  it('flush chờ PUT lớp + tỉ lệ đang bay hỏng tạm → flush ném lỗi tạm (review-1 P2-3)', async () => {
    const { saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise);
    saver.markDirty([FLOOR_A]);
    const scaling = saver.saveScale(FLOOR_A, RATIO, 'measured').catch(() => undefined);

    await vi.waitFor(() => expect(writeLayer).toHaveBeenCalledTimes(1));
    const flushing = saver.flush();

    pending.resolve(failed(TIMEOUT));
    await scaling;

    await expect(flushing).rejects.toBe(TIMEOUT);
    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(saver.hasDirty()).toBe(true);
  });

  it('flush chờ PUT chỉ tỉ lệ đang bay hỏng tạm → flush không ném (không có gì để gửi lại)', async () => {
    const { saver, writeLayer } = harness();
    const pending = deferred();

    writeLayer.mockReturnValueOnce(pending.promise);
    const scaling = saver.saveScale(FLOOR_A, RATIO, 'measured').catch(() => undefined);

    await vi.waitFor(() => expect(writeLayer).toHaveBeenCalledTimes(1));
    const flushing = saver.flush();

    pending.resolve(failed(TIMEOUT));
    await scaling;

    await expect(flushing).resolves.toBeUndefined();
    expect(saver.hasDirty()).toBe(false);
  });

  it('lớp + tỉ lệ hỏng 409: khối reload như lượt lưu lớp', async () => {
    const { saver, writeLayer } = harness();
    const error = httpError(409, { code: 'VERSION_CONFLICT', currentVersion: 8, remoteChanges: [], requestId: 'req-1' });

    writeLayer.mockResolvedValueOnce(failed(error));
    saver.markDirty([FLOOR_A]);
    await expect(saver.saveScale(FLOOR_A, RATIO, 'measured')).rejects.toBe(error);

    expect(saver.getBlock(FLOOR_A)).toStrictEqual({ kind: 'reload', message: LAYER_SAVE_MESSAGES.reload });
  });

  it('bản giữ (hỏng tạm) đi cùng tỉ lệ trong một PUT, đúng base của bản giữ', async () => {
    const { revisions, saver, writeLayer } = harness();

    writeLayer.mockResolvedValueOnce(failed(TIMEOUT));
    saver.markDirty([FLOOR_A]);
    await expect(saver.flush()).rejects.toBe(TIMEOUT);

    revisions.set(FLOOR_A, 6);
    await saver.saveScale(FLOOR_A, RATIO, 'measured', 9);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(sentWrite(writeLayer, 1)).toStrictEqual({
      baseVersion: 3,
      body: { layer: wireLayer(4800), scaleEvidence: 'measured', scaleMillimetresPerPixel: RATIO },
    });
    expect(saver.hasDirty()).toBe(false);
  });

  it('tỉ lệ không hợp lệ: không gửi, ném 422 không tạm thời, không khối', async () => {
    const { saver, writeLayer } = harness();
    const error: unknown = await saver.saveScale(FLOOR_A, 0, 'measured').catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ kind: 'http', retryable: false, status: 422 });
    expect(writeLayer).toHaveBeenCalledTimes(0);
    expect(saver.getBlock(FLOOR_A)).toBeNull();
  });
});

describe('createFloorLayerSaver — sự cố hạ tầng không khoá tầng', () => {
  it('503 DEPENDENCY_UNAVAILABLE rồi 200: không khối, thân giữ được gửi lại, hết chưa lưu', async () => {
    const { saver, writeLayer } = harness();
    const unsaved: (readonly string[])[] = [];
    const unavailable = httpError(503, { code: 'DEPENDENCY_UNAVAILABLE', requestId: 'req-1' });

    saver.subscribe((ids) => unsaved.push(ids));
    writeLayer.mockResolvedValueOnce(failed(unavailable)).mockResolvedValueOnce(savedAt(4));
    saver.markDirty([FLOOR_A]);

    await expect(saver.flush()).rejects.toBe(unavailable);
    expect(saver.getBlock(FLOOR_A)).toBeNull();
    expect(saver.hasDirty()).toBe(true);

    await saver.flush();

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(sentWrite(writeLayer, 1)).toStrictEqual(sentWrite(writeLayer, 0));
    expect(saver.blockedFloorIds()).toStrictEqual([]);
    expect(saver.hasDirty()).toBe(false);
    expect(unsaved.at(-1)).toStrictEqual([]);
  });
});

describe('classifyLayerSaveError', () => {
  it.each([
    [httpError(409, { code: 'VERSION_CONFLICT', requestId: 'r' }), 'reload'],
    [httpError(422, { code: 'VALIDATION', field: 'baseVersion', requestId: 'r' }), 'reload'],
    [httpError(422, { code: 'VALIDATION', field: 'layer', requestId: 'r' }), 'blocked'],
    [httpError(413, { code: 'PAYLOAD_TOO_LARGE', requestId: 'r' }), 'blocked'],
    [httpError(428, { code: 'PRECONDITION_REQUIRED', requestId: 'r' }), 'blocked'],
    [httpError(404, { code: 'NOT_FOUND', requestId: 'r', resource: 'floor' }), 'blocked'],
    [httpError(503, { code: 'DEPENDENCY_UNAVAILABLE', requestId: 'r' }), 'temporary'],
    [httpError(500, { code: 'INTERNAL', requestId: 'r' }), 'temporary'],
    [{ kind: 'aborted', raw: undefined, requestId: 'r', retryable: false }, 'temporary'],
    [TIMEOUT, 'temporary'],
    [{ kind: 'network', raw: undefined, requestId: 'r', retryable: true }, 'temporary'],
  ] as const)('%# → %s', (error, expected) => {
    expect(classifyLayerSaveError(error)).toBe(expected);
  });
});

describe('createFloorLayerSaver — dimensions trong thân PUT (BUG-577)', () => {
  it('tầng có kích thước đổi → thân mang dimensions; tầng chỉ đổi lớp → không mang', async () => {
    const dimension = readEntity(normalizeSpatial(SAMPLE_BUILDING), 'dimension', sampleDimensionId(0));

    if (dimension === null) {
      throw new Error('bộ mẫu thiếu kích thước 0');
    }

    const writeLayer = vi.fn<SpatialApi['writeLayer']>().mockResolvedValue(savedAt(4));
    const saver = createFloorLayerSaver(PROJECT, {
      onSaved: vi.fn(),
      readDimensions: () => [dimension],
      readLayer: () => wireLayer(4800),
      readRevision: () => 3,
      writeLayer,
    });

    saver.markDirty([FLOOR_A], [FLOOR_A]);
    saver.markDirty([FLOOR_B]);
    await saver.flush();

    const bodies = Object.fromEntries(
      writeLayer.mock.calls.map(([input]) => [input.floorId, input.body as { dimensions?: unknown }]),
    );

    expect(bodies[FLOOR_A]?.dimensions).toEqual([dimension]);
    expect(bodies[FLOOR_B]).not.toHaveProperty('dimensions');
    expect(FloorLayerWriteSchema.safeParse({ baseVersion: 3, body: bodies[FLOOR_A] }).success).toBe(true);
  });
});
