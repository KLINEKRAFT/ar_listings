import { XMLParser } from 'fast-xml-parser';

export const config = { runtime: 'edge' };

const FEED_URLS = [
  'https://realistiq.net/exports/iq_cb_select_zillow.xml',
  'http://realistiq.net/exports/iq_cb_select_zillow.xml',
];

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

// Safe value extraction — handles both raw values and CDATA-wrapped
function val(node) {
  if (node == null) return null;
  if (typeof node === 'object') return node['#text'] ?? null;
  return node;
}

// Specific to this XML schema (RealistIQ Zillow-style feed)
function normalizeListing(raw) {
  if (!raw) return null;

  const loc = raw.Location || {};
  const details = raw.ListingDetails || {};
  const basic = raw.BasicDetails || {};
  const agent = raw.Agent || {};
  const office = raw.Office || {};
  const pics = raw.Pictures || {};

  const lat = parseFloat(val(loc.Lat));
  const lng = parseFloat(val(loc.Long));
  if (isNaN(lat) || isNaN(lng)) return null;

  // Photos: <Pictures><Picture><PictureUrl>...</PictureUrl></Picture>...
  let photos = [];
  if (pics.Picture) {
    const arr = Array.isArray(pics.Picture) ? pics.Picture : [pics.Picture];
    photos = arr.map((p) => val(p?.PictureUrl)).filter(Boolean);
  }

  const street = val(loc.StreetAddress);
  const unit = val(loc.UnitNumber);
  const city = val(loc.City);
  const stateAbbr = val(loc.State);
  const zip = val(loc.Zip);
  const fullStreet = unit ? `${street} ${unit}` : street;

  // Agent name: combine FirstName + LastName
  const agentFirst = val(agent.FirstName);
  const agentLast = val(agent.LastName);
  const agentName = [agentFirst, agentLast].filter(Boolean).join(' ') || null;
  const agentPhone = val(agent.OfficeLineNumber) || val(office.BrokerPhone) || null;
  const agentEmail = val(agent.EmailAddress) || val(office.BrokerEmail) || null;
  const agentPhoto = val(agent.PictureUrl) || null;

  const beds = parseFloat(val(basic.Bedrooms)) || null;
  const baths = parseFloat(val(basic.Bathrooms)) || null;
  const fullBaths = parseFloat(val(basic.FullBathrooms)) || null;
  const halfBaths = parseFloat(val(basic.HalfBathrooms)) || null;
  const sqft = parseFloat(val(basic.LivingArea)) || null;
  const yearBuilt = parseInt(val(basic.YearBuilt), 10) || null;
  const propertyType = val(basic.PropertyType) || null;
  const description = val(basic.Description) || null;

  const price = parseFloat(val(details.Price)) || null;
  const status = val(details.Status) || null;
  const mlsId = val(details.MlsId) || null;
  const listingUrl = val(details.ListingUrl) || null;
  const virtualTour = val(details.VirtualTourUrl) || null;

  const rich = raw.RichDetails || {};

  return {
    id: mlsId || `${lat},${lng}`,
    mlsNumber: mlsId,
    lat,
    lng,
    price,
    beds,
    baths,
    fullBaths,
    halfBaths,
    sqft,
    garage: null, // not in this feed
    yearBuilt,
    propertyType,
    status,
    daysOnMarket: null,
    description,
    address: {
      street: fullStreet || null,
      city: city || null,
      state: stateAbbr || null,
      zip: zip ? String(zip) : null,
    },
    fullAddress: [fullStreet, city, stateAbbr, zip].filter(Boolean).join(', '),
    photos,
    primaryPhoto: photos[0] || null,
    agentName,
    agentPhone,
    agentEmail,
    agentPhoto,
    brokerage: val(office.BrokerageName) || null,
    officeName: val(office.OfficeName) || null,
    listingUrl,
    virtualTour,
    pool: val(rich.Pool) === 'Yes',
    basement: val(rich.Basement) === 'Yes',
    waterfront: val(rich.Waterfront) === 'Yes',
    pricePerSqft: null,
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

  // Structure is: <Listings><Listing>...</Listing>...</Listings>
  const listingsNode = data?.Listings?.Listing;
  if (!listingsNode) {
    return { rawCount: 0, normalized: [], rootKeys: Object.keys(data || {}), structureNote: 'Listings.Listing not found' };
  }

  const rawListings = Array.isArray(listingsNode) ? listingsNode : [listingsNode];
  const normalized = rawListings
    .map(normalizeListing)
    .filter(Boolean)
    .map((l) => {
      if (l.price && l.sqft) l.pricePerSqft = Math.round(l.price / l.sqft);
      return l;
    });

  return {
    rawCount: rawListings.length,
    normalized,
    rootKeys: Object.keys(data || {}),
  };
}

async function fetchFeedWithFallback() {
  const errors = [];
  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'KLINEKRAFT-AR-Listings/1.0' },
      });
      if (res.ok) {
        const text = await res.text();
        return { url, text, status: res.status };
      }
      errors.push({ url, status: res.status, statusText: res.statusText });
    } catch (e) {
      errors.push({ url, error: e.message });
    }
  }
  return { errors };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radius = parseFloat(url.searchParams.get('radius') || '10');
  const debug = url.searchParams.get('debug') === '1';

  try {
    const fetchResult = await fetchFeedWithFallback();

    if (!fetchResult.text) {
      return new Response(
        JSON.stringify({
          error: 'Feed fetch failed',
          attempts: fetchResult.errors,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let parsed;
    try {
      parsed = parseFeed(fetchResult.text);
    } catch (parseErr) {
      return new Response(
        JSON.stringify({
          error: 'XML parse failed',
          message: parseErr.message,
          fetchedFrom: fetchResult.url,
          xmlSnippet: fetchResult.text.slice(0, 1500),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let listings = parsed.normalized;

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

    const body = {
      count: listings.length,
      totalInFeed: parsed.normalized.length,
      rawCountInFeed: parsed.rawCount,
      center: !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null,
      radius,
      listings,
      generatedAt: new Date().toISOString(),
      fetchedFrom: fetchResult.url,
    };

    if (debug) {
      body.debug = {
        rootKeys: parsed.rootKeys,
        structureNote: parsed.structureNote,
        firstListing: parsed.normalized[0] || null,
        sampleCoords: parsed.normalized.slice(0, 5).map((l) => ({
          city: l.address.city,
          state: l.address.state,
          lat: l.lat,
          lng: l.lng,
        })),
      };
    }

    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'Unexpected failure',
        message: err.message,
        stack: err.stack,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
