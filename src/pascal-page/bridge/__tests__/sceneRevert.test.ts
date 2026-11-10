import { describe, expect, it } from 'vitest';

import { isEmptyChange, nodeChangesTo } from '../sceneRevert';

const level = { id: 'level_1', type: 'level', parentId: null, children: ['wall_1', 'door_1'] };
const wall = { id: 'wall_1', type: 'wall', parentId: 'level_1', thickness: 0.2, children: [] };
const door = { id: 'door_1', type: 'door', parentId: 'level_1', width: 0.9 };

describe('nodeChangesTo — đặt lại cảnh bằng phần chênh, không setScene cả cây', () => {
  it('cảnh đã khớp (kể cả khi node hiện tại có thêm trường mặc định): không đổi gì', () => {
    const filled = { level_1: level, wall_1: { ...wall, visible: true, frontSide: 'unknown' }, door_1: door };

    expect(isEmptyChange(nodeChangesTo(filled, { level_1: level, wall_1: wall, door_1: door }))).toBe(true);
  });

  it('cửa vừa xoá bị từ chối: chỉ tạo lại đúng cửa ấy, dưới đúng cha', () => {
    const changes = nodeChangesTo({ level_1: { ...level, children: ['wall_1'] }, wall_1: wall }, { level_1: level, wall_1: wall, door_1: door });

    expect(changes.create).toEqual([{ node: door, parentId: 'level_1' }]);
    expect(changes.update.map((item) => item.id)).toEqual(['level_1']);
    expect(changes.delete).toEqual([]);
  });

  it('vạch đo cục bộ (không có trong cảnh dựng từ kho) được giữ, vẫn nằm trong children của tầng', () => {
    const measure = { id: 'measurement_1', type: 'measurement', parentId: 'level_1' };
    const changes = nodeChangesTo(
      { level_1: { ...level, children: ['wall_1', 'door_1', 'measurement_1'] }, wall_1: wall, door_1: door, measurement_1: measure },
      { level_1: level, wall_1: wall, door_1: door },
    );

    expect(changes.delete).toEqual([]);
    expect(isEmptyChange(changes)).toBe(true);
  });

  it('node sửa ma được trả về; node lạ bị xoá, chỉ gốc của cành (vendor xoá kéo theo con)', () => {
    const extraParent = { id: 'slab_x', type: 'slab', parentId: 'level_1', children: ['item_y'] };
    const extraChild = { id: 'item_y', type: 'item', parentId: 'slab_x' };
    const changes = nodeChangesTo(
      { level_1: level, wall_1: { ...wall, thickness: 0.4 }, door_1: door, slab_x: extraParent, item_y: extraChild },
      { level_1: level, wall_1: wall, door_1: door },
    );

    expect(changes.update).toEqual([{ id: 'wall_1', data: wall }]);
    expect(changes.delete).toEqual(['slab_x']);
  });

  it('tạo cả cành: cha trước con', () => {
    const lamp = { id: 'item_lamp', type: 'item', parentId: 'ceiling_1' };
    const ceiling = { id: 'ceiling_1', type: 'ceiling', parentId: 'level_1', children: ['item_lamp'] };
    const changes = nodeChangesTo({ level_1: level }, { level_1: level, item_lamp: lamp, ceiling_1: ceiling });

    expect(changes.create.map((item) => item.node.id)).toEqual(['ceiling_1', 'item_lamp']);
  });

  it('xoá giường bị từ chối: chỉ tạo lại giường; đồ bày sẵn và sàn/trần tự sinh (autoFromWalls) giữ nguyên', () => {
    const bed = { id: 'item_F-BED', type: 'item', parentId: 'level_1', children: ['item_DRESS-pillow-R-1'] };
    const pillow = { id: 'item_DRESS-pillow-R-1', type: 'item', parentId: 'item_F-BED' };
    const sofa = { id: 'item_DRESS-sofa-R-1', type: 'item', parentId: 'level_1' };
    const autoSlab = { id: 'slab_auto', type: 'slab', parentId: 'level_1', autoFromWalls: true };
    const autoCeiling = { id: 'ceiling_auto', type: 'ceiling', parentId: 'level_1', autoFromWalls: true, children: [] };
    const target = {
      level_1: { ...level, children: ['wall_1', 'item_F-BED', 'item_DRESS-sofa-R-1'] },
      wall_1: wall,
      'item_F-BED': bed,
      'item_DRESS-pillow-R-1': pillow,
      'item_DRESS-sofa-R-1': sofa,
    };
    const current = {
      level_1: { ...level, children: ['wall_1', 'item_DRESS-sofa-R-1', 'slab_auto', 'ceiling_auto'] },
      wall_1: wall,
      'item_DRESS-sofa-R-1': { ...sofa, visible: true },
      slab_auto: autoSlab,
      ceiling_auto: autoCeiling,
    };
    const changes = nodeChangesTo(current, target);

    expect(changes.create.map(({ node }) => node.id)).toEqual(['item_F-BED', 'item_DRESS-pillow-R-1']);
    expect(changes.delete).toEqual([]);
    expect(changes.update).toEqual([
      { id: 'level_1', data: { ...target.level_1, children: [...target.level_1.children, 'slab_auto', 'ceiling_auto'] } },
    ]);
  });

  it('sàn tự sinh đã có trong children của tầng: không sửa tầng', () => {
    const autoSlab = { id: 'slab_auto', type: 'slab', parentId: 'level_1', autoFromWalls: true };
    const changes = nodeChangesTo(
      { level_1: { ...level, children: ['wall_1', 'door_1', 'slab_auto'] }, wall_1: wall, door_1: door, slab_auto: autoSlab },
      { level_1: level, wall_1: wall, door_1: door },
    );

    expect(isEmptyChange(changes)).toBe(true);
  });
});
