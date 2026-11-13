import type { SpatialApi, SpatialLayer } from '@/api/client';
import {
  FloorLayerWriteSchema,
  type FloorLayerWriteBody,
  type FloorLayerWriteResult,
  type ScaleEvidence,
} from '@/api/schemas/spatialLayer';
import { isIdOfKind, type EntityKind } from '@/domain/spatial/ids';
import { idsOnLevel, isEntityOfKind, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Dimension, Furniture, LevelId, Opening, Roof, Room, Wall } from '@/domain/spatial/types';
import { isTransientWireError, readWireError } from '@/lib/errors/wireError';
import type { HttpError } from '@/lib/http/types';
import { runExclusive } from '@/lib/mutations/entityQueue';
import { UNNAMED_ROOM_LABEL } from '@/lib/viewmodel/toViewModel';

/**
 * Bốn danh sách thực thể của MỘT tầng, đúng hình dạng `SpatialLayer` mà
 * `SpatialApi.writeLayer` nhận.
 *
 * Lọc theo tầng chứ không gửi cả toà nhà: `writeLayer` khoá theo
 * `projects/:id/floors/:floorId/spatial/layer`, nên gửi kèm tường của tầng
 * khác là ghi dữ liệu của tầng đó vào đường dẫn của tầng này. `idsOnLevel` là
 * chỉ mục `byLevel` mà `normalizeSpatial` đã dựng sẵn — không một phép duyệt
 * hình học nào ở đây, chỉ đọc id.
 */
/**
 * #35 bắt buộc tên phòng không rỗng (AppBack `Room.name: HumanText`). Phòng chưa đặt tên không được
 * chặn cả tầng: gửi với tên tạm `UNNAMED_ROOM_LABEL` và `reviewed: false` (tên tạm không phải dữ liệu
 * đã duyệt). Bảng diện tích coi tên tạm là chưa đặt tên, nên cảnh báo vẫn hiện tới khi người đặt tên.
 */
const withSendableName = ({ clearAreaM2, ...room }: Room): Room => {
  // `clearAreaM2` máy chủ tính từ đường bao + tường: không gửi lại, để nó tính lại theo bản vừa sửa.
  void clearAreaM2;
  return room.name.trim() === '' ? { ...room, name: UNNAMED_ROOM_LABEL, reviewed: false } : room;
};

const withSendableNames = (layer: SpatialLayer | null): SpatialLayer | null =>
  layer && { ...layer, rooms: layer.rooms.map(withSendableName) };

export function spatialLayerOf(graph: NormalizedSpatial, floorId: LevelId): SpatialLayer {
  const furniture: Furniture[] = [];
  const openings: Opening[] = [];
  const rooms: Room[] = [];
  const walls: Wall[] = [];
  const roofs: Roof[] = [];

  for (const id of idsOnLevel(graph, floorId)) {
    const entity = graph.byId[id];

    if (entity === undefined) {
      continue;
    }

    if (isEntityOfKind('wall', entity)) {
      walls.push(entity);
    } else if (isEntityOfKind('opening', entity)) {
      openings.push(entity);
    } else if (isEntityOfKind('room', entity)) {
      rooms.push(withSendableName(entity));
    } else if (isEntityOfKind('furniture', entity)) {
      // `model` đi theo lên dây từ J-v3 (BE nhận từ 55af7d9c) — thay mẫu Pascal được lưu (W3b).
      furniture.push(entity);
    } else if (isEntityOfKind('roof', entity)) {
      roofs.push(entity);
    }
  }

  // Vắng khi không có mái: máy chủ cũ không biết khoá `roofs` (roof-contract.md: vắng = []).
  return { furniture, openings, rooms, walls, ...(roofs.length === 0 ? {} : { roofs }) };
}

/** Kích thước của MỘT tầng — thân PUT mang chúng (`body.dimensions`) khi chúng đổi, không nằm trong `SpatialLayer`. */
export function dimensionsOf(graph: NormalizedSpatial, floorId: LevelId): Dimension[] {
  const dimensions: Dimension[] = [];

  for (const id of idsOnLevel(graph, floorId)) {
    const entity = graph.byId[id];

    if (entity !== undefined && isEntityOfKind('dimension', entity)) {
      dimensions.push(entity);
    }
  }

  return dimensions;
}

/** Bốn loại thực thể `spatialLayerOf` gửi đi; trục, ghi chú không vào thân PUT. */
const LAYER_KINDS: readonly EntityKind[] = ['wall', 'opening', 'room', 'furniture', 'roof'];
const DIMENSION_KINDS: readonly EntityKind[] = ['dimension'];

const idsOfKindsOn = (
  graph: NormalizedSpatial,
  levelId: LevelId,
  kinds: readonly EntityKind[],
): readonly string[] =>
  idsOnLevel(graph, levelId).filter((id) => {
    const entity = graph.byId[id];

    return entity !== undefined && kinds.some((kind) => isEntityOfKind(kind, entity));
  });

function changedFloors(
  previous: NormalizedSpatial,
  next: NormalizedSpatial,
  kinds: readonly EntityKind[],
): LevelId[] {
  return next.byKind.level.filter((levelId): levelId is LevelId => {
    if (!isIdOfKind('level', levelId)) {
      return false;
    }

    if (idsOnLevel(previous, levelId) === idsOnLevel(next, levelId)) {
      return idsOfKindsOn(next, levelId, kinds).some((id) => previous.byId[id] !== next.byId[id]);
    }

    const before = idsOfKindsOn(previous, levelId, kinds);
    const after = idsOfKindsOn(next, levelId, kinds);

    return before.length !== after.length || after.some((id, index) => before[index] !== id || previous.byId[id] !== next.byId[id]);
  });
}

/**
 * Các tầng của `next` mà thứ gửi đi (bốn danh sách của `spatialLayerOf` + kích thước) khác
 * `previous` — đích lưu là mọi tầng có thứ bị đổi, không phải tầng đang xem (B-V8-41). So tham
 * chiếu thực thể là đủ: `applyPatch` chỉ chép thực thể bị chạm. Trục nằm trong `byLevel` nhưng
 * chỉ sống trong phiên, nên đổi chúng không làm tầng bẩn (G14/G22: PUT ngầm sau khi vào
 * SCR-18/19 bằng SPA). Chỉ duyệt tầng còn trong `next`.
 */
export function changedLevelIds(previous: NormalizedSpatial, next: NormalizedSpatial): LevelId[] {
  return changedFloors(previous, next, [...LAYER_KINDS, ...DIMENSION_KINDS]);
}

/** Tập con của {@link changedLevelIds} mà KÍCH THƯỚC đổi — những tầng thân PUT phải mang `dimensions`. */
export function changedDimensionLevelIds(previous: NormalizedSpatial, next: NormalizedSpatial): LevelId[] {
  return changedFloors(previous, next, DIMENSION_KINDS);
}

/** Ba ngả của một lượt lưu lớp hỏng (prompt F-04x-1 khối [2]). */
export type LayerSaveErrorClass = 'reload' | 'blocked' | 'temporary';

/** Khối của một tầng: `reload` chờ `discardFloor`, `blocked` chờ một `markDirty` mới. */
export interface LayerSaveBlock {
  readonly kind: 'reload' | 'blocked';
  readonly message: string;
}

/** Câu người đọc của khối — việc D chép sang khối `floorLayerSave` của `vi.json`. */
export const LAYER_SAVE_MESSAGES = {
  forbidden: 'Bạn không còn quyền sửa tầng này.',
  integrity: (count: number): string => `Tầng này có ${count} chỗ hỏng liên kết hình học nên chưa lưu được.`,
  /* P02: nói rõ "Tải lại" bỏ thay đổi chưa lưu của tab này — không để người dùng mất sửa mà không biết. */
  reload: 'Tầng này vừa được sửa ở nơi khác nên thay đổi của bạn ở đây chưa lưu được. Tải lại để xem bản mới nhất; thay đổi chưa lưu sẽ bị bỏ.',
  unnamedRoom: 'Có phòng chưa đặt tên nên chưa lưu được tầng này. Đặt tên cho phòng đó rồi lưu lại.',
  scaleRedirtied: 'Tỷ lệ tầng này vừa đổi trong lúc bạn sửa. Tải lại để sửa trên số đo mới.',
  rejected: (field: string): string =>
    `Máy chủ không nhận dữ liệu của tầng này (${field}) nên thay đổi chưa được lưu. Báo quản trị kèm câu này.`,
  /* Thân bị chặn ngay ở máy (chưa gửi): nêu đúng chỗ sai, không để câu chung che mất lỗi. */
  invalid: (where: string): string =>
    `Thay đổi của tầng này chưa lưu được: dữ liệu sai ở ${where}. Hoàn tác lần sửa vừa rồi rồi thử lại; vẫn lỗi thì báo quản trị kèm câu này.`,
  unknown: 'Không lưu được thay đổi của tầng này.',
} as const;

/**
 * 409 và 422 `baseVersion` → tải lại (R6); lỗi tạm → thử lại; còn lại → khối.
 *
 * Tạm gồm mọi 5xx và lượt bị cắt giữa chừng (`aborted`), không chỉ 502/503/504: máy chủ sập
 * hay mạng đứt không nói gì về thân gửi, còn khối thì bày "Tải lại tầng" — nút BỎ sửa của
 * người dùng — cho một sự cố hạ tầng tự hết sau vài giây (worker api sập → 503 rồi 200).
 */
export function classifyLayerSaveError(error: unknown): LayerSaveErrorClass {
  const wire = readWireError(error);

  if (wire?.status === 409 || (wire?.status === 422 && wire.field === 'baseVersion')) {
    return 'reload';
  }

  const aborted = typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'aborted';

  return isTransientWireError(error) || (wire?.status ?? 0) >= 500 || aborted ? 'temporary' : 'blocked';
}

/** `raw` của lỗi 422 tại chỗ (`issues` của zod): có lỗi ở `rooms.<n>.name` — phòng chưa đặt tên. */
const hasUnnamedRoomIssue = (raw: unknown): boolean =>
  Array.isArray(raw) &&
  raw.some((issue: unknown) => {
    const path: unknown = typeof issue === 'object' && issue !== null && 'path' in issue ? issue.path : null;

    return Array.isArray(path) && path.includes('rooms') && path[path.length - 1] === 'name';
  });

/**
 * Chỗ sai đầu tiên của thân bị chặn tại máy, đọc được: `furniture F-01… › boundingBox.min.y`.
 * Bỏ tiền tố `body.layer`; chỉ số mảng đổi thành id thực thể khi tra được.
 */
export const invalidWhereOf = (issues: readonly unknown[], body: FloorLayerWriteBody): string => {
  const first = issues[0];
  const raw: unknown = typeof first === 'object' && first !== null && 'path' in first ? first.path : null;
  const path = Array.isArray(raw) ? raw.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number') : [];
  const rest = path[0] === 'body' ? path.slice(path[1] === 'layer' ? 2 : 1) : path;
  const [list, index, ...field] = rest;
  const entries: unknown = typeof list === 'string' && body.layer ? (body.layer as unknown as Record<string, unknown>)[list] : undefined;
  const entity: unknown = Array.isArray(entries) && typeof index === 'number' ? entries[index] : undefined;
  const id = typeof entity === 'object' && entity !== null && 'id' in entity ? String(entity.id) : null;

  if (id !== null && typeof list === 'string') {
    return field.length > 0 ? `${list} ${id} › ${field.join('.')}` : `${list} ${id}`;
  }

  return rest.length > 0 ? rest.join('.') : 'thân lưu';
};

const blockMessageOf = (kind: LayerSaveBlock['kind'], error: unknown, body?: FloorLayerWriteBody): string => {
  const wire = readWireError(error);
  const raw: unknown = typeof error === 'object' && error !== null && 'raw' in error ? error.raw : null;
  const count = typeof raw === 'object' && raw !== null && 'count' in raw ? raw.count : undefined;

  if (kind === 'reload') {
    return LAYER_SAVE_MESSAGES.reload;
  }

  if (wire?.status === 403) {
    return LAYER_SAVE_MESSAGES.forbidden;
  }

  if (hasUnnamedRoomIssue(raw)) {
    return LAYER_SAVE_MESSAGES.unnamedRoom;
  }

  // `raw` là mảng `issues` của zod chỉ khi thân bị chặn tại máy (`send`), không bao giờ từ máy chủ.
  if (body !== undefined && Array.isArray(raw) && raw.length > 0) {
    return LAYER_SAVE_MESSAGES.invalid(invalidWhereOf(raw, body));
  }

  if (wire?.code === 'LAYER_INTEGRITY_BROKEN' && typeof count === 'number') {
    return LAYER_SAVE_MESSAGES.integrity(count);
  }

  /* B3b-11 — máy chủ từ chối hình dạng thân (thường là máy chủ cũ hơn bản giao diện): nêu trường để
     người quản trị tìm ra ngay, thay vì câu chung "không lưu được". */
  return wire?.code === 'VALIDATION' && wire.field !== undefined
    ? LAYER_SAVE_MESSAGES.rejected(wire.field)
    : LAYER_SAVE_MESSAGES.unknown;
};

export interface FloorLayerSaverPorts {
  writeLayer: SpatialApi['writeLayer'];
  readLayer(floorId: string): SpatialLayer | null;
  readRevision(floorId: string): number | null;
  /** Kích thước hiện có của tầng; vắng → thân PUT không bao giờ mang `dimensions`. */
  readDimensions?(floorId: string): readonly Dimension[] | null;
  /** `scaleSent` chỉ có mặt (luôn `true`) khi thân mang tỉ lệ — kho gỡ `scaleStatus` của tầng. */
  onSaved(floorId: string, result: FloorLayerWriteResult, info: { redirtied: boolean; scaleSent?: true }): void;
  queue?: typeof runExclusive;
}

export interface FloorLayerSaver {
  /** `dimensionFloorIds` ⊆ `floorIds`: tầng mà KÍCH THƯỚC đổi — lượt PUT của nó mang `dimensions`. */
  markDirty(floorIds: readonly string[], dimensionFloorIds?: readonly string[]): void;
  hasDirty(): boolean;
  flush(): Promise<void>;
  /**
   * Gửi tỉ lệ của một tầng qua #35, cùng khoá tầng với lớp (F-04x-2 bước 5). Tầng bị khối →
   * không gửi, ném lại lỗi đang giữ. Tầng bẩn → một PUT lớp + tỉ lệ, base của lớp (`hint` bị bỏ:
   * thân có `layer` mà base lấy từ N15 là đè im lặng). Tầng sạch → thân chỉ tỉ lệ, base nâng
   * theo `hint`. Hỏng → ném lỗi gốc; thân tỉ lệ không bao giờ bị giữ để tự gửi lại.
   * `evidence` đi kèm tỉ lệ (`scaleEvidence`, K4): số máy đã chấp nhận hay kích thước người đo.
   */
  saveScale(floorId: string, ratio: number, evidence: ScaleEvidence, hint?: number): Promise<void>;
  discardFloor(floorId: string): void;
  getBlock(floorId: string): LayerSaveBlock | null;
  blockedFloorIds(): string[];
  /** `listener` nhận bẩn ∪ đang gửi ∪ bản giữ ∪ bị khối — đúng `unsavedFloorIds` của kho. */
  subscribe(listener: (unsavedFloorIds: readonly string[]) => void): () => void;
  dispose(): void;
}

interface LayerWrite {
  readonly baseVersion: number;
  readonly body: FloorLayerWriteBody;
}

interface FloorFailure {
  readonly error: unknown;
  readonly kind: LayerSaveErrorClass;
}

/**
 * Bộ lưu lớp DUY NHẤT của một người–dự án (F-04x-1 bước 4). Không đọc N16: base là
 * `max(revision lượt thành công gần nhất, readRevision)` — revision của chính lượt đọc
 * đã sinh đồ thị trong kho, nên sửa của người khác sau lượt đọc ấy ra 409 thay vì bị đè.
 * Lỗi tạm giữ nguyên `{ baseVersion, body }`; lượt sau gửi lại đúng thân ấy trước (C09b).
 */
export function createFloorLayerSaver(projectId: string, ports: FloorLayerSaverPorts): FloorLayerSaver {
  const queue = ports.queue ?? runExclusive;
  const dirty = new Set<string>();
  const dimensionsDirty = new Set<string>();
  const held = new Map<string, LayerWrite>();
  const inFlight = new Map<string, Promise<FloorFailure | undefined>>();
  const blocks = new Map<string, LayerSaveBlock>();
  /** Lỗi đã sinh ra khối — `saveScale` ném lại nó thay vì gửi. */
  const blockErrors = new Map<string, unknown>();
  const revisions = new Map<string, number>();
  /** Lượt `saveScale` đang bay — lỗi của chúng không về engine nào khác ngoài `flush` đang chờ. */
  const scaleTasks = new Set<Promise<FloorFailure | undefined>>();
  const listeners = new Set<(unsavedFloorIds: readonly string[]) => void>();
  let disposed = false;

  const layerBase = (floorId: string): number =>
    Math.max(revisions.get(floorId) ?? 0, ports.readRevision(floorId) ?? 0);

  const sendable = (floorId: string): boolean => dirty.has(floorId) && blocks.get(floorId)?.kind !== 'reload';

  const notify = (): void => {
    const unsaved = [...new Set([...dirty, ...inFlight.keys(), ...held.keys(), ...blocks.keys()])];

    listeners.forEach((listener) => listener(unsaved));
  };

  const send = async (floorId: string, write: LayerWrite, laterPending: boolean): Promise<FloorFailure | undefined> => {
    // Khối [6]: thân sai hợp đồng thì không gửi — gửi đi chỉ tiêu một `baseVersion` để nhận 422.
    const parsed = FloorLayerWriteSchema.safeParse(write);
    const scaleSent = write.body.scaleMillimetresPerPixel !== undefined;
    let error: unknown;
    let kind: LayerSaveErrorClass = 'blocked';

    if (!parsed.success) {
      // Lỗi hình dây 422, không phải `ZodError`: lỗi không đọc được bị coi là tạm thời,
      // và engine sẽ thử lại 5/15/45 s một thân không bao giờ hợp lệ.
      const invalid: HttpError = { code: 'VALIDATION', kind: 'http', raw: parsed.error.issues, requestId: '', retryable: false, status: 422 };

      error = invalid;
    } else {
      try {
        const result = await ports.writeLayer({ ...write, floorId, projectId });

        if (result.ok) {
          const redirtied = laterPending || dirty.has(floorId);

          revisions.set(floorId, result.data.revision);
          blocks.delete(floorId);
          blockErrors.delete(floorId);

          if (scaleSent && redirtied) {
            // Máy chủ vừa quy đổi lại mm theo tỉ lệ mới; sửa đang chờ còn ở tỉ lệ cũ — gửi là đè.
            blocks.set(floorId, { kind: 'reload', message: LAYER_SAVE_MESSAGES.scaleRedirtied });
            blockErrors.set(floorId, new Error(LAYER_SAVE_MESSAGES.scaleRedirtied));
          }

          if (!disposed) {
            ports.onSaved(floorId, result.data, scaleSent ? { redirtied, scaleSent } : { redirtied });
          }

          return undefined;
        }

        error = result.error;
      } catch (thrown) {
        error = thrown;
      }

      kind = classifyLayerSaveError(error);
    }

    if (kind === 'temporary') {
      // Thân tỉ lệ không được giữ: màn đã báo hỏng, tự gửi lại về sau là ghi điều người dùng không thấy.
      if (!scaleSent) {
        held.set(floorId, write);
      } else if (write.body.layer) {
        dirty.add(floorId);

        if (write.body.dimensions) {
          dimensionsDirty.add(floorId);
        }
      }
    } else if (!scaleSent || write.body.layer) {
      // Thân chỉ tỉ lệ hỏng không khoá lớp: lỗi về tay màn đã bấm áp.
      blocks.set(floorId, { kind, message: blockMessageOf(kind, error, parsed.success ? undefined : write.body) });
      blockErrors.set(floorId, error);
    }

    return { error, kind };
  };

  const run = async (
    floorId: string,
    first: LayerWrite | undefined,
    layer: SpatialLayer | null,
    dimensions: readonly Dimension[] | null,
  ): Promise<FloorFailure | undefined> => {
    if (first) {
      const failure = await send(floorId, first, layer !== null);

      if (failure) {
        // Thân mới chưa gửi: lượt sau chụp lại từ kho. Khối thì chờ `markDirty`/`discardFloor`.
        if (failure.kind === 'temporary' && layer) {
          dirty.add(floorId);

          if (dimensions) {
            dimensionsDirty.add(floorId);
          }
        }

        return failure;
      }
    }

    if (!layer) {
      return undefined;
    }

    return send(
      floorId,
      { baseVersion: layerBase(floorId), body: dimensions ? { dimensions: [...dimensions], layer } : { layer } },
      false,
    );
  };

  /** Chụp ĐỒNG BỘ bản giữ và lớp của tầng; không có gì để gửi thì trả `undefined`. */
  const flushFloor = (floorId: string): Promise<FloorFailure | undefined> | undefined => {
    const first = held.get(floorId);
    // `readLayer` null (kho thiếu tầng) → giữ bẩn, không PUT: một PUT rỗng xoá sạch tầng.
    const layer = sendable(floorId) ? withSendableNames(ports.readLayer(floorId)) : null;

    if (!first && !layer) {
      return undefined;
    }

    held.delete(floorId);

    const dimensions = layer && dimensionsDirty.has(floorId) ? (ports.readDimensions?.(floorId) ?? null) : null;

    if (layer) {
      dirty.delete(floorId);
      dimensionsDirty.delete(floorId);
    }

    return track(floorId, () => run(floorId, first, layer, dimensions));
  };

  /** Chạy `task` dưới khoá tầng, tính nó vào "đang gửi" tới khi xong. */
  const track = (floorId: string, task: () => Promise<FloorFailure | undefined>): Promise<FloorFailure | undefined> => {
    const settled = queue(`layer:${projectId}:${floorId}`, task).finally(() => {
      if (inFlight.get(floorId) === settled) {
        inFlight.delete(floorId);
      }

      notify();
    });

    inFlight.set(floorId, settled);

    return settled;
  };

  /** Thân của `saveScale`, chụp TRONG khoá tầng — sau mọi PUT lớp đang bay của tầng ấy. */
  const scaleWrite = (
    floorId: string,
    ratio: number,
    evidence: ScaleEvidence,
    hint: number | undefined,
  ): Promise<FloorFailure | undefined> => {
    const block = blocks.get(floorId);

    if (block) {
      return Promise.resolve({ error: blockErrors.get(floorId) ?? new Error(block.message), kind: block.kind });
    }

    const pending = held.get(floorId);
    const fresh = sendable(floorId) ? withSendableNames(ports.readLayer(floorId)) : null;
    const layer = fresh ?? pending?.body.layer;
    const freshDimensions = fresh && dimensionsDirty.has(floorId) ? (ports.readDimensions?.(floorId) ?? null) : null;
    const dimensions = freshDimensions ?? pending?.body.dimensions;

    held.delete(floorId);

    if (layer) {
      dirty.delete(floorId);
      dimensionsDirty.delete(floorId);

      // Bản giữ mang base của lần chụp; lượt hỏng tạm không đổi revision nên hai số bằng nhau.
      return send(
        floorId,
        { baseVersion: pending?.baseVersion ?? layerBase(floorId), body: { ...(dimensions ? { dimensions: [...dimensions] } : {}), layer, scaleMillimetresPerPixel: ratio, scaleEvidence: evidence } },
        false,
      );
    }

    return send(
      floorId,
      { baseVersion: Math.max(layerBase(floorId), hint ?? 0), body: { scaleMillimetresPerPixel: ratio, scaleEvidence: evidence } },
      false,
    );
  };

  return {
    blockedFloorIds: () => [...blocks.keys()],
    discardFloor(floorId) {
      dirty.delete(floorId);
      dimensionsDirty.delete(floorId);
      held.delete(floorId);
      blocks.delete(floorId);
      blockErrors.delete(floorId);
      notify();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
    async flush() {
      if (disposed) {
        return;
      }

      const waiting = [...inFlight.entries()];
      const sent = [...new Set([...dirty, ...held.keys()])].map(flushFloor);

      notify();

      // PUT lớp + tỉ lệ của `saveScale` đang bay hỏng tạm và trả tầng về bẩn: flush không
      // được báo "đã lưu" — engine phải thử lại theo lịch (review-1 P2-3). Lỗi của một flush
      // khác thì flush ấy tự báo, không tính lại ở đây.
      const waited = await Promise.all(
        waiting.map(async ([floorId, settled]) => {
          const fromScale = scaleTasks.has(settled);
          const failure = await settled;
          const redirtied = dirty.has(floorId) || held.has(floorId);

          return fromScale && failure?.kind === 'temporary' && redirtied ? failure : undefined;
        }),
      );
      const failures = [...waited, ...(await Promise.all(sent))].filter((failure) => failure !== undefined);
      const failure = failures.find(({ kind }) => kind === 'temporary') ?? failures[0];

      if (failure) {
        throw failure.error;
      }
    },
    getBlock: (floorId) => blocks.get(floorId) ?? null,
    async saveScale(floorId, ratio, evidence, hint) {
      const settled = track(floorId, () => scaleWrite(floorId, ratio, evidence, hint));

      scaleTasks.add(settled);
      const failure = await settled.finally(() => scaleTasks.delete(settled));

      if (failure) {
        throw failure.error;
      }
    },
    hasDirty: () => held.size > 0 || inFlight.size > 0 || [...dirty].some(sendable),
    markDirty(floorIds, dimensionFloorIds = []) {
      floorIds.forEach((floorId) => dirty.add(floorId));
      dimensionFloorIds.forEach((floorId) => dimensionsDirty.add(floorId));
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
