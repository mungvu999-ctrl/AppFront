import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createApiClient } from '../client';
import { decode } from '../schemas/decode';
import {
  FurnitureSchema,
  OpeningSchema,
  RoomSchema,
  SpatialLayerSchema,
  WallSchema,
} from '../schemas/spatial';

/**
 * Hợp đồng dây của lớp không gian.
 *
 * Bộ số dùng lại bộ mẫu chuẩn ở chỗ nó có ý nghĩa — `#W-014 · 220 mm · conf 0.71`,
 * `#R-005 · 18,40 m²`, tường cao 3.900 mm — để một người đọc test này nhận ra
 * cùng công trình mà các màn QC đang hiện.
 */

const wall = {
  centreline: { end: { x: 4800, y: 0 }, start: { x: 0, y: 0 } },
  confidence: 0.71,
  heightMm: 3900,
  id: 'W-WALL0014',
  kind: 'partition',
  levelId: 'L-LEVEL01',
  openingIds: ['D-DOOR0007'],
  reviewed: false,
  source: 'ai',
  thicknessMm: 220,
} as const;

const opening = {
  confidence: 0.83,
  heightMm: 2200,
  id: 'D-DOOR0007',
  kind: 'door',
  offsetMm: 1200,
  reviewed: false,
  sillHeightMm: 0,
  source: 'ai',
  swing: 'left',
  wallId: 'W-WALL0014',
  widthMm: 900,
} as const;

const room = {
  areaM2: 18.4,
  confidence: 1,
  id: 'R-ROOM0005',
  levelId: 'L-LEVEL01',
  name: 'Phòng khách',
  outline: [
    { x: 0, y: 0 },
    { x: 4800, y: 0 },
    { x: 4800, y: 3600 },
  ],
  reviewed: true,
  source: 'human',
  usage: 'livingRoom',
  wallIds: ['W-WALL0014'],
} as const;

const furniture = {
  boundingBox: { max: { x: 2400, y: 1500 }, min: { x: 0, y: 0 } },
  centre: { x: 1200, y: 750 },
  confidence: 0.9,
  id: 'F-FURN0012',
  kind: 'chair',
  levelId: 'L-LEVEL01',
  reviewed: false,
  rotationDeg: 90,
  source: 'ai',
} as const;

const layer = {
  furniture: [furniture],
  openings: [opening],
  rooms: [room],
  walls: [wall],
} as const;

describe('SpatialLayerSchema', () => {
  it('nhận một lớp không gian đầy đủ và trả về bốn danh sách', () => {
    const parsed = SpatialLayerSchema.safeParse(layer);

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      return;
    }

    expect(parsed.data.walls).toHaveLength(1);
    expect(parsed.data.openings).toHaveLength(1);
    expect(parsed.data.rooms).toHaveLength(1);
    expect(parsed.data.furniture).toHaveLength(1);
    expect(parsed.data.walls[0]?.thicknessMm).toBe(220);
  });

  it('từ chối khoá ngoài hợp đồng thay vì lặng lẽ bỏ qua', () => {
    const parsed = SpatialLayerSchema.safeParse({ ...layer, levels: [] });

    expect(parsed.success).toBe(false);
  });
});

describe('A5 — máy không được tự nhận đã duyệt', () => {
  it.each([
    ['tường', WallSchema, wall],
    ['ô mở', OpeningSchema, opening],
    ['phòng', RoomSchema, room],
    ['đồ đạc', FurnitureSchema, furniture],
  ])('từ chối %s mang source ai kèm reviewed true', (_label, schema, entity) => {
    expect(schema.safeParse({ ...entity, reviewed: true, source: 'ai' }).success).toBe(false);
  });

  it('vẫn nhận đúng hai tổ hợp hợp lệ', () => {
    expect(WallSchema.safeParse({ ...wall, reviewed: false, source: 'ai' }).success).toBe(true);
    expect(WallSchema.safeParse({ ...wall, reviewed: true, source: 'human' }).success).toBe(true);
  });

  it('nhận cả mục người đã xem nhưng chưa duyệt', () => {
    expect(WallSchema.safeParse({ ...wall, reviewed: false, source: 'human' }).success).toBe(true);
  });
});

describe('Hình học không suy ra được từ kiểu', () => {
  it('từ chối bức tường dài 0 mm', () => {
    const zeroLength = {
      ...wall,
      centreline: { end: { x: 0, y: 0 }, start: { x: 0, y: 0 } },
    };

    expect(WallSchema.safeParse(zeroLength).success).toBe(false);
  });

  it('từ chối độ dày 0 và độ dày âm', () => {
    expect(WallSchema.safeParse({ ...wall, thicknessMm: 0 }).success).toBe(false);
    expect(WallSchema.safeParse({ ...wall, thicknessMm: -220 }).success).toBe(false);
  });

  it('từ chối milimét thập phân — quy đổi đơn vị phải đi qua domain/units', () => {
    expect(WallSchema.safeParse({ ...wall, thicknessMm: 219.5 }).success).toBe(false);
  });

  it('từ chối hộp bao lộn trong ra ngoài', () => {
    const inverted = {
      ...furniture,
      boundingBox: { max: { x: 0, y: 0 }, min: { x: 2400, y: 1500 } },
    };

    expect(FurnitureSchema.safeParse(inverted).success).toBe(false);
  });

  it('từ chối đường bao phòng dưới ba điểm', () => {
    const twoPoints = {
      ...room,
      outline: [
        { x: 0, y: 0 },
        { x: 4800, y: 0 },
      ],
    };

    expect(RoomSchema.safeParse(twoPoints).success).toBe(false);
  });

  it('từ chối góc xoay 360 độ, nhận 0 và 359', () => {
    expect(FurnitureSchema.safeParse({ ...furniture, rotationDeg: 360 }).success).toBe(false);
    expect(FurnitureSchema.safeParse({ ...furniture, rotationDeg: 0 }).success).toBe(true);
    expect(FurnitureSchema.safeParse({ ...furniture, rotationDeg: 359 }).success).toBe(true);
  });

  it('từ chối độ tin cậy ngoài khoảng 0..1', () => {
    expect(WallSchema.safeParse({ ...wall, confidence: 1.2 }).success).toBe(false);
    expect(WallSchema.safeParse({ ...wall, confidence: -0.1 }).success).toBe(false);
  });
});

/**
 * Ghim lại một quyết định, không chỉ một hành vi.
 *
 * Biên giới cố ý KHÔNG dùng `isIdOfKind`: nó mô tả bộ sinh mã của chính chúng
 * ta, còn máy chủ sinh mã theo lệ của nó. Không có bài kiểm này thì "siết cho
 * chặt" là một thay đổi trông hợp lý, và nó sẽ lặng lẽ từ chối cả bộ mẫu QC lẫn
 * hợp đồng trong đặc tả nghiên cứu.
 */
describe('Mã thực thể trên dây', () => {
  it('nhận mã ngắn kiểu bộ mẫu QC (M-001, W-001)', () => {
    expect(WallSchema.safeParse({ ...wall, id: 'W-001' }).success).toBe(true);
  });

  it('nhận mã không tiền tố của hợp đồng Spatial JSON (w1, win1, r1)', () => {
    expect(WallSchema.safeParse({ ...wall, id: 'w1', openingIds: ['win1'] }).success).toBe(true);
    expect(RoomSchema.safeParse({ ...room, id: 'r1', wallIds: ['w1'] }).success).toBe(true);
  });

  it('từ chối mã rỗng', () => {
    expect(WallSchema.safeParse({ ...wall, id: '' }).success).toBe(false);
  });
});

describe('Trường tuỳ chọn', () => {
  it('bỏ hẳn khoá roomId khi nó vắng mặt, không đặt undefined', () => {
    const parsed = FurnitureSchema.safeParse(furniture);

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      return;
    }

    expect('roomId' in parsed.data).toBe(false);
  });

  it('giữ roomId khi nó có mặt', () => {
    const parsed = FurnitureSchema.safeParse({ ...furniture, roomId: 'R-ROOM0005' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.roomId).toBe('R-ROOM0005');
  });
});

describe('Loại đồ đạc mới của YOLO: máy giặt, buồng tắm đứng', () => {
  it('enum kind nhận washingMachine và shower, vẫn từ chối loại lạ', () => {
    expect(FurnitureSchema.safeParse({ ...furniture, kind: 'washingMachine' }).success).toBe(true);
    expect(FurnitureSchema.safeParse({ ...furniture, kind: 'shower' }).success).toBe(true);
    expect(FurnitureSchema.safeParse({ ...furniture, kind: 'washer' }).success).toBe(false);
  });

  it('lớp không gian chứa cả hai loại đi nguyên vẹn qua schema', () => {
    const washer = { ...furniture, id: 'F-FURN0013', kind: 'washingMachine' } as const;
    const shower = { ...furniture, id: 'F-FURN0014', kind: 'shower' } as const;
    const parsed = SpatialLayerSchema.parse({ ...layer, furniture: [washer, shower] });

    expect(parsed.furniture).toStrictEqual([washer, shower]);
    expect(SpatialLayerSchema.parse(parsed)).toStrictEqual(parsed);
  });
});

describe('decode dịch lỗi hợp đồng sang tiếng Việt', () => {
  it('nêu tên trường thiếu bằng câu người đọc được', () => {
    const withoutThickness: Record<string, unknown> = { ...wall };
    delete withoutThickness.thicknessMm;

    const result = decode(WallSchema, withoutThickness, 'spatial.writeLayer');

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('CONTRACT_VALIDATION');
    expect(String(result.error.params?.message)).toContain('thicknessMm');
  });
});

/**
 * Hành vi đổi ở `client.ts`: trước lượt này, một phản hồi hỏng đi thẳng qua
 * `writeLayer` và chỉ vỡ khi màn đọc tới nó.
 */
describe('spatial.writeLayer', () => {
  const httpError: HttpError = {
    kind: 'http',
    raw: undefined,
    requestId: 'req-spatial-1',
    retryable: false,
    status: 500,
  };

  const createHttp = (response: unknown): HttpClient =>
    ({
      del: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      post: vi.fn(),
      put: vi.fn(() => ({ data: { layer: response, revision: 2 }, ok: true }) as Result<unknown, HttpError>),
    }) as unknown as HttpClient;

  it('trả về lớp đã giải mã khi phản hồi đúng hợp đồng', async () => {
    const client = createApiClient(createHttp(layer));

    const result = await client.spatial.writeLayer({
      baseVersion: 1,
      body: { layer },
      floorId: 'L-LEVEL01',
      projectId: 'p-1',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.layer.walls).toHaveLength(1);
    expect(result.ok && result.data.revision).toBe(2);
  });

  it('A3 — mọi lượt PUT lớp xin keepalive, để lượt đang bay sống qua lúc rời trang', async () => {
    const http = createHttp(layer);

    await createApiClient(http).spatial.writeLayer({ baseVersion: 1, body: { layer }, floorId: 'L-LEVEL01', projectId: 'p-1' });

    expect(http.put).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ keepalive: true }));
  });

  it('biến phản hồi hỏng thành lỗi hợp đồng thay vì để nó đi tiếp', async () => {
    const client = createApiClient(createHttp({ ...layer, walls: [{ ...wall, thicknessMm: 0 }] }));

    const result = await client.spatial.writeLayer({
      baseVersion: 1,
      body: { layer },
      floorId: 'L-LEVEL01',
      projectId: 'p-1',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('CONTRACT_VALIDATION');
  });

  it('giữ nguyên lỗi tầng vận chuyển, không đổi nó thành lỗi hợp đồng', async () => {
    const http = {
      del: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      post: vi.fn(),
      put: vi.fn(() => ({ error: httpError, ok: false }) as Result<unknown, HttpError>),
    } as unknown as HttpClient;

    const result = await createApiClient(http).spatial.writeLayer({
      baseVersion: 1,
      body: { layer },
      floorId: 'L-LEVEL01',
      projectId: 'p-1',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('http');
  });
});

describe('FIX-P0-01 — cờ edited tuỳ chọn trên mọi thực thể', () => {
  it.each([
    ['tường', WallSchema, wall],
    ['ô mở', OpeningSchema, opening],
    ['phòng', RoomSchema, room],
    ['đồ đạc', FurnitureSchema, furniture],
  ])('%s: có edited giữ nguyên giá trị, không có edited vẫn giải được', (_label, schema, entity) => {
    const withTrue = schema.safeParse({ ...entity, edited: true });
    const withFalse = schema.safeParse({ ...entity, edited: false });

    expect(withTrue.success && (withTrue.data as { edited?: boolean }).edited).toBe(true);
    expect(withFalse.success && (withFalse.data as { edited?: boolean }).edited).toBe(false);
    expect(schema.safeParse(entity).success).toBe(true);
  });

  it('tài liệu lớp có edited trên các thực thể vẫn giải được', () => {
    const edited = {
      furniture: [{ ...furniture, edited: true }],
      openings: [{ ...opening, edited: true }],
      rooms: [{ ...room, edited: true }],
      walls: [{ ...wall, edited: true }],
    };

    expect(SpatialLayerSchema.safeParse(edited).success).toBe(true);
  });

  it('edited không phải boolean thì bị từ chối', () => {
    expect(WallSchema.safeParse({ ...wall, edited: 'yes' }).success).toBe(false);
  });
});
