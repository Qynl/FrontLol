import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitIds: number[],
    private readonly position: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent = mg.getWaterComponent(this.position);
    // Cache ships and build a lookup map — avoids repeated iteration.
    const shipMap = new Map(
      [
        ...this.owner.units(UnitType.Warship),
        ...this.owner.units(UnitType.Submarine),
        ...this.owner.units(UnitType.Destroyer),
      ].map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each ship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const ship = shipMap.get(unitId);
      if (!ship) {
        console.warn(`MoveWarshipExecution: ship ${unitId} not found`);
        continue;
      }
      if (!ship.isActive()) {
        console.warn(`MoveWarshipExecution: ship ${unitId} is not active`);
        continue;
      }
      // Do not update the ship's patrolTile if it is in a different Water Component
      if (!mg.hasWaterComponent(ship.tile(), newPatrolTileWaterComponent!)) {
        continue;
      }
      if (ship.type() === UnitType.Submarine) {
        ship.updateSubmarineState({
          patrolTile: this.position,
          kamikazeTargetId: undefined,
        });
      } else if (ship.type() === UnitType.Destroyer) {
        ship.updateDestroyerState({
          patrolTile: this.position,
        });
      } else {
        ship.updateWarshipState({
          patrolTile: this.position,
        });
      }
      ship.setTargetTile(undefined);
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
