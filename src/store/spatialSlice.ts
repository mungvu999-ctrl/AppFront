import type { StateCreator, StoreApi } from 'zustand';
import type { TemporalState } from 'zundo';
import { applyPatch, type SpatialPatch } from '../domain/spatial/applyPatch';
import type { NormalizedSpatial } from '../domain/spatial/normalize';
import { graphVersionOf } from '../lib/versioning/graphVersion';
import type { ScaleSource } from '../lib/viewmodel/provisionalScale';
import type { Suggestion, SuggestionState, SuggestionsMeta } from '../api/schemas/suggestions';
import { withSuggestionState } from '../lib/suggestions/state';

/**
 * Saved spatial data of the floor being viewed, in the normalized form built
 * by `domain/spatial/normalize`.
 *
 * The slice stores no derived measurements (areas, violations, …); those are
 * computed by selectors over `spatial`. Patching goes through the pure
 * `applyPatch` from the domain layer, so the slice itself contains no
 * geometry logic.
 */
export interface FloorMetaEntry {
  revision: number;
  /** `'unresolved'`: the floor's scale is a server guess (N16); measures are not trustworthy yet. */
  scaleStatus?: 'unresolved';
  /** Only with `scaleStatus`: `'project_default'` = the server could not measure the floor at all (UX-R1 K12). */
  scaleSource?: ScaleSource;
}

/** Scale keys as N16 or a held entry carries them; either may be absent. */
export interface FloorScaleKeys {
  readonly scaleStatus?: 'unresolved' | undefined;
  readonly scaleSource?: ScaleSource | undefined;
}

/** A `floorMeta` entry: `scaleSource` is kept only together with `scaleStatus` (both absent once the scale is real). */
export function floorMetaEntryOf(revision: number, scale?: FloorScaleKeys): FloorMetaEntry {
  const { scaleSource, scaleStatus } = scale ?? {};

  if (scaleStatus === undefined) {
    return { revision };
  }

  return scaleSource === undefined ? { revision, scaleStatus } : { revision, scaleStatus, scaleSource };
}

/**
 * M2 — the suggestion layer of one floor as the server last returned it, plus the user's unsent state.
 * `enabled`: the floor's layer is on (`suggestionsEnabled`); `dirty`: a `state` changed locally and the next #35
 * must carry `suggestionState`; `enabledChanged`: the user switched the layer and #35 must carry `suggestionsEnabled`.
 */
export interface FloorSuggestions {
  readonly suggestions: readonly Suggestion[];
  readonly meta?: SuggestionsMeta;
  readonly enabled?: true;
  readonly dirty?: true;
  readonly enabledChanged?: true;
}

/** Where a loaded graph came from: the project and the revision each floor was read at. */
export interface SpatialSource {
  projectId: string;
  floorRevisions: Readonly<Record<string, number>>;
  /** Floors whose scale is provisional; N15 carries no `scaleStatus`, so only an N16 caller fills it. */
  floorScaleStatus?: Readonly<Record<string, 'unresolved'>>;
  /** `scaleSource` of the floors in `floorScaleStatus` (N16 only). */
  floorScaleSource?: Readonly<Record<string, ScaleSource>>;
  /** M2 — suggestion layer per floor (N15 `floorRevisions[].suggestions`); absent = none. */
  floorSuggestions?: Readonly<Record<string, FloorSuggestions>>;
}

/**
 * `versionId` that goes with `floorMeta`, written in the same `set` as it: derived from the
 * floor revisions, or `fallback` while no floor has one (F-04x-2).
 */
export const versionIdFor = (
  floorMeta: Readonly<Record<string, FloorMetaEntry>>,
  fallback: string | null,
): string | null => (Object.keys(floorMeta).length === 0 ? fallback : graphVersionOf(floorMeta));

export interface SpatialSlice {
  /** Normalized spatial data of the floor being viewed; null before load. */
  spatial: NormalizedSpatial | null;
  /** True while the floor's spatial data is being fetched. */
  spatialLoading: boolean;
  /** Version of the loaded data: `graphVersionOf(floorMeta)` once floors have revisions; null before load. */
  versionId: string | null;
  /**
   * Stores freshly loaded data; arriving data always ends the loading state.
   * Also empties the undo history: a load replaces the graph, it is not an edit
   * the user made, so Ctrl+Z must never "undo" it back to an empty screen (B-V7-04).
   */
  setSpatial: (
    spatial: NormalizedSpatial | null,
    versionId: string | null,
    source?: SpatialSource,
  ) => void;
  /** Server revision of each floor's layer, as of the last read or save. */
  floorMeta: Readonly<Record<string, FloorMetaEntry>>;
  /** Project the stored `spatial` was loaded for; null when unknown (nothing may be saved). */
  spatialProjectId: string | null;
  /** Floors with edits not yet on the server, mirrored from the layer saver. */
  unsavedFloorIds: readonly string[];
  /** Bumped when the server replaced a floor under the user (reload); history owners clear on it. */
  serverReplaceSeq: number;
  /** The last graph that came from the server; `spatial !== lastServerSpatial` means local edits. */
  lastServerSpatial: NormalizedSpatial | null;
  /** Replaces the whole entry of one floor. */
  updateFloorMeta: (floorId: string, entry: FloorMetaEntry) => void;
  setUnsavedFloorIds: (floorIds: readonly string[]) => void;
  setSpatialLoading: (spatialLoading: boolean) => void;
  setVersionId: (versionId: string | null) => void;
  /** Mutation gateway reserved for `commit(patch, label)`; never call it from a component. */
  _applyPatches: (patches: readonly SpatialPatch[]) => void;
  /** M2 — suggestion layer per floor; see {@link FloorSuggestions}. */
  floorSuggestions: Readonly<Record<string, FloorSuggestions>>;
  /** M2 — the server's copy of one floor (save result or read); a floor still `dirty` keeps its local state. */
  receiveFloorSuggestions: (floorId: string, entry: Pick<FloorSuggestions, 'suggestions' | 'meta' | 'enabled'>, sent?: boolean) => void;
  /** M2 — the user turned one suggestion on/off (or adopted it); marks the floor dirty for the next save. */
  changeSuggestionState: (floorId: string, id: string, state: SuggestionState, adoptedAs?: string) => void;
  /** M2 — switch the floor's layer on/off; the next save carries `suggestionsEnabled` (switching on reconciles). */
  setSuggestionsEnabled: (floorId: string, enabled: boolean) => void;
}

/** `temporal` is attached to the store api by the zundo middleware in `store/index.ts`. */
interface MaybeTemporalApi {
  temporal?: StoreApi<TemporalState<unknown>>;
}

export const createSpatialSlice: StateCreator<SpatialSlice> = (set, _get, api) => ({
  spatial: null,
  spatialLoading: false,
  versionId: null,
  floorMeta: {},
  spatialProjectId: null,
  unsavedFloorIds: [],
  serverReplaceSeq: 0,
  lastServerSpatial: null,
  floorSuggestions: {},
  receiveFloorSuggestions: (floorId, { suggestions, meta, enabled }, sent = false) =>
    set((state) => {
      const current = state.floorSuggestions[floorId];
      // Local state not yet sent wins over a save result that did not carry it.
      if ((current?.dirty === true || current?.enabledChanged === true) && !sent) return state;
      const entry: FloorSuggestions = { suggestions, ...(meta === undefined ? {} : { meta }), ...(enabled === true ? { enabled } : {}) };
      return { floorSuggestions: { ...state.floorSuggestions, [floorId]: entry } };
    }),
  changeSuggestionState: (floorId, id, next, adoptedAs) =>
    set((state) => {
      const current = state.floorSuggestions[floorId];
      if (current === undefined || !current.suggestions.some((s) => s.id === id)) return state;
      const entry: FloorSuggestions = { ...current, suggestions: withSuggestionState(current.suggestions, id, next, adoptedAs), dirty: true };
      return { floorSuggestions: { ...state.floorSuggestions, [floorId]: entry } };
    }),
  setSuggestionsEnabled: (floorId, enabled) =>
    set((state) => {
      const { enabled: _was, ...current } = state.floorSuggestions[floorId] ?? { suggestions: [] };
      void _was;
      const entry: FloorSuggestions = { ...current, ...(enabled ? { enabled: true } : {}), enabledChanged: true };
      return { floorSuggestions: { ...state.floorSuggestions, [floorId]: entry } };
    }),
  updateFloorMeta: (floorId, entry) =>
    set((state) => {
      const floorMeta = { ...state.floorMeta, [floorId]: entry };

      return { floorMeta, versionId: versionIdFor(floorMeta, state.versionId) };
    }),
  setUnsavedFloorIds: (unsavedFloorIds) => set({ unsavedFloorIds }),
  setSpatial: (spatial, versionId, source) => {
    const floorMeta: Record<string, FloorMetaEntry> = Object.fromEntries(
      Object.entries(source?.floorRevisions ?? {}).map(([floorId, revision]) => {
        const scale = { scaleSource: source?.floorScaleSource?.[floorId], scaleStatus: source?.floorScaleStatus?.[floorId] };

        return [floorId, floorMetaEntryOf(revision, scale)];
      }),
    );

    set({
      spatial,
      versionId: versionIdFor(floorMeta, versionId),
      spatialLoading: false,
      spatialProjectId: source?.projectId ?? null,
      floorMeta,
      lastServerSpatial: spatial,
      floorSuggestions: source?.floorSuggestions ?? {},
    });
    (api as MaybeTemporalApi).temporal?.getState().clear();
  },
  setSpatialLoading: (spatialLoading) => set({ spatialLoading }),
  setVersionId: (versionId) => set({ versionId }),
  _applyPatches: (patches) =>
    set((state) => {
      if (state.spatial === null) {
        return state;
      }

      const next = applyPatch(state.spatial, patches);

      return next === state.spatial ? state : { spatial: next };
    }),
});
