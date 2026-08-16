import { Execution, Game, Player, UnitType } from "../game/Game";

/**
 * Points one of the player's submarines at a specific enemy warship.
 * The submarine then chases and rams it (see SubmarineExecution).
 */
export class SubmarineTargetExecution implements Execution {
  private active = true;

  constructor(
    private owner: Player,
    private readonly unitId: number,
    private readonly targetUnitId: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    const submarine = mg.unit(this.unitId);
    if (
      submarine === undefined ||
      submarine.type() !== UnitType.Submarine ||
      submarine.owner() !== this.owner ||
      !submarine.isActive()
    ) {
      console.warn(`submarine_target: unit ${this.unitId} not found or invalid`);
      this.active = false;
      return;
    }

    const target = mg.unit(this.targetUnitId);
    if (
      target === undefined ||
      target.type() !== UnitType.Warship ||
      target.owner() === this.owner ||
      !this.owner.canAttackPlayer(target.owner(), true) ||
      !target.isActive()
    ) {
      console.warn(
        `submarine_target: target ${this.targetUnitId} not found or invalid`,
      );
      this.active = false;
      return;
    }

    submarine.updateSubmarineState({
      state: "hunting",
      kamikazeTargetId: target.id(),
    });
    this.active = false;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
