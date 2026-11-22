import { describe, expect, it } from 'vitest';

import { medianMs } from '@/lib/testing/timing';

import {
  createSampleBuilding,
  SAMPLE_BUILDING,
  SAMPLE_WALL_COUNT,
  sampleLevelId,
  sampleRoomId,
  sampleWallId,
} from '../../spatial/__fixtures__/sampleBuilding';
import { isValidId } from '../../spatial/ids';
import { displayCodeIn, normalizeSpatial, type NormalizedSpatial } from '../../spatial/normalize';
import type { LevelId, Room, RoomId, SpatialGraph, Wall, WallId } from '../../spatial/types';
import { ALL_RULES, createDefaultRuleRegistry } from '../defaults';
import { SUPERSEDED_BUILT_IN_CODES } from '../function';
import {
  BUILT_IN_RULES,
  createRuleRegistry,
  entitiesInScope,
  MIN_WALL_THICKNESS_MM,
  RULE_SEVERITIES,
  type Rule,
  type Violation,
} from '../registry';
import {
  EMPTY_RULE_CONFIG,
  resetConfig,
  setRuleThreshold,
  withSeparateUnits,
  type RuleConfig,
} from '../config';
import {
  evaluatedRuleCodes,
  ruleAppliesTo,
  runRules,
} from '../runner';

/* -------------------------------------------------------------------------- */
/* Fixtures.                                                                   */
/* -------------------------------------------------------------------------- */

const GROUND_LEVEL_ID: LevelId = sampleLevelId(0);
const FIRST_WALL_ID: WallId = sampleWallId(0);

/**
 * Rules that read walls, and so go stale when one moves.
 *
 * Fifteen rather than the four the eight built-ins gave, because the default
 * book now holds all twenty-five: the geometry, function and fit-out groups are
 * registered by `createDefaultRuleRegistry` itself. `rulesFor` answers with the
 * **enabled** rules, so `ROOM-HAS-DOOR` is absent — the function group stands it
 * down and `ROOM-NO-DOOR` reads walls in its place.
 */
const WALL_DEPENDENT_CODES = [
  'WALL-THICKNESS',
  'WALL-LENGTH',
  'OPENING-IN-WALL',
  'WALL-OVERLAP',
  'WALL-DANGLING-END',
  'ROOM-NOT-CLOSED',
  'DOOR-SWING-BLOCKED',
  'WALL-UNSUPPORTED',
  'ROOM-NO-DOOR',
  'ROOM-NO-WINDOW',
  'ESCAPE-DISTANCE',
  'DOOR-BLOCKS-PATH',
  'FURNITURE-CLASH',
  'FIXTURE-OFF-WALL',
  'WINDOW-ON-INNER-WALL',
];

/**
 * The one of those that is building-scoped rather than level-scoped.
 *
 * It matters to the arithmetic below: a building-scoped rule has exactly one
 * task however many floors went stale, so it is counted once, not four times.
 */
const BUILDING_SCOPED_WALL_CODES = ['WALL-UNSUPPORTED'];

/** Rules that read rooms. `ROOM-MIN-AREA` is stood down; `ROOM-AREA-BELOW-MINIMUM` replaced it. */
const ROOM_DEPENDENT_CODES = [
  'ROOM-UNNAMED',
  'ROOM-NOT-CLOSED',
  'ROOM-NO-DOOR',
  'CORRIDOR-WIDTH',
  'ROOM-NO-WINDOW',
  'ESCAPE-DISTANCE',
  'DOOR-BLOCKS-PATH',
  'ROOM-AREA-BELOW-MINIMUM',
  'ROOM-FURNITURE-MISMATCH',
  // U08: cửa sổ giáp lô gia không bị báo, nên luật này đọc cả phòng.
  'WINDOW-ON-INNER-WALL',
];

/** Rules that read levels — all three building-scoped. */
const LEVEL_DEPENDENT_CODES = ['LEVEL-ELEVATION', 'WALL-UNSUPPORTED', 'STAIR-ALIGNMENT'];

/** Twenty level-scoped rules over four floors, plus three building-scoped ones. */
const FULL_PASS_TASK_COUNT = 20 * 4 + 3;

function normalizedSample(): NormalizedSpatial {
  return normalizeSpatial(createSampleBuilding());
}

/** The sample building with one wall rewritten, without touching the original. */
function withWall(graph: SpatialGraph, wallId: WallId, patch: Partial<Wall>): SpatialGraph {
  return {
    ...graph,
    walls: graph.walls.map((wall) => (wall.id === wallId ? { ...wall, ...patch } : wall)),
  };
}

/** The same, for one room. */
function withRoom(graph: SpatialGraph, roomId: RoomId, patch: Partial<Room>): SpatialGraph {
  return {
    ...graph,
    rooms: graph.rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room)),
  };
}

/** A rule the built-in book does not contain, to prove the runner needs no edit. */
const furnitureReviewRule: Rule = {
  code: 'FURNITURE-REVIEW',
  name: 'đồ đạc do máy nhận dạng cần người duyệt',
  group: 'annotation',
  severity: 'suggestion',
  scope: 'level',
  dependsOn: ['furniture'],
  check: (context) =>
    entitiesInScope(context, 'furniture').flatMap((item) =>
      item.reviewed
        ? []
        : [
            {
              entityId: item.id,
              message: `Đồ đạc ${item.id} chưa được người duyệt.`,
              suggestion: 'Mở bảng kiểm và duyệt đồ đạc này.',
            },
          ],
    ),
};

/* -------------------------------------------------------------------------- */
/* The rule book.                                                              */
/* -------------------------------------------------------------------------- */

describe('the rule book', () => {
  it('gives every rule an upper-case code, a capitalised Vietnamese name and a severity', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(rule.code).toBe(rule.code.toUpperCase());
      expect(rule.name).toBe(rule.name.charAt(0).toLocaleUpperCase('vi') + rule.name.slice(1));
      expect(RULE_SEVERITIES).toContain(rule.severity);
      expect(rule.dependsOn.length).toBeGreaterThan(0);
    }
  });

  it('refuses two rules sharing a code', () => {
    const registry = createDefaultRuleRegistry();

    expect(() => {
      registry.register({ ...furnitureReviewRule, code: 'WALL-LENGTH' });
    }).toThrow(/WALL-LENGTH/);
  });

  it('maps an entity kind to the rules that read it, in registration order', () => {
    const registry = createDefaultRuleRegistry();

    expect(registry.rulesFor(['wall']).map((rule) => rule.code)).toEqual(WALL_DEPENDENT_CODES);
    expect(registry.rulesFor(['room']).map((rule) => rule.code)).toEqual(ROOM_DEPENDENT_CODES);
  });

  it('lists a rule once however many of its kinds changed', () => {
    const registry = createDefaultRuleRegistry();
    const codes = registry.rulesFor(['wall', 'opening', 'room']).map((rule) => rule.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('OPENING-IN-WALL');
  });

  it('switches one rule off and back on', () => {
    const registry = createDefaultRuleRegistry();

    expect(registry.isEnabled('DOOR-WIDTH')).toBe(true);
    registry.setEnabled('DOOR-WIDTH', false);
    expect(registry.isEnabled('DOOR-WIDTH')).toBe(false);
    expect(registry.listEnabled().map((rule) => rule.code)).not.toContain('DOOR-WIDTH');
    expect(registry.rulesFor(['opening']).map((rule) => rule.code)).not.toContain('DOOR-WIDTH');

    registry.setEnabled('DOOR-WIDTH', true);
    // Twenty-five registered, less the two the function group stands down.
    expect(registry.listEnabled()).toHaveLength(ALL_RULES.length - SUPERSEDED_BUILT_IN_CODES.length);
  });

  it('refuses to switch a rule nobody registered', () => {
    const registry = createDefaultRuleRegistry();

    expect(() => {
      registry.setEnabled('NO-SUCH-RULE', false);
    }).toThrow(/NO-SUCH-RULE/);
    expect(registry.isEnabled('NO-SUCH-RULE')).toBe(false);
    expect(registry.get('NO-SUCH-RULE')).toBeNull();
  });

  it('runs a rule the runner has never heard of, with no change to the runner', () => {
    const registry = createDefaultRuleRegistry();
    registry.register(furnitureReviewRule);

    const result = runRules(normalizedSample(), { registry });
    const reported = result.violations.filter((found) => found.ruleCode === 'FURNITURE-REVIEW');

    expect(reported).toHaveLength(21);
    expect(reported.every((found) => found.severity === 'suggestion')).toBe(true);
  });

  it('runs only registered rules when the book is otherwise empty', () => {
    const registry = createRuleRegistry([furnitureReviewRule]);
    const result = runRules(normalizedSample(), { registry });

    expect(evaluatedRuleCodes(result)).toEqual(['FURNITURE-REVIEW']);
  });
});

/* -------------------------------------------------------------------------- */
/* What a violation has to carry.                                              */
/* -------------------------------------------------------------------------- */

describe('a violation', () => {
  const registry = createDefaultRuleRegistry();
  const result = runRules(normalizedSample(), { registry });

  // The sample building is built to pass `checkIntegrity`, which is referential:
  // no dangling id, no zero-length wall, no room naming a wall that is not there.
  // It was never built to be a plausible *plan* — its 48 walls are collinear
  // 1 000 mm stubs spread round-robin over four floors, each room lists exactly
  // one such stub as its only boundary wall, and each of its 21 tables sits
  // astride the wall it was placed on. The eight built-ins could see none of
  // that. The other seventeen can, and every count below is a true reading of
  // the fixture's own geometry.
  it('is raised by the standard sample: 96 wall ends joining nothing, 21 tables through a wall', () => {
    const byRule = new Map<string, number>();

    for (const found of result.violations) {
      byRule.set(found.ruleCode, (byRule.get(found.ruleCode) ?? 0) + 1);
    }

    expect(Object.fromEntries(byRule)).toEqual({
      'OPENING-IN-WALL': 16,
      'WALL-DANGLING-END': 96,
      'ROOM-NOT-CLOSED': 14,
      'ROOM-NO-DOOR': 12, // U08: cửa trên đoạn tường bị tách giờ được tính
      'ROOM-NO-WINDOW': 12,
      'FURNITURE-CLASH': 21,
      'WINDOW-ON-INNER-WALL': 7,
    });
  });

  it('always names an entity code that exists in the model', () => {
    const graph = normalizedSample();

    expect(result.violations.length).toBeGreaterThan(0);

    for (const found of result.violations) {
      expect(isValidId(found.entityId)).toBe(true);
      // The sentence names it the way the lists do, never by its machine id (B-V7-05).
      expect(found.message).toContain(displayCodeIn(graph, found.entityId));
      expect(found.message).not.toContain(found.entityId);
    }
  });

  it('always carries a Vietnamese sentence and a fix to try', () => {
    for (const found of result.violations) {
      expect(found.message.trim().endsWith('.')).toBe(true);
      expect(found.suggestion.trim().endsWith('.')).toBe(true);
      expect(found.suggestion.length).toBeGreaterThan(0);
      expect(RULE_SEVERITIES).toContain(found.severity);
    }
  });

  it('says which level it was found on', () => {
    for (const found of result.violations) {
      expect(found.levelId).not.toBeNull();
    }
  });

  it('gives wall lengths in whole millimetres', () => {
    const graph = normalizeSpatial(withWall(createSampleBuilding(), FIRST_WALL_ID, { thicknessMm: 12.5 }));
    const thickness = runRules(graph, { registry: createDefaultRuleRegistry() }).violations.find(
      (found) => found.ruleCode === 'WALL-THICKNESS',
    );

    expect(thickness?.message).toContain('13 mm');
    expect(thickness?.suggestion).toContain(`${String(MIN_WALL_THICKNESS_MM)} mm`);
  });

  it('gives areas in square metres, with a comma for the decimal', () => {
    const graph = normalizeSpatial(withRoom(createSampleBuilding(), sampleRoomId(0), { areaM2: 8 }));
    // `ROOM-MIN-AREA` is stood down in the default book. `ROOM-AREA-BELOW-MINIMUM`
    // reports the same shortfall against the same 9,00 m2 floor for a bedroom,
    // and the decimal comma is the point of this test either way.
    const area = runRules(graph, { registry: createDefaultRuleRegistry() }).violations.find(
      (found) => found.ruleCode === 'ROOM-AREA-BELOW-MINIMUM',
    );

    expect(area?.message).toContain('8,00 m²');
    expect(area?.message).toContain('9,00 m²');
    expect(area?.message).toContain('phòng ngủ');
  });
});

/* -------------------------------------------------------------------------- */
/* Rules never touch the model.                                                */
/* -------------------------------------------------------------------------- */

describe('running the book', () => {
  it('leaves the model exactly as it found it', () => {
    const before = JSON.stringify(SAMPLE_BUILDING);
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const indexBefore = JSON.stringify(graph);

    runRules(graph, { registry: createDefaultRuleRegistry() });

    expect(JSON.stringify(SAMPLE_BUILDING)).toBe(before);
    expect(JSON.stringify(graph)).toBe(indexBefore);
  });

  it('reports a rule that throws instead of taking the pass down with it', () => {
    const registry = createRuleRegistry([
      {
        ...furnitureReviewRule,
        code: 'BROKEN-RULE',
        check: () => {
          throw new Error('mất chỉ mục');
        },
      },
      furnitureReviewRule,
    ]);

    const result = runRules(normalizedSample(), { registry });
    const broken = result.violations.filter((found) => found.ruleCode === 'BROKEN-RULE');

    expect(broken).toHaveLength(4);
    expect(broken[0]?.severity).toBe('critical');
    expect(broken[0]?.message).toContain('mất chỉ mục');
    expect(broken[0]?.suggestion).toContain('BROKEN-RULE');
    expect(result.violations.some((found) => found.ruleCode === 'FURNITURE-REVIEW')).toBe(true);
  });

  it('lists violations in the same order however much of the pass was re-run', () => {
    const registry = createDefaultRuleRegistry();
    const graph = normalizedSample();
    const full = runRules(graph, { registry });
    const incremental = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: FIRST_WALL_ID }],
    });

    expect(incremental.violations).toEqual(full.violations);
  });
});

/* -------------------------------------------------------------------------- */
/* A one-floor apartment has no floors to compare.                             */
/* -------------------------------------------------------------------------- */

/** The sample cut down to its ground floor and what stands on it. */
function oneFloorSample(): NormalizedSpatial {
  const sample = createSampleBuilding();
  const ground = sampleLevelId(0);
  const onGround = <T extends { levelId: LevelId }>(items: readonly T[]): T[] =>
    items.filter((item) => item.levelId === ground);
  const walls = onGround(sample.walls);
  const wallIds = new Set<WallId>(walls.map((wall) => wall.id));

  return normalizeSpatial({
    ...sample,
    levels: sample.levels.filter((level) => level.id === ground),
    walls,
    openings: sample.openings.filter((opening) => wallIds.has(opening.wallId)),
    furniture: onGround(sample.furniture),
    rooms: onGround(sample.rooms),
    axes: onGround(sample.axes),
    dimensions: onGround(sample.dimensions),
    notes: [],
    roofs: [],
  });
}

describe('a building of one floor', () => {
  const registry = createDefaultRuleRegistry();

  it('does not run, count or pass the rules that compare floors', () => {
    const result = runRules(oneFloorSample(), { registry });
    const ran = evaluatedRuleCodes(result);

    for (const code of LEVEL_DEPENDENT_CODES) {
      expect(ran).not.toContain(code);
    }

    expect(result.evaluated).toHaveLength(20);
  });

  it('runs them again once a second floor is there', () => {
    const ran = evaluatedRuleCodes(runRules(normalizedSample(), { registry }));

    for (const code of LEVEL_DEPENDENT_CODES) {
      expect(ran).toContain(code);
    }
  });

  it('applies a building rule from two floors up and a floor rule from one', () => {
    const building = registry.listEnabled().find((rule) => rule.scope === 'building');
    const floor = registry.listEnabled().find((rule) => rule.scope === 'level');

    expect(building && [0, 1, 2].map((count) => ruleAppliesTo(building, count))).toEqual([false, false, true]);
    expect(floor && [0, 1].map((count) => ruleAppliesTo(floor, count))).toEqual([false, true]);
  });
});

describe('floors that are separate apartments (K34)', () => {
  const registry = createDefaultRuleRegistry();
  const graph = normalizedSample();
  const separate = withSeparateUnits(EMPTY_RULE_CONFIG, true);

  it('skips the cross-floor rules on a full pass', () => {
    const ran = evaluatedRuleCodes(runRules(graph, { registry, config: separate }));

    for (const code of LEVEL_DEPENDENT_CODES) {
      expect(ran).not.toContain(code);
    }
  });

  it('skips them on an incremental pass too, and brings them back when switched off', () => {
    const full = runRules(graph, { registry, config: separate });
    const edited = runRules(graph, {
      registry,
      config: separate,
      previous: full.state,
      changes: [{ entityId: GROUND_LEVEL_ID }],
    });

    expect(edited.violations.some((v) => LEVEL_DEPENDENT_CODES.includes(v.ruleCode))).toBe(false);
    expect(evaluatedRuleCodes(edited)).not.toContain('LEVEL-ELEVATION');

    const stacked = withSeparateUnits(separate, false);
    const back = runRules(graph, { registry, config: stacked, previous: edited.state, changes: [] });

    expect(evaluatedRuleCodes(back)).toEqual(expect.arrayContaining(LEVEL_DEPENDENT_CODES));
  });

  it('keeps the same config object when the setting does not move', () => {
    expect(withSeparateUnits(EMPTY_RULE_CONFIG, false)).toBe(EMPTY_RULE_CONFIG);
    expect(withSeparateUnits(separate, true)).toBe(separate);
    expect(separate.version).toBe(EMPTY_RULE_CONFIG.version + 1);
  });
});

/* -------------------------------------------------------------------------- */
/* Only re-running what went stale.                                            */
/* -------------------------------------------------------------------------- */

describe('editing one wall', () => {
  const registry = createDefaultRuleRegistry();
  const graph = normalizedSample();
  const full = runRules(graph, { registry });

  it('starts from a pass over every rule on every level', () => {
    expect(full.evaluated).toHaveLength(FULL_PASS_TASK_COUNT);
    expect(full.reusedTaskCount).toBe(0);
  });

  it('re-runs the rules that read walls, and no others', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: FIRST_WALL_ID }],
    });

    expect(evaluatedRuleCodes(edited)).toEqual(WALL_DEPENDENT_CODES);
    expect(evaluatedRuleCodes(edited)).not.toContain('DOOR-WIDTH');
    expect(evaluatedRuleCodes(edited)).not.toContain('ROOM-MIN-AREA');
    expect(evaluatedRuleCodes(edited)).not.toContain('ROOM-UNNAMED');
    expect(evaluatedRuleCodes(edited)).not.toContain('LEVEL-ELEVATION');
  });

  it('re-runs them only on the level that wall sits on', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: FIRST_WALL_ID }],
    });

    expect(edited.evaluated).toHaveLength(WALL_DEPENDENT_CODES.length);
    expect(
      edited.evaluated
        .filter((task) => !BUILDING_SCOPED_WALL_CODES.includes(task.ruleCode))
        .every((task) => task.levelId === GROUND_LEVEL_ID),
    ).toBe(true);
    // The building-scoped one reads the whole stack, so it carries no level at all.
    expect(
      edited.evaluated
        .filter((task) => BUILDING_SCOPED_WALL_CODES.includes(task.ruleCode))
        .every((task) => task.levelId === null),
    ).toBe(true);
    expect(edited.reusedTaskCount).toBe(full.evaluated.length - WALL_DEPENDENT_CODES.length);
  });

  it('finds the same violations it would have found by re-running everything', () => {
    const changed = normalizeSpatial(withWall(createSampleBuilding(), FIRST_WALL_ID, { thicknessMm: 20 }));
    const incremental = runRules(changed, {
      registry,
      previous: full.state,
      changes: [{ entityId: FIRST_WALL_ID }],
    });

    expect(incremental.violations).toEqual(runRules(changed, { registry }).violations);
    expect(incremental.violations.some((found) => found.ruleCode === 'WALL-THICKNESS')).toBe(true);
  });

  it('re-runs the room rules when a room changes, and not the wall-only ones', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: sampleRoomId(0) }],
    });

    expect(evaluatedRuleCodes(edited)).toEqual(ROOM_DEPENDENT_CODES);
    expect(evaluatedRuleCodes(edited)).not.toContain('WALL-LENGTH');
  });

  it('re-runs the building-wide rules when a level changes, whatever floor it is', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: sampleLevelId(2) }],
    });

    expect(evaluatedRuleCodes(edited)).toEqual(LEVEL_DEPENDENT_CODES);
    expect(edited.evaluated).toEqual(
      LEVEL_DEPENDENT_CODES.map((ruleCode) => ({ ruleCode, levelId: null })),
    );
  });

  it('re-runs nothing when nothing changed', () => {
    const edited = runRules(graph, { registry, previous: full.state, changes: [] });

    expect(edited.evaluated).toHaveLength(0);
    expect(edited.reusedTaskCount).toBe(full.evaluated.length);
    expect(edited.violations).toEqual(full.violations);
  });

  it('re-checks every level when a deleted entity gives no level to narrow to', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: sampleWallId(999), kind: 'wall' }],
    });

    expect(evaluatedRuleCodes(edited)).toEqual(WALL_DEPENDENT_CODES);
    // Every floor for the level-scoped ones; the building-scoped one still once.
    expect(edited.evaluated).toHaveLength(
      (WALL_DEPENDENT_CODES.length - BUILDING_SCOPED_WALL_CODES.length) * 4 +
        BUILDING_SCOPED_WALL_CODES.length,
    );
  });

  it('re-checks everything when the changed code cannot be read', () => {
    const edited = runRules(graph, {
      registry,
      previous: full.state,
      changes: [{ entityId: 'không-phải-mã' }],
    });

    expect(edited.evaluated).toHaveLength(full.evaluated.length);
  });
});

/* -------------------------------------------------------------------------- */
/* The book changing under a running session.                                  */
/* -------------------------------------------------------------------------- */

describe('switching a rule while a session is open', () => {
  it('drops the violations of a rule switched off, without re-running anything', () => {
    const registry = createDefaultRuleRegistry();
    const graph = normalizedSample();
    const full = runRules(graph, { registry });

    registry.setEnabled('OPENING-IN-WALL', false);
    const after = runRules(graph, { registry, previous: full.state, changes: [] });

    expect(after.evaluated).toHaveLength(0);
    expect(after.violations.some((found) => found.ruleCode === 'OPENING-IN-WALL')).toBe(false);
    // The sample's 178 findings, less the 16 that rule raised.
    expect(after.violations).toHaveLength(162);
  });

  it('runs a rule registered mid-session even though nothing changed', () => {
    const registry = createDefaultRuleRegistry();
    const graph = normalizedSample();
    const full = runRules(graph, { registry });

    registry.register(furnitureReviewRule);
    const after = runRules(graph, { registry, previous: full.state, changes: [] });

    expect(evaluatedRuleCodes(after)).toEqual(['FURNITURE-REVIEW']);
    expect(after.violations.filter((found) => found.ruleCode === 'FURNITURE-REVIEW')).toHaveLength(21);
  });
});

/* -------------------------------------------------------------------------- */
/* Speed.                                                                      */
/* -------------------------------------------------------------------------- */

describe('speed', () => {
  it('checks the whole standard sample in well under 200 ms', () => {
    const registry = createDefaultRuleRegistry();

    // One warm-up pass, so the figure is the steady state an editing session
    // sees rather than the first-call cost of compiling the checks.
    let result = runRules(normalizedSample(), { registry });

    // Median of five: one stall of the shared CI runner is not the checks (master 02/11: 203 ms).
    const elapsedMs = medianMs(() => {
      result = runRules(normalizeSpatial(createSampleBuilding()), { registry });
    });

    expect(result.violations).toHaveLength(178);
    expect(elapsedMs).toBeLessThan(200);
  });

  it('costs a fraction of that to re-check one edited wall', () => {
    const registry = createDefaultRuleRegistry();
    const graph = normalizedSample();
    const full = runRules(graph, { registry });

    let edited = full;
    const elapsedMs = medianMs(() => {
      edited = runRules(graph, {
        registry,
        previous: full.state,
        changes: [{ entityId: FIRST_WALL_ID }],
      });
    });

    expect(edited.evaluated).toHaveLength(WALL_DEPENDENT_CODES.length);
    expect(elapsedMs).toBeLessThan(200);
  });
});

/* -------------------------------------------------------------------------- */
/* A pass never reuses an answer measured against another threshold.           */
/* -------------------------------------------------------------------------- */

describe('runRules, when the thresholds move under an unchanged model', () => {
  /** A bar no wall in the sample clears, so the pass has to find something. */
  const STRICT_CONFIG: RuleConfig = setRuleThreshold(
    EMPTY_RULE_CONFIG,
    'WALL-LENGTH',
    'wall.minLengthMm',
    100000,
  );

  function countOf(violations: readonly Violation[], code: string): number {
    return violations.filter((violation) => violation.ruleCode === code).length;
  }

  it('recomputes every task, even when the caller says nothing changed', () => {
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const registry = createDefaultRuleRegistry();

    const asShipped = runRules(graph, { registry });
    const stricter = runRules(graph, {
      registry,
      config: STRICT_CONFIG,
      previous: asShipped.state,
      changes: [],
    });

    expect(countOf(asShipped.violations, 'WALL-LENGTH')).toBe(0);
    expect(countOf(stricter.violations, 'WALL-LENGTH')).toBe(SAMPLE_WALL_COUNT);
    expect(stricter.reusedTaskCount).toBe(0);
  });

  it('gives the same answer as a pass with no previous state at all', () => {
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const registry = createDefaultRuleRegistry();

    const fromScratch = runRules(graph, { registry, config: STRICT_CONFIG });
    const afterAnEdit = runRules(graph, {
      registry,
      config: STRICT_CONFIG,
      previous: runRules(graph, { registry }).state,
      changes: [],
    });

    expect(afterAnEdit.violations).toEqual(fromScratch.violations);
  });

  it('recomputes again when the thresholds are put back', () => {
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const registry = createDefaultRuleRegistry();

    const stricter = runRules(graph, { registry, config: STRICT_CONFIG });
    const restored = runRules(graph, {
      registry,
      config: resetConfig(),
      previous: stricter.state,
      changes: [],
    });

    expect(countOf(restored.violations, 'WALL-LENGTH')).toBe(0);
    expect(restored.reusedTaskCount).toBe(0);
  });

  it('still reuses everything when the config has not moved', () => {
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const registry = createDefaultRuleRegistry();

    const first = runRules(graph, { registry, config: STRICT_CONFIG });
    const second = runRules(graph, {
      registry,
      config: STRICT_CONFIG,
      previous: first.state,
      changes: [],
    });

    expect(second.evaluated).toEqual([]);
    expect(second.reusedTaskCount).toBe(first.state.violationsByTask.size);
    expect(second.violations).toEqual(first.violations);
  });

  it('reuses across passes that are both unconfigured', () => {
    const graph = normalizeSpatial(SAMPLE_BUILDING);
    const registry = createDefaultRuleRegistry();

    const first = runRules(graph, { registry });
    const second = runRules(graph, { registry, previous: first.state, changes: [] });

    expect(second.evaluated).toEqual([]);
    expect(second.violations).toEqual(first.violations);
  });
});
