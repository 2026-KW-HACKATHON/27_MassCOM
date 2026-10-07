import type { ScreenId } from "./catalog";
import type { GameSession } from "./game-model";
import type { Room } from "./model";

export const roomEditRoutes: readonly ScreenId[] = ["03-1", "03-2", "04-0", "04-1"];
export const gameScreenRoutes: readonly ScreenId[] = ["15-2", "16-0", "16-1", "16-2"];

export function leaveGuard(
  from: ScreenId,
  to: ScreenId,
  draft: Room,
  saved: Room,
  game: GameSession | null,
  replacesGame = false,
): "room" | "game" | null {
  if (replacesGame && game && !game.done) return "game";
  if (from === to) return null;
  if (roomEditRoutes.includes(from) && !roomEditRoutes.includes(to) &&
      JSON.stringify(draft) !== JSON.stringify(saved)) return "room";
  if (game && !game.done && ![...gameScreenRoutes, "17-0", "15-1"].includes(to))
    return "game";
  return null;
}
