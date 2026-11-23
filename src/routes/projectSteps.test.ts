/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { ROUTES } from './paths';
import { isFloorEditorPath, PROJECT_STEPS, projectLocationOf, projectScreenTitleOf, projectStepStates } from './projectSteps';

describe('projectLocationOf', () => {
  it.each([
    [ROUTES.project.upload('p1'), 0],
    [ROUTES.project.quality('p1'), 0],
    [ROUTES.project.drawingSets('p1'), 0],
    [ROUTES.project.drawingSets('p1', 'dws_1'), 0],
    [ROUTES.project.pipelineGraph('p1'), 1],
    [ROUTES.project.floors('p1'), 2],
    [ROUTES.project.measure('p1'), 3],
    [ROUTES.project.ruleSettings('p1'), 4],
    [ROUTES.project.versions('p1'), -1],
    [ROUTES.project.data('p1'), -1],
    [ROUTES.project.settings('p1'), -1],
  ])('%s → bước %i', (path, stepIndex) => {
    expect(projectLocationOf(path)).toEqual({ projectId: 'p1', stepIndex });
  });

  it('trong tầng: kèm mã tầng và lớp đang duyệt', () => {
    expect(projectLocationOf(ROUTES.project.objects('p1', 'f1'))).toEqual({ projectId: 'p1', stepIndex: 2, floorId: 'f1', layerIndex: 1 });
    expect(projectLocationOf(ROUTES.project.scale('p1', 'f1'))).toEqual({ projectId: 'p1', stepIndex: 2, floorId: 'f1', layerIndex: -1 });
  });

  it('đường lạ trong dự án (404) thì không có thanh bước', () => {
    expect(projectLocationOf('/projects/p1')).toBeNull();
    expect(projectLocationOf('/projects/p1/khong-co')).toBeNull();
  });

  it('ngoài dự án thì không có bước', () => {
    expect(projectLocationOf(ROUTES.dashboard)).toBeNull();
    expect(projectLocationOf(ROUTES.account)).toBeNull();
  });

  it('mỗi bước trỏ về chính nó', () => {
    PROJECT_STEPS.forEach((step, index) => {
      expect(projectLocationOf(step.path('p1'))?.stepIndex).toBe(index);
    });
  });

  it('trạng thái bước chỉ khẳng định điều dữ liệu cho biết chắc', () => {
    expect(projectStepStates({ hasDrawings: true, status: 'draft' })).toEqual(['done', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(projectStepStates({ hasDrawings: false, status: 'error' }).slice(0, 2)).toEqual(['attention', 'attention']);
    expect(projectStepStates({ hasDrawings: true, status: 'approved' })).toEqual(['done', 'done', 'done', 'done', 'todo', 'todo']);
    expect(projectStepStates({})).toEqual(['todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
    // Bước 2 xong khi lượt xử lý cuối đã xong, không đợi dự án duyệt.
    expect(projectStepStates({ hasDrawings: true, status: 'draft', hasProcessedFloor: true }).slice(0, 3)).toEqual(['done', 'done', 'todo']);
    // U11: dự án đã duyệt mà còn tầng có bản vẽ nhưng trống thì bước duyệt chưa xong.
    expect(projectStepStates({ hasDrawings: true, status: 'approved', everyDrawnFloorProcessed: false }).slice(2, 4)).toEqual(['attention', 'attention']);
  });

  it('tên màn cho tiêu đề tab', () => {
    expect(projectScreenTitleOf(ROUTES.project.walls('p1', 'f1'))).toBe('Duyệt tường');
    expect(projectScreenTitleOf(ROUTES.project.grids('p1', 'f1'))).toBe('Trục và gốc toạ độ');
    expect(projectScreenTitleOf(ROUTES.project.scale('p1', 'f1'))).toBe('Tỷ lệ bản vẽ');
    expect(projectScreenTitleOf(ROUTES.project.overlay('p1', 'f1'))).toBe('So với bản vẽ');
    expect(projectScreenTitleOf(ROUTES.project.quality('p1'))).toBe('Chất lượng ảnh đầu vào');
    expect(projectScreenTitleOf(ROUTES.project.settings('p1'))).toBe('Cài đặt dự án');
    expect(projectScreenTitleOf(ROUTES.project.pipelineGraph('p1'))).toBe('Sơ đồ xử lý');
    expect(projectScreenTitleOf(ROUTES.project.upload('p1'))).toBe('Tải bản vẽ');
    expect(projectScreenTitleOf(ROUTES.dashboard)).toBeNull();
  });
});

describe('isFloorEditorPath', () => {
  it('chỉ bốn màn duyệt tầng dạng trình biên tập', () => {
    for (const path of [ROUTES.project.scale('p1', 'f1'), ROUTES.project.walls('p1', 'f1'), ROUTES.project.objects('p1', 'f1'), `${ROUTES.project.rooms('p1', 'f1')}/`]) {
      expect(isFloorEditorPath(path)).toBe(true);
    }
    for (const path of [
      ROUTES.project.floors('p1'),
      ROUTES.project.grids('p1', 'f1'),
      ROUTES.project.dimensions('p1', 'f1'),
      ROUTES.project.thickness('p1', 'f1'),
      ROUTES.project.overlay('p1', 'f1'),
      ROUTES.dashboard,
    ]) {
      expect(isFloorEditorPath(path)).toBe(false);
    }
  });
});
