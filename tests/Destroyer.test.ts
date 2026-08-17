import { DestroyerExecution } from "../src/core/execution/DestroyerExecution";
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

function buildDestroyer(owner: Player, tile: TileRef): Unit {
  return owner.buildUnit(UnitType.Destroyer, tile, {
    patrolTile: tile,
  });
}

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
      if (x === 0) continue;
      const left = game.ref(x - 1, y);
      if (!game.isLand(left)) continue;
      return { ocean: tiles, shore: left };
    }
  }
  throw new Error("no ocean run found on test map");
}

describe("Destroyer (Zerstörer)", () => {
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

  test("sits between a submarine and a warship in cost and health", async () => {
    const pricedGame = await setup(
      "half_land_half_ocean",
      {},
      [new PlayerInfo("p", PlayerType.Human, null, "priced_id")],
    );
    const p = pricedGame.player("priced_id");
    const warshipInfo = pricedGame.config().unitInfo(UnitType.Warship);
    const destroyerInfo = pricedGame.config().unitInfo(UnitType.Destroyer);
    const submarineInfo = pricedGame.config().unitInfo(UnitType.Submarine);

    expect(destroyerInfo.maxHealth).toBeLessThan(
      warshipInfo.maxHealth ?? Infinity,
    );
    expect(destroyerInfo.maxHealth).toBeGreaterThan(
      submarineInfo.maxHealth ?? 0,
    );
    expect(destroyerInfo.cost(pricedGame, p)).toBeLessThan(
      warshipInfo.cost(pricedGame, p),
    );
    expect(destroyerInfo.cost(pricedGame, p)).toBeGreaterThan(
      submarineInfo.cost(pricedGame, p),
    );
    expect(pricedGame.config().destroyerMovePerTick()).toBeGreaterThan(1);
  });

  test("shoots and sinks an enemy submarine", () => {
    const { ocean } = findOceanRun(4);
    const destroyer = buildDestroyer(player1, ocean[0]);
    const submarine = buildSubmarine(player2, ocean[3]);

    game.addExecution(new DestroyerExecution(destroyer));

    const maxTicks = 600;
    let ticks = 0;
    while (ticks < maxTicks && (destroyer.isActive() || submarine.isActive())) {
      game.executeNextTick();
      ticks++;
    }

    expect(submarine.isActive()).toBe(false);
    expect(destroyer.isActive()).toBe(true);
  });

  test("prioritizes an enemy submarine over a closer warship", () => {
    const { ocean } = findOceanRun(5);
    const destroyer = buildDestroyer(player1, ocean[0]);
    const warship = buildWarship(player2, ocean[1]);
    const submarine = buildSubmarine(player2, ocean[4]);

    game.addExecution(new DestroyerExecution(destroyer));
    // First tick inits the execution, the second runs its tick() and targets.
    game.executeNextTick();
    game.executeNextTick();

    expect(destroyer.targetUnit()?.id()).toBe(submarine.id());
    expect(warship.isActive()).toBe(true);
  });

  test("does not shoot friendly submarines", () => {
    const { ocean } = findOceanRun(4);
    const destroyer = buildDestroyer(player1, ocean[0]);
    const friendlySub = buildSubmarine(player1, ocean[1]);
    const enemyWarship = buildWarship(player2, ocean[3]);

    game.addExecution(new DestroyerExecution(destroyer));
    // First tick inits the execution, the second runs its tick() and targets.
    game.executeNextTick();
    game.executeNextTick();

    expect(destroyer.targetUnit()?.id()).toBe(enemyWarship.id());
    expect(friendlySub.isActive()).toBe(true);
  });

  test("builds through the normal construction path", () => {
    const { ocean, shore } = findOceanRun(3);
    player1.conquer(game.ref(0, 0));
    player1.buildUnit(UnitType.Port, shore, {});

    const spawn = player1.canBuild(UnitType.Destroyer, ocean[0]);
    expect(spawn).not.toBe(false);

    const built = player1.buildUnit(UnitType.Destroyer, spawn as TileRef, {
      patrolTile: ocean[0],
    });
    expect(built.type()).toBe(UnitType.Destroyer);
    expect(built.destroyerState().state).toBe("patrolling");
  });
});
