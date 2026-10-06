/** Versioned real-world contract. Legacy /merchants and transaction ledgers retain their meanings. */
export type Point = { latitude: number; longitude: number };
export type Bounds = { west: number; south: number; east: number; north: number };
export type LocationSource = 'OWNER_DECLARED' | 'OWNER_MEASURED' | 'ADMIN_DOCUMENTED';
export type OwnedLocation = {
  building: Point; entrance: Point | null; floor: string | null; unit: string | null;
  entranceNote: string | null; source: LocationSource; verificationNote: string; verifiedAt: string;
};
export type OpeningPeriod = { startMinute: number; endMinute: number; lastOrderMinute: number | null };
export type BusinessSchedule = {
  timezone: 'Asia/Seoul';
  weekly: { weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; periods: OpeningPeriod[] }[];
  exceptions: { date: string; periods: OpeningPeriod[]; note: string | null }[];
  verifiedAt: string | null;
};
export type BusinessOverride = { state: 'OPEN' | 'CLOSED'; startsAt: string; expiresAt: string; note: string };
export type BusinessState = {
  state: 'OPEN' | 'CLOSED' | 'BREAK' | 'UNKNOWN'; basis: 'SCHEDULE' | 'OWNER_OVERRIDE' | 'UNKNOWN';
  evaluatedAt: string; nextChangeAt: string | null; informationUpdatedAt: string | null;
  acceptingOrders: boolean | null; lastOrderAt: string | null;
};
export type PhotoKind = 'STORE' | 'MENU' | 'ENTRANCE' | 'PACKAGING' | 'SIGN';
export type MerchantPhoto = {
  id: string; url: string; width: number; height: number; kind: PhotoKind;
  source: 'OWNER_PHOTO'; caption: string | null; updatedAt: string;
};
export type MenuItem = { id: string; name: string; priceWon: number | null; priceNote: string | null; photoId: string | null };
export type RealWorldProfile = {
  location: OwnedLocation | null; schedule: BusinessSchedule | null; todayOverride: BusinessOverride | null;
  menuItems: MenuItem[]; visitInstructions: string; contact: { phone: string | null; website: string | null };
};
export type CampaignSummary = {
  id: string; title: string; startsAt: string; endsAt: string;
  state: 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED'; enrollment: 'OPEN' | 'FULL' | 'CLOSED';
  rewardAvailability: 'AVAILABLE' | 'EXHAUSTED' | 'NOT_RUNNING' | 'UNKNOWN';
  goals: { targetVisitCount: 1 | 3 | 5; displayName: string }[];
};
export type DistanceOrigin = 'MAP_CENTER' | 'MANUAL' | 'CURRENT_LOCATION';
export type MerchantSummary = {
  id: string; name: string; roadAddress: string; category: string | null; demo: boolean;
  profileVersion: number; position: Point | null; positionBasis: 'OWNED' | 'UNVERIFIED';
  positionExpiresAt: null; floor: string | null; entranceNote: string | null;
  thumbnail: MerchantPhoto | null; business: BusinessState; campaign: CampaignSummary | null;
  distance: { meters: number; kind: 'STRAIGHT_LINE'; origin: DistanceOrigin } | null;
};
export type MerchantDetail = MerchantSummary & Omit<RealWorldProfile, 'location'> & {
  location: Omit<OwnedLocation, 'verificationNote'> | null;
  story: string; legacyBusinessHours: string; minimumSpendWon: number; photos: MerchantPhoto[]; updatedAt: string;
};
export type DiscoveryQuery = {
  bounds: Bounds; zoom: number; query?: string; category?: string; campaignOnly?: boolean; openOnly?: boolean;
  origin?: Point & { basis: DistanceOrigin }; cursor?: string; limit?: number;
};
export type MapCluster = { id: string; position: Point; count: number; bounds: Bounds };
export type DiscoveryPage = {
  schemaVersion: 1; asOf: string; merchants: MerchantSummary[]; clusters: MapCluster[];
  nextCursor: string | null; unlocatedCount: number;
};
export type ExternalPlace = {
  id: string; provider: 'TMAP'; participation: 'EXTERNAL_PLACE'; name: string; roadAddress: string;
  point: Point; entrance: Point | null; fetchedAt: string; expiresAt: string;
};
export type PlacePage = {
  places: ExternalPlace[]; nextCursor: string | null; fetchedAt: string; expiresAt: string; attribution: string;
};
export type LocationCandidate = ExternalPlace & { candidateId: string };
export type WalkingLeg = {
  mode: 'WALK'; provider: 'TMAP';
  geometry: { type: 'MultiLineString'; coordinates: number[][][] };
  travelSeconds: number; travelMeters: number; fetchedAt: string; expiresAt: string; attribution: string;
};
export type WalkingRoute = WalkingLeg & {
  schemaVersion: 1; dwellSeconds: number;
  stops: { merchantId: string; profileVersion: number; arrivalAt: string; departureAt: string;
    warnings: ('HOURS_UNKNOWN' | 'CLOSED_AT_ARRIVAL' | 'CAMPAIGN_UNAVAILABLE' | 'ORDER_CLOSED')[] }[];
};
export type WalkingRouteInput = { origin: Point; merchantIds: string[]; departureAt: string; dwellMinutes: number[] };
export type DiscoveryEvent = {
  eventId: string; merchantId: string; event: 'MAP_SELECT' | 'DETAIL_VIEW' | 'DIRECTIONS_OPEN' | 'GOAL_SAVE';
  source: 'list' | 'map' | 'recommendation' | 'collection' | 'friend' | 'link' | 'other';
};
export type Engagement = {
  merchantId: string; from: string; to: string;
  counts: { mapSelect: number; detailView: number; directionsOpen: number; goalSave: number };
};
export type MerchantReport = {
  id: string; merchantId: string; kind: 'LOCATION' | 'HOURS' | 'PHOTO' | 'OTHER';
  note: string; status: 'OPEN' | 'RESOLVED' | 'REJECTED'; createdAt: string; resolution: string | null;
};
export type PhotoUploadInput = {
  expectedVersion: number; kind: PhotoKind; caption: string | null; rightsConfirmed: true;
  bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};
export type RealWorldProfileView = {
  schemaVersion: 1; asOf: string; merchantId: string; version: number; profile: RealWorldProfile;
  photos: MerchantPhoto[]; preview?: MerchantDetail; readiness: { key: string; ready: boolean; label: string; field: string }[];
};
export type RealGameContext = {
  merchantId: string; merchantName: string; roadAddress: string; profileVersion: number;
  menuItems: MenuItem[]; photos: MerchantPhoto[]; campaign: CampaignSummary | null;
};
export type RealWorldMediaStore = {
  save(bytes: Uint8Array, mimeType: PhotoUploadInput['mimeType']): Promise<{ digest: string; width: number; height: number }>;
  read(digest: string): Promise<Uint8Array | null>;
};
export class RealWorldError extends Error {
  constructor(public readonly code: string, public readonly status = 400, public readonly retryable = false) {
    super(code); this.name = 'RealWorldError';
  }
}
