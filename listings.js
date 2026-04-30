import { XMLParser } from 'fast-xml-parser';

export const config = { runtime: 'edge' };

// Haversine distance in miles
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bearing from point 1 to point 2 in degrees (0 = N, 90 = E)
function bearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Pick the first defined value from a list of possible field paths
function pick(obj, ...paths) {
  for (const p of paths) {
    const parts = p.split('.');
    let v = obj;
    for (const part of parts) {
      if (v == null) break;
      v = v[part];
    }
    if (v != null && v !== '') return v;
  }
  return null;
}

// Normalize a single listing from the parsed XML to a clean shape.
// Handles the standard Zillow Listing Feed schema and a few common variants.
function normalizeListing(raw) {
  const lat = parseFloat(pick(raw, 'Latitude', 'latitude', 'Address.Latitude', 'location.lat'));
  const lng = parseFloat(pick(raw, 'Longitude', 'longitude', 'Address.Longitude', 'location.lng'));
  if (isNaN(lat) || isNaN(lng)) return null;

  // Photos may be an array, a single object, or a delimited string
  let photos = [];
  const photoNode = pick(raw, 'Pictures', 'pictures', 'Photos', 'photos');
  if (photoNode) {
    const list = photoNode.Picture || photoNode.picture || photoNode.Photo || photoNode.photo || photoNode;
    const arr = Array.isArray(list) ? list : [list];
    photos = arr
      .map((p) => {
        if (typeof p === 'string') return p;
        return pick(p, 'PictureURL', 'pictureUrl', 'url', 'URL', '#text');
      })
      .filter(Boolean);
  }

  const street = pick(raw, 'Address.Street', 'address.street', 'StreetAddress');
  const city = pick(raw, 'Address.City', 'address.city', 'City');
  const state = pick(raw, 'Address.State', 'address.state', 'State');
  const zip = pick(raw, 'Address.Zip', 'address.zip', 'Zip', 'PostalCode');

  return {
    id: pick(raw, 'MlsId', 'mlsId', 'ListingId', 'listingId', 'id') || `${lat},${lng}`,
    mlsNumber: pick(raw, 'MlsNumber', 'mlsNumber', 'MLSNumber'),
    lat,
    lng,
    price: parseFloat(pick(raw, 'ListPrice', 'listPrice', 'Price', 'price')) || null,
    beds: parseFloat(pick(raw, 'Bedrooms', 'bedrooms', 'Beds')) || null,
    baths: parseFloat(pick(raw, 'Bathrooms', 'bathrooms', 'Baths')) || null,
    halfBaths: parseFloat(pick(raw, 'HalfBathrooms', 'halfBathrooms')) || null,
    sqft: parseFloat(pick(raw, 'LivingArea', 'livingArea', 'SquareFeet', 'sqft')) || null,
    garage: parseFloat(pick(raw, 'Garage', 'garage', 'GarageSpaces', 'ParkingSpaces')) || null,
    yearBuilt: parseInt(pick(raw, 'YearBuilt', 'yearBuilt'), 10) || null,
    propertyType: pick(raw, 'PropertyType', 'propertyType'),
    status: pick(raw, 'Status', 'status', 'ListingStatus'),
    daysOnMarket: parseInt(pick(raw, 'DaysOnMarket', 'daysOnMarket', 'DOM'), 10) || null,
    description: pick(raw, 'MarketingRemarks', 'marketingRemarks', 'Description', 'description', 'PublicRemarks'),
    address: {
      street: street ? String(street) : null,
      city: city ? String(city) : null,
      state: state ? String(state) : null,
      zip: zip ? String(zip) : null,
    },
    fullAddress: [street, city, state, zip].filter(Boolean).join(', '),
    photos,
    primaryPhoto: photos[0] || null,
    agentName: pick(raw, 'ListingAgent.Name', 'listingAgent.name', 'AgentName', 'Agent.Name'),
    agentPhone: pick(raw, 'ListingAgent.Phone', 'listingAgent.phone', 'AgentPhone', 'Agent.Phone'),
    agentEmail: pick(raw, 'ListingAgent.Email', 'listingAgent.email', 'AgentEmail'),
    listDate: pick(raw, 'ListDate', 'listDate', 'DateListed'),
    openHouse: pick(raw, 'OpenHouse', 'openHouse'),
    zestimate: parseFloat(pick(raw, 'Zestimate', 'zestimate')) || null,
    pricePerSqft: null, // computed below
  };
}

function parseFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseTagValue: true,
    trimValues: true,
  });
  const data = parser.parse(xml);

  // Walk the structure looking for an array of listings.
  // Common shapes: { Listings: { Listing: [...] } }, { properties: { property: [...] } }
  function findListings(node, depth = 0) {
    if (depth > 6 || node == null) return null;
    if (Array.isArray(node)) return node;
    if (typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const lower = key.toLowerCase();
        if (lower === 'listing' || lower === 'property' || lower === 'home') {
          return Array.isArray(node[key]) ? node[key] : [node[key]];
        }
      }
      for (const key of Object.keys(node)) {
        const found = findListings(node[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  const rawListings = findListings(data) || [];
  return rawListings
    .map(normalizeListing)
    .filter(Boolean)
    .map((l) => {
      if (l.price && l.sqft) l.pricePerSqft = Math.round(l.price / l.sqft);
      return l;
    });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radius = parseFloat(url.searchParams.get('radius') || '10');

  try {
    const feedRes = await fetch('http://realistiq.net/exports/iq_cb_select_zillow.xml', {
      headers: { 'User-Agent': 'KLINEKRAFT-AR-Listings/1.0' },
      cf: { cacheTtl: 1800, cacheEverything: true },
    });

    if (!feedRes.ok) {
      return new Response(JSON.stringify({ error: 'Feed unavailable', status: feedRes.status }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const xml = await feedRes.text();
    let listings = parseFeed(xml);

    // If user coords provided, attach distance + bearing and filter by radius
    if (!isNaN(lat) && !isNaN(lng)) {
      listings = listings
        .map((l) => ({
          ...l,
          distance: haversine(lat, lng, l.lat, l.lng),
          bearing: bearing(lat, lng, l.lat, l.lng),
        }))
        .filter((l) => l.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    }

    return new Response(
      JSON.stringify({
        count: listings.length,
        center: !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null,
        radius,
        listings,
        generatedAt: new Date().toISOString(),
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 's-maxage=1800, stale-while-revalidate=86400',
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Parse failed', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
