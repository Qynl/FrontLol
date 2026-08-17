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
import { ShellExecution } from "./ShellExecution";

/**
 * Destroyer (Zerstörer) behaviour.
 *
 * The anti-submarine escort of the navy. It fires shells like a warship but
 * prioritises enemy submarines — the only unit that can reliably stop a
 * kamikaze U-boat before it reaches a friendly warship. Destroyers still
 * engage transports, warships and trade ships when no submarine is in range,
 * though they cannot capture trade ships.
 */
export class DestroyerExecution implements Execution {
  private random: PseudoRandom;
  private destroyer: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastEmittedCombat = false;

  constructor(
    private input: (UnitParams<UnitType.Destroyer> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.destroyer = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Destroyer,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn destroyer for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.destroyer = this.input.owner.buildUnit(
        UnitType.Destroyer,
        spawn,
        this.input,
      );
    }
  }

  tick(ticks: number): void {
    if (this.destroyer.health() <= 0) {
      this.destroyer.delete();
      return;
    }
    const isInCombat = this.destroyer.destroyerState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.destroyer.touch();
    }
    this.lastEmittedCombat = isInCombat;

    const target = this.findTargetUnit();
    this.destroyer.setTargetUnit(target);
    if (target !== undefined) {
      this.destroyer.updateDestroyerState({
        state: "hunting",
        isInCombat: true,
      });
      if (target.type() === UnitType.Submarine) {
        this.huntSubmarine(target);
      } else {
        this.shootTarget();
        this.patrol();
      }
      return;
    }

    this.destroyer.updateDestroyerState({
      state: "patrolling",
      isInCombat: false,
    });
    this.patrol();
  }

  private findTargetUnit(): Unit | undefined {
    const mg = this.mg;
    const owner = this.destroyer.owner();
    const units = mg.nearbyUnits(
      this.destroyer.tile(),
      mg.config().destroyerTargettingRange(),
      [
        UnitType.Submarine,
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.TradeShip,
      ],
    );

    let bestUnit: Unit | undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of units) {
      if (
        unit === this.destroyer ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit) ||
        (unit.type() === UnitType.Warship &&
          unit.warshipState().state === "docked")
      ) {
        continue;
      }

      const typePriority = this.typePriority(unit.type());
      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  /** Lower = higher priority: submarines first, then transports, warships, trades. */
  private typePriority(type: UnitType): number {
    switch (type) {
      case UnitType.Submarine:
        return 0;
      case UnitType.TransportShip:
        return 1;
      case UnitType.Warship:
        return 2;
      case UnitType.TradeShip:
        return 3;
      default:
        return 4;
    }
  }

  private huntSubmarine(target: Unit) {
    this.destroyer.updateDestroyerState({
      state: "hunting",
      isInCombat: true,
    });
    const movePerTick = this.mg.config().destroyerMovePerTick();
    for (let i = 0; i < movePerTick; i++) {
      const dist = this.mg.manhattanDist(this.destroyer.tile(), target.tile());
      if (dist <= 1) {
        break;
      }
      const next = this.bestNeighborToward(target.tile());
      if (next === undefined) {
        break;
      }
      this.destroyer.move(next);
    }
    this.shootTarget();
  }

  private shootTarget() {
    const target = this.destroyer.targetUnit();
    if (target === undefined) return;
    this.destroyer.updateDestroyerState({ isInCombat: true });
    const attackRate = this.mg.config().destroyerShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > attackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.destroyer.tile(),
          this.destroyer.owner(),
          this.destroyer,
          target,
        ),
      );
      if (!target.hasHealth()) {
        // Don't send multiple shells to a target that can be oneshotted.
        this.alreadySentShell.add(target);
        this.destroyer.setTargetUnit(undefined);
      }
    }
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const tile = this.destroyer.tile();
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
    if (this.destroyer.targetTile() === undefined) {
      this.destroyer.setTargetTile(this.randomTile());
      if (this.destroyer.targetTile() === undefined) {
        return;
      }
    }

    const movePerTick = this.mg.config().destroyerMovePerTick();
    for (let i = 0; i < movePerTick; i++) {
      const result = this.pathfinder.next(
        this.destroyer.tile(),
        this.destroyer.targetTile()!,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.destroyer.setTargetTile(undefined);
          this.destroyer.move(result.node);
          return;
        case PathStatus.NEXT:
          this.destroyer.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          this.destroyer.setTargetTile(undefined);
          return;
      }
    }
  }

  isActive(): boolean {
    return this.destroyer?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let patrolRange = this.mg.config().destroyerPatrolRange();
    const maxAttemptBeforeExpand = 500;
    let attempts = 0;
    let expandCount = 0;

    const component = this.mg.getWaterComponent(this.destroyer.tile());
    const patrolTile = this.destroyer.destroyerState().patrolTile;
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
      `Failed to find random tile for destroyer for ${this.destroyer.owner().name()}`,
    );
    if (!allowShoreline) {
      return this.randomTile(true);
    }
    return undefined;
  }
}
