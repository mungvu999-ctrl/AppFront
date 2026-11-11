import { BoxGeometry, DataTexture, FileLoader, FloatType, Group, Mesh, RGBAFormat, Scene, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRealism } from './store';
import { WIN_URL, winViewReport } from './winView';

// HDRLoader giả: đếm lượt giải mã, trả ảnh float 4×2 đồng bộ.
const decodes = vi.hoisted(() => ({ n: 0 }));
vi.mock('three/addons/loaders/HDRLoader.js', () => ({
  HDRLoader: class {
    setDataType() {
      return this;
    }
    load(_url: string, onLoad: (t: DataTexture) => void) {
      decodes.n++;
      onLoad(new DataTexture(new Float32Array(4 * 2 * 4).fill(1), 4, 2, RGBAFormat, FloatType));
    }
  },
}));

const { installHdri } = await import('./lighting-hdri');
const { syncWinInside } = await import('./reflect');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Một tầng 10×8 m, tường cao 3 m (hai tường đối diện đủ cho hộp bao). */
function registry() {
  const level = new Group();
  const walls = [new Vector3(5, 1.5, 0.1), new Vector3(5, 1.5, 7.9)].map((at) => {
    const m = new Mesh(new BoxGeometry(10, 3, 0.2));
    m.position.copy(at);
    level.add(m);
    return m;
  });
  level.updateMatrixWorld(true);
  const nodes = new Map<string, Group | Mesh>([['L', level], ['w1', walls[0]!], ['w2', walls[1]!]]);
  return { nodes, byType: { level: new Set(['L']), wall: new Set(['w1', 'w2']) } } as unknown as Parameters<typeof syncWinInside>[1];
}

describe('phông cửa sổ tải lười (review N2)', () => {
  const fetchMock = vi.spyOn(FileLoader.prototype, 'loadAsync').mockImplementation(async () => new ArrayBuffer(8));
  const sunsetFetches = () => fetchMock.mock.calls.filter(([url]) => url === WIN_URL.sunset).length;

  beforeEach(() => {
    URL.createObjectURL ??= () => 'blob:x';
    URL.revokeObjectURL ??= () => {};
    useRealism.setState({ backend: 'webgpu', tier: 'high' });
    decodes.n = 0;
    fetchMock.mockClear();
  });
  afterEach(() => useRealism.setState({ backend: 'unknown' }));

  it('toàn cảnh ngoài nhà → không tải; vào nhà → tải đúng một lần; cài lại effect → không tải lại', async () => {
    const reg = registry();
    const scene = new Scene();
    // Mặc định auto + Buổi tối → sunset, scope inside.
    let undo = installHdri(scene, 'dark', 'night');
    syncWinInside(new Vector3(5, 20, 4), reg); // trên mái
    syncWinInside(new Vector3(30, 1.6, 4), reg); // ngoài mặt bằng
    await flush();
    expect(sunsetFetches()).toBe(0);
    expect(winViewReport()).toMatchObject({ mode: 'sunset', requested: false, loaded: false });

    syncWinInside(new Vector3(5, 1.6, 4), reg); // vào phòng
    syncWinInside(new Vector3(6, 1.6, 4), reg);
    await flush();
    await flush();
    expect(sunsetFetches()).toBe(1);
    expect(decodes.n).toBe(1);
    expect(winViewReport()).toMatchObject({ requested: true, loaded: true, inside: true, active: true });

    // Effect cài lại (cleanup rồi cài đồng bộ, như React) → dùng cache, không tải/giải mã lại.
    undo();
    undo = installHdri(scene, 'dark', 'night');
    syncWinInside(new Vector3(5, 1.6, 4), reg);
    await flush();
    await flush();
    expect(sunsetFetches()).toBe(1);
    expect(decodes.n).toBe(1);
    expect(winViewReport()).toMatchObject({ requested: true, loaded: true });

    // Rời trang (không ai cài lại) → giải phóng; lần mở sau phải đợi vào nhà và giải mã lại.
    undo();
    await flush();
    undo = installHdri(scene, 'dark', 'night');
    expect(winViewReport().requested).toBe(false);
    syncWinInside(new Vector3(5, 1.6, 4), reg);
    await flush();
    await flush();
    expect(decodes.n).toBe(2);
    undo();
    await flush();
  });

  it('chủ đề sáng (auto không áp) → không bao giờ yêu cầu', async () => {
    const undo = installHdri(new Scene(), 'light', 'studio');
    syncWinInside(new Vector3(5, 1.6, 4), registry());
    await flush();
    expect(decodes.n).toBe(0);
    undo();
  });
});
