import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import {
  createDraftSlice,
  draftEntityId,
  type CreateEntityDraft,
  type DraftOperation,
  type DraftSlice,
  type EditEntityDraft,
} from '../draftSlice';
import { deriveActionName } from '../devtools';
import { createProjectSlice, type ProjectSlice } from '../projectSlice';
import { createSpatialSlice, type SpatialSlice } from '../spatialSlice';
import { graphVersionOf } from '../../lib/versioning/graphVersion';
import { useStore } from '../index';
import { readEntity } from '../../domain/spatial/applyPatch';
import { normalizeSpatial } from '../../domain/spatial/normalize';
import type { Furniture, LevelId, SpatialGraph, Wall } from '../../domain/spatial/types';
import type { Project } from '../../types/project';
import {
  createSampleBuilding,
  SAMPLE_LEVEL_COUNT,
} from '../../domain/spatial/__fixtures__/sampleBuilding';

const sampleGraph: SpatialGraph = createSampleBuilding();

const sampleLevelIdAt = (index: number): LevelId => {
  const level = sampleGraph.levels.at(index);

  if (level === undefined) {
    throw new Error(`sample building has no level at index ${index}`);
  }

  return level.id;
};

const firstSampleWall = (): Wall => {
  const wall = sampleGraph.walls.at(0);

  if (wall === undefined) {
    throw new Error('sample building has no walls');
  }

  return wall;
};

/** A wall dragged 100 mm sideways, staged as the whole wall it would become. */
const moveWallDraft = (): EditEntityDraft => {
  const wall = firstSampleWall();

  return {
    kind: 'editEntity',
    entityId: wall.id,
    preview: {
      ...wall,
      centreline: {
        start: { x: wall.centreline.start.x + 100, y: wall.centreline.start.y },
        end: { x: wall.centreline.end.x + 100, y: wall.centreline.end.y },
      },
    },
  };
};

const firstSampleFurniture = (): Furniture => {
  const item = sampleGraph.furniture.at(0);

  if (item === undefined) {
    throw new Error('sample building has no furniture');
  }

  return item;
};

/** The edit a gizmo makes that the old wall-shaped draft had no room for. */
const turnFurnitureDraft = (): EditEntityDraft => {
  const item = firstSampleFurniture();

  return {
    kind: 'editEntity',
    entityId: item.id,
    preview: { ...item, rotationDeg: 90 },
  };
};

const drawWallDraft = (): CreateEntityDraft => ({
  kind: 'createEntity',
  entity: { ...firstSampleWall(), id: 'W-NEWWALLAAA' },
});

const sampleProject = (id: string): Project => ({
  id,
  name: 'Sample project',
  created_at: '2026-08-14T00:00:00Z',
  updated_at: '2026-08-14T00:00:00Z',
  members: [],
});

describe('projectSlice', () => {
  it('holds the open project, its floors, the viewed floor and the user roles', () => {
    const store = create<ProjectSlice>()(createProjectSlice);

    store.getState().setProject(sampleProject('project-1'));
    store.getState().setFloors(sampleGraph.levels);
    store.getState().setActiveFloor(sampleLevelIdAt(0));
    store.getState().setUserRoles(['engineer']);

    const state = store.getState();

    expect(state.project?.id).toBe('project-1');
    expect(state.floors).toHaveLength(SAMPLE_LEVEL_COUNT);
    expect(state.activeFloorId).toBe(sampleLevelIdAt(0));
    expect(state.userRoles).toEqual(['engineer']);
  });

  it('resets floors and the viewed floor when the project changes', () => {
    const store = create<ProjectSlice>()(createProjectSlice);

    store.getState().setProject(sampleProject('project-1'));
    store.getState().setFloors(sampleGraph.levels);
    store.getState().setActiveFloor(sampleLevelIdAt(1));

    store.getState().setProject(sampleProject('project-2'));

    const state = store.getState();

    expect(state.floors).toHaveLength(0);
    expect(state.activeFloorId).toBeNull();
  });
});

describe('spatialSlice', () => {
  it('stores loaded data with its version and ends the loading state', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    const spatial = normalizeSpatial(createSampleBuilding());

    store.getState().setSpatialLoading(true);
    store.getState().setSpatial(spatial, 'v1');

    const state = store.getState();

    expect(state.spatial).toBe(spatial);
    expect(state.versionId).toBe('v1');
    expect(state.spatialLoading).toBe(false);
  });

  it('writes spatial, spatialProjectId, floorMeta and lastServerSpatial in one set', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    const spatial = normalizeSpatial(createSampleBuilding());
    let writes = 0;

    store.subscribe(() => {
      writes += 1;
    });
    store.getState().setSpatial(spatial, 'v1', { projectId: 'p1', floorRevisions: { L1: 4 } });

    const state = store.getState();

    expect(writes).toBe(1);
    expect(state.spatialProjectId).toBe('p1');
    expect(state.floorMeta).toEqual({ L1: { revision: 4 } });
    expect(state.lastServerSpatial).toBe(spatial);

    store.getState().setSpatial(spatial, 'v1');

    expect(store.getState().spatialProjectId).toBeNull();
    expect(store.getState().floorMeta).toEqual({});
    expect(store.getState().versionId).toBe('v1');
  });

  it('derives versionId from floorMeta and carries scaleStatus through setSpatial', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    const spatial = normalizeSpatial(createSampleBuilding());

    store.getState().setSpatial(spatial, 'ver_1', {
      floorRevisions: { L1: 4, L2: 1 },
      floorScaleStatus: { L2: 'unresolved' },
      projectId: 'p1',
    });

    expect(store.getState().floorMeta).toEqual({ L1: { revision: 4 }, L2: { revision: 1, scaleStatus: 'unresolved' } });
    expect(store.getState().versionId).toBe(graphVersionOf({ L1: { revision: 4 }, L2: { revision: 1 } }));
  });

  it('keeps scaleSource only next to scaleStatus (UX-R1 K12)', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);

    store.getState().setSpatial(normalizeSpatial(createSampleBuilding()), 'ver_1', {
      floorRevisions: { L1: 4, L2: 1 },
      floorScaleSource: { L1: 'project_default', L2: 'project_default' },
      floorScaleStatus: { L2: 'unresolved' },
      projectId: 'p1',
    });

    expect(store.getState().floorMeta).toEqual({
      L1: { revision: 4 },
      L2: { revision: 1, scaleSource: 'project_default', scaleStatus: 'unresolved' },
    });
  });

  it('rewrites versionId in the same set as updateFloorMeta', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    let writes = 0;

    store.getState().setVersionId('ver_1');
    store.subscribe(() => {
      writes += 1;
    });
    store.getState().updateFloorMeta('L1', { revision: 2, scaleStatus: 'unresolved' });

    expect(writes).toBe(1);
    expect(store.getState().versionId).toBe(graphVersionOf({ L1: { revision: 2 } }));
  });

  it('replaces a whole floorMeta entry and stores the unsaved floor ids', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);

    store.getState().updateFloorMeta('L1', { revision: 1 });
    store.getState().updateFloorMeta('L2', { revision: 2 });
    store.getState().updateFloorMeta('L1', { revision: 3 });
    store.getState().setUnsavedFloorIds(['L2']);

    expect(store.getState().floorMeta).toEqual({ L1: { revision: 3 }, L2: { revision: 2 } });
    expect(store.getState().unsavedFloorIds).toEqual(['L2']);
  });

  it('ignores patches until data is loaded', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    const wall = firstSampleWall();

    store
      .getState()
      ._applyPatches([{ op: 'update', kind: 'wall', id: wall.id, changes: { thicknessMm: 300 } }]);

    expect(store.getState().spatial).toBeNull();
  });

  it('patches immutably and never mutates the previous snapshot', () => {
    const store = create<SpatialSlice>()(createSpatialSlice);
    const spatial = normalizeSpatial(createSampleBuilding());
    const wall = firstSampleWall();

    store.getState().setSpatial(spatial, 'v1');
    store
      .getState()
      ._applyPatches([
        { op: 'update', kind: 'wall', id: wall.id, changes: { thicknessMm: wall.thicknessMm + 40 } },
      ]);

    const next = store.getState().spatial;

    expect(next).not.toBeNull();
    expect(next).not.toBe(spatial);
    expect(next === null ? null : readEntity(next, 'wall', wall.id)?.thicknessMm).toBe(
      wall.thicknessMm + 40
    );
    expect(readEntity(spatial, 'wall', wall.id)?.thicknessMm).toBe(wall.thicknessMm);
  });
});

describe('draftSlice', () => {
  it('stages, amends and discards operations', () => {
    const store = create<DraftSlice>()(createDraftSlice);
    const draft = moveWallDraft();

    store.getState().stageDraftOperation(draft);
    expect(store.getState().draftOperations).toHaveLength(1);

    const amended: DraftOperation = { ...draft, preview: firstSampleWall() };

    store.getState().amendDraftOperation(0, amended);
    expect(store.getState().draftOperations.at(0)).toBe(amended);

    store.getState().amendDraftOperation(5, draft);
    expect(store.getState().draftOperations).toEqual([amended]);

    store.getState().discardDraft();
    expect(store.getState().draftOperations).toHaveLength(0);
  });

  it('stages an edit to any kind of entity, not only to a wall', () => {
    const store = create<DraftSlice>()(createDraftSlice);

    store.getState().stageDraftOperation(turnFurnitureDraft());
    store.getState().stageDraftOperation(moveWallDraft());
    store.getState().stageDraftOperation(drawWallDraft());

    expect(store.getState().draftOperations.map((operation) => operation.kind)).toEqual([
      'editEntity',
      'editEntity',
      'createEntity',
    ]);
  });

  it('amends the same operation on every frame of a drag, staging one entry', () => {
    const store = create<DraftSlice>()(createDraftSlice);
    const item = firstSampleFurniture();

    store.getState().stageDraftOperation(turnFurnitureDraft());

    // Two hundred pointer frames of turning: one staged operation throughout.
    for (let frame = 1; frame <= 200; frame += 1) {
      store.getState().amendDraftOperation(0, {
        entityId: item.id,
        kind: 'editEntity',
        preview: { ...item, rotationDeg: frame },
      });
    }

    const staged = store.getState().draftOperations;

    expect(staged).toHaveLength(1);

    const only = staged[0];

    expect(only?.kind === 'editEntity' ? only.preview : null).toMatchObject({ rotationDeg: 200 });
  });

  it('names the entity a staged operation is about, whichever kind it is', () => {
    expect(draftEntityId(moveWallDraft())).toBe(firstSampleWall().id);
    expect(draftEntityId(turnFurnitureDraft())).toBe(firstSampleFurniture().id);
    expect(draftEntityId(drawWallDraft())).toBe('W-NEWWALLAAA');
  });
});

describe('draft labels on the devtools timeline', () => {
  const labelFor = (before: readonly DraftOperation[], after: readonly DraftOperation[]): string =>
    deriveActionName({ draftOperations: before }, { draftOperations: after });

  it('names an amendment after the entity kind it touches', () => {
    expect(labelFor([moveWallDraft()], [moveWallDraft()])).toBe('tuong/sua');
    expect(labelFor([turnFurnitureDraft()], [turnFurnitureDraft()])).toBe('do-dac/sua');
    expect(labelFor([drawWallDraft()], [drawWallDraft()])).toBe('tuong/ve');
  });

  it('still tells staging, dropping and discarding apart', () => {
    expect(labelFor([], [moveWallDraft()])).toBe('nhap/them');
    expect(labelFor([moveWallDraft(), drawWallDraft()], [moveWallDraft()])).toBe('nhap/bot');
    expect(labelFor([moveWallDraft()], [])).toBe('nhap/huy');
  });

  it('falls back rather than guessing when the id says nothing', () => {
    const unreadable = [
      { entityId: 'nonsense', kind: 'editEntity', preview: firstSampleWall() },
    ] as unknown as readonly DraftOperation[];

    expect(labelFor(unreadable, [{ ...unreadable[0] } as DraftOperation])).toBe('nhap/cap-nhat');
  });
});

describe('store composition', () => {
  beforeEach(() => {
    useStore.setState({
      project: null,
      floors: [],
      activeFloorId: null,
      userRoles: [],
      spatial: null,
      spatialLoading: false,
      versionId: null,
      draftOperations: [],
    });
  });

  it('discards the unconfirmed draft when the viewed floor changes', () => {
    useStore.getState().setActiveFloor(sampleLevelIdAt(0));
    useStore.getState().stageDraftOperation(moveWallDraft());
    expect(useStore.getState().draftOperations).toHaveLength(1);

    useStore.getState().setActiveFloor(sampleLevelIdAt(1));

    expect(useStore.getState().draftOperations).toHaveLength(0);
  });

  it('keeps the draft when the viewed floor stays the same', () => {
    useStore.getState().setActiveFloor(sampleLevelIdAt(0));
    useStore.getState().stageDraftOperation(moveWallDraft());

    useStore.getState().setActiveFloor(sampleLevelIdAt(0));
    useStore.getState().setSpatialLoading(true);

    expect(useStore.getState().draftOperations).toHaveLength(1);
  });

  it('keeps the saved spatial data untouched while drafting', () => {
    const spatial = normalizeSpatial(createSampleBuilding());

    useStore.getState().setSpatial(spatial, 'v1');
    useStore.getState().stageDraftOperation(moveWallDraft());

    expect(useStore.getState().spatial).toBe(spatial);
  });
});

/* B-V7-04: một lượt nạp thay cả đồ thị, không phải một lần người dùng sửa — Ctrl+Z
   (`useStore.temporal.undo`, `router.tsx`) không được trả màn về kho rỗng. */
describe('loading spatial data is not an undo step', () => {
  it('leaves no undo step behind, so undo cannot empty the screen', () => {
    useStore.getState().setSpatial(null, null);
    useStore.getState().setSpatial(normalizeSpatial(createSampleBuilding()), 'v1');

    expect(useStore.temporal.getState().pastStates).toHaveLength(0);

    useStore.temporal.getState().undo();

    expect(useStore.getState().spatial).not.toBeNull();
  });
});

describe('slice state shape', () => {
  const dataFields = (state: object): string[] =>
    Object.entries(state)
      .filter(([, value]) => typeof value !== 'function')
      .map(([key]) => key)
      .sort();

  it('stores no derived data in any slice', () => {
    const projectFields = dataFields(create<ProjectSlice>()(createProjectSlice).getState());
    const spatialFields = dataFields(create<SpatialSlice>()(createSpatialSlice).getState());
    const draftFields = dataFields(create<DraftSlice>()(createDraftSlice).getState());

    expect(projectFields).toEqual(['activeFloorId', 'floors', 'project', 'userRoles']);
    expect(spatialFields).toEqual([
      'floorMeta',
      'lastServerSpatial',
      'serverReplaceSeq',
      'spatial',
      'spatialLoading',
      'spatialProjectId',
      'unsavedFloorIds',
      'versionId',
    ]);
    expect(draftFields).toEqual(['draftOperations']);

    const derivedFieldPattern = /(area|violation|derived|computed|percent)/i;

    for (const field of [...projectFields, ...spatialFields, ...draftFields]) {
      expect(field).not.toMatch(derivedFieldPattern);
    }
  });
});
