import type { ExperienceSnapshot } from './experience-api';

/** Preview catalogue artwork freely; saving still requires current ownership of every piece. */
export function themeOutfit(snapshot: ExperienceSnapshot, packId: string) {
  const pack = snapshot.catalog.packs.find((entry) => entry.id === packId);
  const items = pack?.bonusItemIds.map((id) => snapshot.catalog.cosmetics.find((entry) => entry.id === id));
  if (!items || items.length !== 3 || items.some((item) => !item || item.source.kind !== 'pack' || item.source.packId !== packId)
    || !['hat', 'prop', 'decor'].every((slot) => items.filter((item) => item?.slot === slot).length === 1)) return undefined;
  const cosmetics = Object.fromEntries(items.map((item) => [item!.slot, item!.id])) as { hat: string; prop: string; decor: string };
  const canEquip = items.every((item) => snapshot.progress.cosmetics.some((entry) => entry.id === item!.id && entry.owned && entry.equippable));
  return { cosmetics, canEquip, profile: { ...snapshot.profile, cosmetics: { ...snapshot.profile.cosmetics, ...cosmetics } } };
}
