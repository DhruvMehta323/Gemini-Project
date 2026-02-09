const MAPBOX_TOKEN = typeof import.meta !== 'undefined' ? import.meta.env.VITE_MAPBOX_TOKEN : '';

/**
 * SVG path data for turn-by-turn maneuver icons (Google Maps style)
 * Each returns { path, viewBox } for inline <svg> rendering
 */
export const NAV_ICONS = {
  'straight':     { path: 'M12 2L12 22M12 2L8 6M12 2L16 6', viewBox: '0 0 24 24' },
  'slight-right': { path: 'M12 22V8M12 8L18 2M18 2V8M18 2H12', viewBox: '0 0 24 24' },
  'right':        { path: 'M4 12H20M20 12L14 6M20 12L14 18', viewBox: '0 0 24 24' },
  'sharp-right':  { path: 'M12 2V14M12 14L18 22M18 22H12M18 22V16', viewBox: '0 0 24 24' },
  'slight-left':  { path: 'M12 22V8M12 8L6 2M6 2V8M6 2H12', viewBox: '0 0 24 24' },
  'left':         { path: 'M20 12H4M4 12L10 6M4 12L10 18', viewBox: '0 0 24 24' },
  'sharp-left':   { path: 'M12 2V14M12 14L6 22M6 22H12M6 22V16', viewBox: '0 0 24 24' },
  'start':        { path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z', viewBox: '0 0 24 24' },
  'arrive':       { path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z', viewBox: '0 0 24 24' },
};

/**
 * Reverse geocode a [lat, lng] coordinate to get street name
 */
export async function reverseGeocodeStreet(coord) {
  if (!MAPBOX_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${coord[1]},${coord[0]}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
    );
    const data = await res.json();
    if (data.features?.length) {
      const name = data.features[0].place_name || '';
      // Extract street name: strip house number prefix and city/state suffix
      const parts = name.split(',');
      if (parts.length > 0) {
        return parts[0].replace(/^\d+\s+/, '').trim();
      }
    }
  } catch {}
  return null;
}

/**
 * Enrich instructions array with street names (batch reverse geocode)
 * Mutates instructions in place, adding .street field
 */
export async function enrichWithStreetNames(instructions) {
  if (!instructions?.length || !MAPBOX_TOKEN) return instructions;
  // Only geocode turn points (skip start/arrive, limit API calls)
  const promises = instructions.map(async (instr) => {
    const street = await reverseGeocodeStreet(instr.coord);
    if (street) {
      instr.street = street;
      // Enrich label: "Turn right" -> "Turn right onto Michigan Ave"
      if (instr.label !== 'Start navigation' && instr.label !== 'Arrive at destination') {
        instr.label = `${instr.label} onto ${street}`;
      }
    }
    return instr;
  });
  await Promise.all(promises);
  return instructions;
}

/**
 * Calculate bearing between two [lat, lng] points in degrees (0-360)
 */
export function getBearing(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(to[1] - from[1]);
  const y = Math.sin(dLng) * Math.cos(toRad(to[0]));
  const x =
    Math.cos(toRad(from[0])) * Math.sin(toRad(to[0])) -
    Math.sin(toRad(from[0])) * Math.cos(toRad(to[0])) * Math.cos(dLng);
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

/**
 * Distance between two [lat, lng] points in meters (Haversine)
 */
export function getDistance(from, to) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(to[0] - from[0]);
  const dLng = toRad(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from[0])) * Math.cos(toRad(to[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Get turn direction from bearing change
 */
export function getTurnDirection(prevBearing, nextBearing) {
  let diff = ((nextBearing - prevBearing) + 360) % 360;
  if (diff > 180) diff -= 360;
  if (Math.abs(diff) < 20) return { type: 'straight', icon: '⬆️', svgType: 'straight', label: 'Continue straight' };
  if (diff > 0 && diff < 70) return { type: 'slight-right', icon: '↗️', svgType: 'slight-right', label: 'Slight right' };
  if (diff >= 70 && diff < 130) return { type: 'right', icon: '➡️', svgType: 'right', label: 'Turn right' };
  if (diff >= 130) return { type: 'sharp-right', icon: '↪️', svgType: 'sharp-right', label: 'Sharp right' };
  if (diff < 0 && diff > -70) return { type: 'slight-left', icon: '↖️', svgType: 'slight-left', label: 'Slight left' };
  if (diff <= -70 && diff > -130) return { type: 'left', icon: '⬅️', svgType: 'left', label: 'Turn left' };
  return { type: 'sharp-left', icon: '↩️', svgType: 'sharp-left', label: 'Sharp left' };
}

/**
 * Generate turn-by-turn instructions from route coordinates
 */
export function generateInstructions(coords) {
  if (!coords || coords.length < 2) return [];
  const instructions = [];

  instructions.push({
    index: 0,
    icon: '🏁',
    svgType: 'start',
    label: 'Start navigation',
    distance: 0,
    coord: coords[0]
  });

  let prevBearing = getBearing(coords[0], coords[1]);

  for (let i = 1; i < coords.length - 1; i++) {
    const nextBearing = getBearing(coords[i], coords[i + 1]);
    const turn = getTurnDirection(prevBearing, nextBearing);
    const dist = getDistance(coords[i - 1], coords[i]);

    if (turn.type !== 'straight' || i === 1) {
      instructions.push({
        index: i,
        icon: turn.icon,
        svgType: turn.svgType,
        label: turn.label,
        distance: Math.round(dist),
        coord: coords[i]
      });
    }
    prevBearing = nextBearing;
  }

  const lastDist = getDistance(coords[coords.length - 2], coords[coords.length - 1]);
  instructions.push({
    index: coords.length - 1,
    icon: '📍',
    svgType: 'arrive',
    label: 'Arrive at destination',
    distance: Math.round(lastDist),
    coord: coords[coords.length - 1]
  });

  return instructions;
}

/**
 * Interpolate position between two coordinates (0-1 fraction)
 */
export function interpolate(from, to, fraction) {
  return [
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction
  ];
}
