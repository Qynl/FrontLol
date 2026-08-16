import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";

/**
 * Submarine (U-boat) behaviour.
 *
 * Faster than a warship (see submarineMovePerTick) and cheaper, but with less
 * health. It has no guns: instead it rams an enemy warship and detonates,
 * sinking both ships. A submarine can be manually pointed at a specific enemy
 * warship (see SubmarineTargetExecution); otherwise it auto-hunts the nearest
 * enemy warship in range and patrols when there is nothing to hit.
 */
export class SubmarineExecution implements Execution {
  private random: PseudoRandom;
  private submarine: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastEmittedCombat = false;

  constructor(
    private input: (UnitParams<UnitType.Submarine> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.submarine = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Submarine,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn submarine for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.submarine = this.input.owner.buildUnit(
        UnitType.Submarine,
        spawn,
        this.input,
      );
    }
  }

  tick(ticks: number): void {
    if (this.submarine.health() <= 0) {
      this.submarine.delete();
      return;
    }
    const isInCombat = this.submarine.submarineState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.submarine.touch();
    }
    this.lastEmittedCombat = isInCombat;

    const target = this.resolveTarget();
    if (target !== undefined) {
      if (this.ramIfAdjacent(target)) {
        return;
      }
      this.hunt(target);
      return;
    }

    this.submarine.updateSubmarineState({ isInCombat: false });
    this.patrol();
  }

  private resolveTarget(): Unit | undefined {
    // Manual kamikaze override, set by the player (or AI) via
    // SubmarineTargetExecution. Validate it every tick so a sunk target (or a
    // broken alliance) releases the submarine back to auto-hunt/patrol.
    const manualId = this.submarine.submarineState().kamikazeTargetId;
    if (manualId !== undefined) {
      const manual = this.mg.unit(manualId);
      if (this.isValidTarget(manual)) {
        return manual;
      }
      this.submarine.updateSubmarineState({ kamikazeTargetId: undefined });
    }
    return this.findNearestEnemyWarship();
  }

  private isValidTarget(unit: Unit | undefined): unit is Unit {
    return (
      unit !== undefined &&
      unit.isActive() &&
      unit.type() === UnitType.Warship &&
      unit.owner() !== this.submarine.owner() &&
      this.submarine.owner().canAttackPlayer(unit.owner(), true) &&
      unit.warshipState().state !== "docked"
    );
  }

  private findNearestEnemyWarship(): Unit | undefined {
    const mg = this.mg;
    const ships = mg.nearbyUnits(
      this.submarine.tile(),
      mg.config().submarineTargettingRange(),
      UnitType.Warship,
    );

    let best: { unit: Unit; distSquared: number } | undefined;
    for (const { unit, distSquared } of ships) {
      if (!this.isValidTarget(unit)) {
        continue;
      }
      if (
        best === undefined ||
        distSquared < best.distSquared ||
        (distSquared === best.distSquared && unit.id() < best.unit.id())
      ) {
        best = { unit, distSquared };
      }
    }
    return best?.unit;
  }

  private ramIfAdjacent(target: Unit): boolean {
    const dist = this.mg.manhattanDist(this.submarine.tile(), target.tile());
    if (dist > 1) {
      return false;
    }
    this.submarine.updateSubmarineState({ isInCombat: true });
    // Kamikaze: deal lethal damage to the target warship, then self-destruct.
    // A fixed overkill margin guarantees the ram sinks even a veteran warship
    // whose effective max health exceeds the base value.
    target.modifyHealth(-(target.maxHealth() + 1000), this.submarine.owner());
    this.submarine.delete(false, target.owner());
    return true;
  }

  private hunt(target: Unit) {
    this.submarine.updateSubmarineState({
      state: "hunting",
      isInCombat: true,
    });
    const movePerTick = this.mg.config().submarineMovePerTick();
    for (let i = 0; i < movePerTick; i++) {
      const current = this.submarine.tile();
      const dist = this.mg.manhattanDist(current, target.tile());
      if (dist <= 1) {
        break;
      }
      const next = this.bestNeighborToward(target.tile());
      if (next === undefined) {
        break;
      }
      this.submarine.move(next);
    }
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const tile = this.submarine.tile();
    let best: TileRef | undefined;
    let bestDist = this.mg.manhattanDist(tile, targetTile);
    this.mg.forEachNeighbor(tile, (neighbor) => {
      if (!this.mg.isWater(neighbor)) return;
      const d = this.mg.manhattanDist(neighbor, targetTile);
      if (d < bestDist) {
        bestDist = d;
        best = neighbor;
      }
    });
    return best;
  }

  private patrol() {
    this.submarine.updateSubmarineState({ state: "patrolling" });
    if (this.submarine.targetTile() === undefined) {
      this.submarine.setTargetTile(this.randomTile());
      if (this.submarine.targetTile() === undefined) {
        return;
      }
    }

    const movePerTick = this.mg.config().submarineMovePerTick();
    for (let i = 0; i < movePerTick; i++) {
      const result = this.pathfinder.next(
        this.submarine.tile(),
        this.submarine.targetTile()!,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.submarine.setTargetTile(undefined);
          this.submarine.move(result.node);
          return;
        case PathStatus.NEXT:
          this.submarine.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          this.submarine.setTargetTile(undefined);
          return;
      }
    }
  }

  isActive(): boolean {
    return this.submarine?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let patrolRange = this.mg.config().submarinePatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;

    const component = this.mg.getWaterComponent(this.submarine.tile());
    const patrolTile = this.submarine.submarineState().patrolTile;
    // Guard against an invalid patrolTile, which would make every candidate
    // coordinate NaN and spin the loop forever (see WarshipExecution).
    if (patrolTile === undefined || !this.mg.isValidRef(patrolTile)) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-patrolRange / 2, patrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isWater(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          patrolRange = patrolRange + Math.floor(patrolRange / 2);
        }
        continue;
      }
      if (component !== null && !this.mg.hasWaterComponent(tile, component)) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          patrolRange = patrolRange + Math.floor(patrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for submarine for ${this.submarine.owner().name()}`,
    );
    if (!allowShoreline) {
      return this.randomTile(true);
    }
    return undefined;
  }
}
