import { SubmarineExecution } from "../src/core/execution/SubmarineExecution";
import { SubmarineTargetExecution } from "../src/core/execution/SubmarineTargetExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

function buildSubmarine(owner: Player, tile: TileRef): Unit {
  return owner.buildUnit(UnitType.Submarine, tile, {
    patrolTile: tile,
  });
}

function buildWarship(owner: Player, tile: TileRef): Unit {
  return owner.buildUnit(UnitType.Warship, tile, {
    patrolTile: tile,
  });
}

// Find a run of `count` consecutive ocean tiles on the same row, plus a land
// tile next to the first one (a shore tile to build a port on).
function findOceanRun(count: number): {
  ocean: TileRef[];
  shore: TileRef;
} {
  for (let y = 0; y < game.map().height(); y++) {
    for (let x = 0; x < game.map().width() - count; x++) {
      const tiles: TileRef[] = [];
      for (let i = 0; i < count; i++) {
        const t = game.ref(x + i, y);
        if (!game.isWater(t)) break;
        tiles.push(t);
      }
      if (tiles.length !== count) continue;
      // The tile immediately to the left must be land (a shore).
      if (x === 0) continue;
      const left = game.ref(x - 1, y);
      if (!game.isLand(left)) continue;
      return { ocean: tiles, shore: left };
    }
  }
  throw new Error("no ocean run found on test map");
}

describe("Submarine (U-boat)", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("attacker", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
      ],
    );
    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("is faster but has less health and a lower cost than a warship", async () => {
    // Costs are free under infiniteGold, so use a fresh non-infinite game.
    const pricedGame = await setup(
      "half_land_half_ocean",
      {},
      [new PlayerInfo("p", PlayerType.Human, null, "priced_id")],
    );
    const p = pricedGame.player("priced_id");
    const warshipInfo = pricedGame.config().unitInfo(UnitType.Warship);
    const submarineInfo = pricedGame.config().unitInfo(UnitType.Submarine);

    expect(submarineInfo.maxHealth).toBeLessThan(warshipInfo.maxHealth ?? 0);
    expect(pricedGame.config().submarineMovePerTick()).toBeGreaterThan(1);
    expect(submarineInfo.cost(pricedGame, p)).toBeLessThan(
      warshipInfo.cost(pricedGame, p),
    );
  });

  test("kamikazes the manually targeted warship and sinks itself", () => {
    const { ocean } = findOceanRun(4);
    // Decoy is closer to the submarine — the manual target must still win.
    const submarine = buildSubmarine(player1, ocean[0]);
    const decoy = buildWarship(player2, ocean[1]);
    const target = buildWarship(player2, ocean[3]);

    game.addExecution(
      new SubmarineTargetExecution(player1, submarine.id(), target.id()),
    );
    game.addExecution(new SubmarineExecution(submarine));
    game.executeNextTick();

    expect(submarine.submarineState().kamikazeTargetId).toBe(target.id());

    const maxTicks = 200;
    let ticks = 0;
    while (ticks < maxTicks && (submarine.isActive() || target.isActive())) {
      game.executeNextTick();
      ticks++;
    }

    expect(target.isActive()).toBe(false);
    expect(submarine.isActive()).toBe(false);
    expect(decoy.isActive()).toBe(true);
  });

  test("auto-hunts the nearest enemy warship when no target is set", () => {
    const { ocean } = findOceanRun(4);
    const submarine = buildSubmarine(player1, ocean[0]);
    const target = buildWarship(player2, ocean[3]);

    game.addExecution(new SubmarineExecution(submarine));

    const maxTicks = 300;
    let ticks = 0;
    while (ticks < maxTicks && (submarine.isActive() || target.isActive())) {
      game.executeNextTick();
      ticks++;
    }

    expect(target.isActive()).toBe(false);
    expect(submarine.isActive()).toBe(false);
  });

  test("does not kamikaze a friendly warship", () => {
    const { ocean } = findOceanRun(3);
    const submarine = buildSubmarine(player1, ocean[0]);
    const friendly = buildWarship(player1, ocean[2]);

    game.addExecution(
      new SubmarineTargetExecution(player1, submarine.id(), friendly.id()),
    );
    game.executeNextTick();

    expect(submarine.submarineState().kamikazeTargetId).toBeUndefined();
    expect(friendly.isActive()).toBe(true);
  });

  test("builds through the normal construction path", () => {
    const { ocean, shore } = findOceanRun(3);
    // canBuild requires a living player (territory).
    player1.conquer(game.ref(0, 0));
    player1.buildUnit(UnitType.Port, shore, {});

    const spawn = player1.canBuild(UnitType.Submarine, ocean[0]);
    expect(spawn).not.toBe(false);

    const built = player1.buildUnit(UnitType.Submarine, spawn as TileRef, {
      patrolTile: ocean[0],
    });
    expect(built.type()).toBe(UnitType.Submarine);
    expect(built.submarineState().state).toBe("patrolling");
    expect(built.health()).toBeLessThan(1000);
  });
});
