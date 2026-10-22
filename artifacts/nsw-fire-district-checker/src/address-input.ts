const ROAD_TYPES: Record<string, string> = {
  AV: 'AVENUE', AVE: 'AVENUE', AVENUE: 'AVENUE',
  ST: 'STREET', STREET: 'STREET', RD: 'ROAD', ROAD: 'ROAD',
  PL: 'PLACE', PLACE: 'PLACE', DR: 'DRIVE', DRIVE: 'DRIVE',
  CT: 'COURT', COURT: 'COURT', CL: 'CLOSE', CLOSE: 'CLOSE',
  CR: 'CRESCENT', CRES: 'CRESCENT', CRESCENT: 'CRESCENT',
  CCT: 'CIRCUIT', CIRCUIT: 'CIRCUIT', TCE: 'TERRACE', TERRACE: 'TERRACE',
  PDE: 'PARADE', PARADE: 'PARADE', HWY: 'HIGHWAY', HIGHWAY: 'HIGHWAY',
  FWY: 'FREEWAY', FREEWAY: 'FREEWAY', MWY: 'MOTORWAY', MOTORWAY: 'MOTORWAY',
  LN: 'LANE', LANE: 'LANE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD', BOULEVARD: 'BOULEVARD',
  ESP: 'ESPLANADE', ESPLANADE: 'ESPLANADE', GR: 'GROVE', GROVE: 'GROVE',
  GRN: 'GREEN', GREEN: 'GREEN', GDNS: 'GARDENS', GARDENS: 'GARDENS',
  GDN: 'GARDEN', GARDEN: 'GARDEN', PKWY: 'PARKWAY', PARKWAY: 'PARKWAY',
  WAY: 'WAY', WALK: 'WALK', RISE: 'RISE', ROW: 'ROW', SQ: 'SQUARE', SQUARE: 'SQUARE',
  TRK: 'TRACK', TRACK: 'TRACK', TRL: 'TRAIL', TRAIL: 'TRAIL',
  LOOP: 'LOOP', LINK: 'LINK', COVE: 'COVE', CH: 'CHASE', CHASE: 'CHASE',
  RDGE: 'RIDGE', RIDGE: 'RIDGE', VIEW: 'VIEW', VSTA: 'VISTA', VISTA: 'VISTA',
  QY: 'QUAY', QUAY: 'QUAY', CNR: 'CORNER', CORNER: 'CORNER',
  HTS: 'HEIGHTS', HEIGHTS: 'HEIGHTS', CIRC: 'CIRCLE', CIRCLE: 'CIRCLE',
};

export type AddressSearchInput = {
  houseNumber: string;
  roadName: string;
  roadType?: string;
  suburb?: string;
  postCode?: string;
};

export function normalizeHouseNumber(value: string): string {
  return value.toUpperCase().replace(/[–—]/g, '-').replace(/\s/g, '');
}

export function parseAddressInput(streetAddress: string, locality: string): AddressSearchInput {
  const parts = streetAddress.trim().split(',').map((part) => part.trim()).filter(Boolean);
  const street = parts[0] ?? '';
  const match = street.match(/^(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)\s+(.+)$/i);
  if (!match) throw new Error('Enter a house number and street, for example 346 Panorama Avenue. Search the property address without a unit number.');
  const houseNumber = normalizeHouseNumber(match[1]);
  const words = match[2].trim().split(/\s+/);
  const typeIndex = words.findIndex((word, index) => index > 0 && Boolean(ROAD_TYPES[word.toUpperCase().replace(/\.$/, '')]));
  const roadType = typeIndex >= 0 ? ROAD_TYPES[words[typeIndex].toUpperCase().replace(/\.$/, '')] : undefined;
  const roadName = (typeIndex >= 0 ? words.slice(0, typeIndex) : words).join(' ');
  const trailingLocality = typeIndex >= 0 ? words.slice(typeIndex + 1).join(' ') : '';
  let place = (locality.trim() || parts.slice(1).join(' ') || trailingLocality)
    .replace(/\b(?:NEW SOUTH WALES|NSW|AUSTRALIA)\b/gi, ' ').trim();
  const postCode = place.match(/\b\d{4}\b/)?.[0];
  if (postCode) place = place.replace(new RegExp(`\\b${postCode}\\b`), '').trim();
  const suburb = place.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!suburb && !postCode) throw new Error('Enter a suburb or a four-digit postcode so GURAS can locate the street address.');
  if (!roadName || roadName.length > 60 || suburb.length > 60 || houseNumber.length > 20) {
    throw new Error('Please check the street address and suburb.');
  }
  return {
    houseNumber,
    roadName,
    ...(roadType ? { roadType } : {}),
    ...(suburb ? { suburb } : {}),
    ...(postCode ? { postCode } : {}),
  };
}
