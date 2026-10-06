import type { OwnedLocation, Point, RealWorldProfile, MenuItem } from './real-world-contract.js';
import { RealWorldError } from './real-world-contract.js';
import { validateSchedule } from './real-world-hours.js';

export function validatePoint(value: unknown): Point {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RealWorldError('LOCATION_INVALID');
  const point = value as Record<string, unknown>;
  if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
      typeof point.longitude !== 'number' || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) {
    throw new RealWorldError('LOCATION_INVALID');
  }
  return { latitude: point.latitude, longitude: point.longitude };
}

const clean = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim().length <= limit ? value.trim() : null;
const nullable = (value: unknown, limit: number): string | null =>
  value === null ? null : clean(value, limit);

export function validateOwnedLocation(value: unknown): OwnedLocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RealWorldError('LOCATION_INVALID');
  const raw = value as Record<string, unknown>;
  const source = raw.source;
  if (source !== 'OWNER_DECLARED' && source !== 'OWNER_MEASURED' && source !== 'ADMIN_DOCUMENTED') {
    throw new RealWorldError('LOCATION_SOURCE_INVALID');
  }
  const verificationNote = clean(raw.verificationNote, 500);
  const verifiedAt = raw.verifiedAt;
  if (!verificationNote || typeof verifiedAt !== 'string' || !Number.isFinite(Date.parse(verifiedAt)) ||
      !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(verifiedAt)) throw new RealWorldError('LOCATION_EVIDENCE_INVALID');
  const floor = nullable(raw.floor, 80), unit = nullable(raw.unit, 80), entranceNote = nullable(raw.entranceNote, 500);
  if (raw.floor !== null && floor === null || raw.unit !== null && unit === null ||
      raw.entranceNote !== null && entranceNote === null) throw new RealWorldError('LOCATION_INVALID');
  return {
    building: validatePoint(raw.building), entrance: raw.entrance === null ? null : validatePoint(raw.entrance),
    floor, unit, entranceNote, source, verificationNote, verifiedAt: new Date(verifiedAt).toISOString(),
  };
}

function menuItem(value: unknown): MenuItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RealWorldError('PROFILE_INVALID');
  const raw = value as Record<string, unknown>;
  const id = clean(raw.id, 80), name = clean(raw.name, 100);
  const priceNote = nullable(raw.priceNote, 120);
  if (!id || !name || (raw.priceNote !== null && priceNote === null) ||
      !(raw.priceWon === null || Number.isSafeInteger(raw.priceWon) && (raw.priceWon as number) >= 0) ||
      !(raw.photoId === null || typeof raw.photoId === 'string' && raw.photoId.length <= 80)) {
    throw new RealWorldError('PROFILE_INVALID');
  }
  return { id, name, priceWon: raw.priceWon as number | null, priceNote, photoId: raw.photoId as string | null };
}

export function validateRealWorldProfile(value: unknown): RealWorldProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RealWorldError('PROFILE_INVALID');
  const raw = value as Record<string, unknown>;
  const contact = raw.contact;
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) throw new RealWorldError('PROFILE_INVALID');
  const details = contact as Record<string, unknown>;
  const phone = nullable(details.phone, 40), website = nullable(details.website, 300);
  const visitInstructions = clean(raw.visitInstructions, 1000);
  if (visitInstructions === null || raw.phone !== undefined ||
      (details.phone !== null && phone === null) || (details.website !== null && website === null) ||
      (website && !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(website)) ||
      !Array.isArray(raw.menuItems) || raw.menuItems.length > 100) throw new RealWorldError('PROFILE_INVALID');
  const menuItems = raw.menuItems.map(menuItem);
  if (new Set(menuItems.map(item => item.id)).size !== menuItems.length) throw new RealWorldError('PROFILE_INVALID');
  const schedule = raw.schedule === null ? null : validateSchedule(raw.schedule);
  const todayOverride = raw.todayOverride;
  if (todayOverride !== null) {
    if (!todayOverride || typeof todayOverride !== 'object' || Array.isArray(todayOverride)) throw new RealWorldError('OVERRIDE_INVALID');
    const o = todayOverride as Record<string, unknown>;
    if (o.state !== 'OPEN' && o.state !== 'CLOSED' || typeof o.startsAt !== 'string' ||
        typeof o.expiresAt !== 'string' || !Number.isFinite(Date.parse(o.startsAt)) ||
        !Number.isFinite(Date.parse(o.expiresAt)) || Date.parse(o.startsAt) >= Date.parse(o.expiresAt) ||
        !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(o.startsAt) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(o.expiresAt) ||
        Date.parse(o.expiresAt) - Date.parse(o.startsAt) > 48 * 3600_000 || !clean(o.note, 300)) {
      throw new RealWorldError('OVERRIDE_INVALID');
    }
  }
  return {
    location: raw.location === null ? null : validateOwnedLocation(raw.location), schedule,
    todayOverride: todayOverride as RealWorldProfile['todayOverride'], menuItems, visitInstructions,
    contact: { phone, website },
  };
}
