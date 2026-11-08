import type { SpatialGraphDocument } from '../api/schemas/spatialGraph';
import type { EntityKind } from '../domain/spatial/ids';
import { normalizeSpatial, type NormalizedSpatial } from '../domain/spatial/normalize';
import { replaceLevelEntities, type LevelParts } from '../domain/spatial/replaceLevelEntities';
import type { EntityId, Level, LevelId, SpatialGraph } from '../domain/spatial/types';
import type { Project, ProjectRole } from '../types/project';
import { resetCommitRun } from './commit';
import { useStore } from './index';
import { floorMetaEntryOf, versionIdFor, type FloorMetaEntry } from './spatialSlice';
import type { FloorSuggestions } from '../lib/suggestions/state';
import { useSuggestionStore } from './suggestionStore';

/**
 * Loading a project's whole graph (N15) into the store — F-04x-2 step 2.
 *
 * Neither function is an edit: no `commit`, no undo step (`temporal` is paused around the
 * write), and `spatial`, `lastServerSpatial`, `floorMeta`, `versionId` land in ONE `set` (R14),
 * so the layer autosave reads the write as "from the server" and sends nothing.
 */

export interface ProjectHydrationInput {
  readonly project: Project;
  readonly document: SpatialGraphDocument;
  readonly roles: readonly ProjectRole[];
}

const revisionsOf = (document: SpatialGraphDocument): Record<string, number> =>
  Object.fromEntries(document.floorRevisions.map((entry) => [entry.floorId, entry.revision]));

/** M2 — lớp đề xuất từng tầng của N15 (vắng khoá = không có). */
const suggestionsOf = (document: SpatialGraphDocument): Record<string, FloorSuggestions> =>
  Object.fromEntries(
    document.floorRevisions.flatMap(({ floorId, suggestions, suggestionsMeta, suggestionsEnabled }) =>
      (suggestions === undefined || suggestions.length === 0) && suggestionsEnabled !== true
        ? []
        : [
            [
              floorId,
              {
                suggestions: suggestions ?? [],
                ...(suggestionsMeta === undefined ? {} : { meta: suggestionsMeta }),
                ...(suggestionsEnabled === true ? { enabled: true as const } : {}),
              },
            ],
          ],
    ),
  );

const byOrder = (levels: readonly Level[]): Level[] => [...levels].sort((a, b) => a.order - b.order);

/** Opens a project from scratch: project, floors, roles, graph; history emptied by `setSpatial`. */
export function hydrateProject({ document, project, roles }: ProjectHydrationInput): void {
  const state = useStore.getState();
  const floors = byOrder(document.graph.levels);
  /* Tầng chọn ở vỏ trước khi cổng nạp kho (vd. OverlayComparison) vẫn là tầng đang mở nếu N15 có nó. */
  const kept = floors.find((level) => level.id === state.activeFloorId)?.id ?? null;

  state.setProject(project);
  state.setActiveFloor(kept);
  state.setFloors(floors);
  state.setUserRoles(roles);
  state.setSpatial(normalizeSpatial(document.graph), null, {
    floorRevisions: revisionsOf(document),
    projectId: project.id,
  });
  // M2: kho lớp đề xuất riêng (cùng chunk `commit`, ngoài chunk vào).
  const floorSuggestions = suggestionsOf(document);
  useSuggestionStore.getState().replaceFloorSuggestions(floorSuggestions);
}

/** Everything one level holds in the N15 graph; an opening goes with its wall's level. */
const partsOf = (graph: SpatialGraph, level: Level): LevelParts => {
  const walls = graph.walls.filter((wall) => wall.levelId === level.id);
  const wallIds = new Set<string>(walls.map((wall) => wall.id));

  return {
    axes: graph.axes.filter((axis) => axis.levelId === level.id),
    dimensions: graph.dimensions.filter((dimension) => dimension.levelId === level.id),
    furniture: graph.furniture.filter((item) => item.levelId === level.id),
    level,
    openings: graph.openings.filter((opening) => wallIds.has(opening.wallId)),
    rooms: graph.rooms.filter((room) => room.levelId === level.id),
    roofs: (graph.roofs ?? []).filter((roof) => roof.levelId === level.id),
    walls,
  };
};

/** `Level` holds primitives only, so a shallow compare is a full one. */
const sameLevel = (a: Level, b: Level): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  return [...keys].every((key) => a[key as keyof Level] === b[key as keyof Level]);
};

/** Drops a level and everything on it. */
const withoutLevel = (spatial: NormalizedSpatial, levelId: LevelId): NormalizedSpatial => {
  const gone = new Set<string>([levelId, ...(spatial.byLevel[levelId] ?? [])]);
  const byId = { ...spatial.byId };
  const byLevel = { ...spatial.byLevel };

  for (const id of gone) {
    delete byId[id];
  }

  delete byLevel[levelId];

  const byKind: Record<EntityKind, readonly EntityId[]> = { ...spatial.byKind };

  for (const kind of Object.keys(byKind) as EntityKind[]) {
    byKind[kind] = byKind[kind].filter((id) => !gone.has(id));
  }

  return {
    ...spatial,
    byId,
    byKind,
    byLevel,
  };
};

const levelsOf = (spatial: NormalizedSpatial): Level[] =>
  byOrder(spatial.byKind.level.flatMap((id) => {
    const level = spatial.byId[id];

    return level === undefined ? [] : [level as Level];
  }));

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Brings the store's graph of the SAME project up to N15, floor by floor:
 *
 * - a floor in `unsavedFloorIds` is kept as it is, `floorMeta` included (its save meets a 409);
 * - N15 revision greater than `floorMeta`, or no meta, or floor missing → all seven keys replaced,
 *   `scaleStatus` kept;
 * - equal → only the `Level` when it differs; smaller → ignored;
 * - a floor gone from N15 (and not unsaved) → removed;
 * - store `project` still `null` (a QC screen loaded the graph) → the building is replaced too.
 *
 * Replacing a floor that had meta, or removing one, empties history and bumps
 * `serverReplaceSeq` after `resume` (R14). Nothing to change → no write at all.
 */
export function refreshProjectGraph(document: SpatialGraphDocument): void {
  const state = useStore.getState();
  const current = state.spatial;

  if (current === null) {
    return;
  }

  const revisions = revisionsOf(document);
  const unsaved = new Set(state.unsavedFloorIds);
  const floorMeta: Record<string, FloorMetaEntry> = { ...state.floorMeta };
  let spatial = current;
  let external = false;

  for (const level of document.graph.levels) {
    const revision = revisions[level.id] ?? 0;
    const meta = state.floorMeta[level.id];
    const held = current.byId[level.id];

    if (unsaved.has(level.id)) {
      continue;
    }

    if (held === undefined || meta === undefined || revision > meta.revision) {
      spatial = replaceLevelEntities(spatial, level.id, partsOf(document.graph, level));
      floorMeta[level.id] = floorMetaEntryOf(revision, meta);
      external ||= held !== undefined && meta !== undefined;
    } else if (revision === meta.revision && !sameLevel(held as Level, level)) {
      spatial = { ...spatial, byId: { ...spatial.byId, [level.id]: level } };
    }
  }

  const incoming = new Set<string>(document.graph.levels.map((level) => level.id));

  for (const levelId of current.byKind.level) {
    if (!incoming.has(levelId) && !unsaved.has(levelId)) {
      spatial = withoutLevel(spatial, levelId as LevelId);
      delete floorMeta[levelId];
      external = true;
    }
  }

  if (state.project === null && spatial.building !== document.graph.building) {
    spatial = { ...spatial, building: document.graph.building };
  }

  if (spatial === current) {
    return;
  }

  const floors = levelsOf(spatial);
  const temporal = useStore.temporal.getState();
  const tracking = temporal.isTracking;

  if (tracking) {
    temporal.pause();
  }

  try {
    useStore.setState((latest) => ({
      spatial,
      lastServerSpatial: spatial,
      floorMeta,
      versionId: versionIdFor(floorMeta, latest.versionId),
      ...(sameList(latest.floors, floors) ? {} : { floors }),
      ...(external ? { serverReplaceSeq: latest.serverReplaceSeq + 1 } : {}),
    }));
  } finally {
    if (tracking) {
      useStore.temporal.getState().resume();
    }
  }

  if (external) {
    useStore.temporal.getState().clear();
  }

  resetCommitRun();
}

/**
 * What the project gate does with a fresh #24 + N15: no graph of this project in the store
 * (empty, or another project's) → {@link hydrateProject}; same project → {@link refreshProjectGraph},
 * and when the store has no `project` yet (a QC screen loaded it) the project and roles are set
 * without touching `floors`/`activeFloorId`. Never reads undo history.
 */
export function loadProjectGraph(input: ProjectHydrationInput): 'hydrated' | 'refreshed' {
  const state = useStore.getState();

  if (state.spatial === null || state.spatialProjectId !== input.project.id) {
    hydrateProject(input);

    return 'hydrated';
  }

  const projectMissing = state.project === null;

  refreshProjectGraph(input.document);

  if (projectMissing) {
    useStore.setState((latest) => ({
      floors: latest.spatial === null ? latest.floors : levelsOf(latest.spatial),
      project: input.project,
      userRoles: input.roles,
    }));
  }

  return 'refreshed';
}
