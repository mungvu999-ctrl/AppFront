/**
 * AppFront (09/11): whether a level is on screen under the viewer's level mode. One rule for everything that draws a
 * level: `scripts/realism/u70-hidden-level-no-shadow.mjs` (meshes + shadows, `level-utils.ts`) and
 * `scripts/realism/u40-room-labels.mjs` (room labels, a drei `<Html>` that layers/`visible` cannot hide).
 *
 * "Tầng: từng tầng" (`solo`) shows only the selected level. A hidden level draws nothing, shadow included: Pascal kept
 * the levels above as shadow casters, which put the silhouette of an unseen floor on the ground and the floor below.
 */
export type LevelMode = 'stacked' | 'exploded' | 'solo' | 'manual';

export interface LevelShownInput {
  levelMode: LevelMode;
  hasSelectedLevel: boolean;
  isSelected: boolean;
  /** The author's own eye toggle on the level (`LevelNode.visible`). */
  nodeVisible?: boolean;
}

export function isLevelShown({ levelMode, hasSelectedLevel, isSelected, nodeVisible = true }: LevelShownInput): boolean {
  if (!nodeVisible) return false;
  return levelMode !== 'solo' || !hasSelectedLevel || isSelected;
}
