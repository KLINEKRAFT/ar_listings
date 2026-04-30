# AR LISTINGS // CB SELECT

Single-file AR view of CB Select property listings within a 1–25 mile radius. Camera overlay, compass ring, distance-scaled pins, photo carousel, filters, and favorites.

Built KLINEKRAFT-style: one HTML file, one edge function, deploys to Vercel via GitHub web UI. No local dev environment needed.

## Stack

- `index.html` — the entire frontend, single file, IBM Plex Mono + Helvetica Neue
- `api/listings.js` — Vercel Edge Function. Proxies the realistiq.net XML feed, parses to JSON, attaches distance + bearing to every listing, filters by radius, caches for 30 minutes
- `package.json` — pulls in `fast-xml-parser`
- `vercel.json` — CORS headers for the API route

## Deploy from GitHub web UI

1. Create a new repo under your KLINEKRAFT account (e.g. `ar-listings`)
2. Upload all four files into the repo root, preserving the `/api` folder
3. In Vercel: New Project → Import the repo → Deploy. Vercel auto-detects the edge function.
4. Optional: assign a subdomain like `ar.colinkline.com` via Vercel domains + Cloudflare DNS

That's it — first deploy takes about 60 seconds.

## How it works

**The feed → JSON pipeline.** The edge function fetches the XML feed once, parses it with `fast-xml-parser`, and walks the structure to find the listings array (handles common Zillow Listing Feed shapes — `<Listing>`, `<property>`, `<home>`). Each listing is normalized to a clean shape with `lat`, `lng`, `price`, `beds`, `baths`, `garage`, `sqft`, `photos[]`, `agent`, etc. If your feed uses field names that don't match the standard Zillow schema, edit the `normalizeListing()` function — it uses a fallback `pick()` helper so you can add new field paths in seconds.

**The AR layer.** The frontend uses three browser APIs working together: `Geolocation` for the user's lat/lng, `getUserMedia` for the rear camera feed, and `DeviceOrientationEvent` for compass heading. On every animation frame, each listing's bearing relative to the user is compared against the current compass heading. If the listing falls within ±32° of where the phone is pointing, a pin renders at a horizontal position proportional to the angular delta. Closer listings render larger; farther ones smaller and slightly faded.

**The compass ring.** A 360° track of degree ticks slides horizontally so the current heading is always at center. Listing positions are dropped onto the ring as small accent dots — sweep your phone left or right and watch listings slide into view.

## Features baked in

- 10 mile default radius, adjustable 1–25 in the filter drawer
- Filters: price min/max, beds, baths, min sqft, favorites only
- Tap any pin → expanded card with full photo carousel (swipe or tap), specs grid, agent info, directions and call-agent buttons
- Favorites stored in localStorage, marked with accent border on pin and star in list
- Distance-scaled pins (closer = bigger)
- Price-as-color border (green = below median, red = above, neutral = mid)
- Off-screen indicator: listings outside FOV park at left/right edge with arrow + distance
- Compass ring with directional listing dots
- Center reticle for HUD feel
- Shake to refresh
- Haptic feedback on pin tap
- Konami code → X-ray mode (currently a placeholder toggle)
- Full safe-area inset support for iPhone notch/home indicator

## iOS quirks worth knowing

- iOS Safari requires HTTPS for camera and motion sensors. Vercel gives you HTTPS by default.
- iOS 13+ requires explicit user permission for `DeviceOrientationEvent`. The onboarding screen handles this — user must tap a button, can't be auto-triggered.
- The webkit compass heading on iOS is "true" north and clockwise; Android's `alpha` is counter-clockwise from north. Both are normalized in `attachOrientationListener()`.
- Add to home screen for fullscreen PWA-feel; the meta tags are already set.

## Tuning

- **FOV**: in `state.fov` (default 65°). Increase to show more pins at once, decrease for tighter targeting.
- **Max pins on screen**: `MAX_PINS` constant in `renderARPins()`. Default 30. Drop to 15 if you hit dense markets and the DOM gets heavy.
- **Cache TTL**: in `api/listings.js`, the `cacheTtl` and `s-maxage` values default to 30 minutes / 1800 seconds. Lower for fresher data, higher for less load.

## Likely first-deploy adjustments

The XML field names are inferred from the standard Zillow Listing Feed schema. After your first deploy, hit `https://your-domain.vercel.app/api/listings?lat=36.15&lng=-95.99` and check the JSON. If any field is `null` that you expect to have data, the field path needs adding. Open `api/listings.js`, find the relevant `pick(...)` call in `normalizeListing()`, and add the field name as another argument. Push to GitHub, Vercel redeploys in ~30 seconds.

## Roadmap ideas (not yet built)

- Open House badge surfacing
- Drive time per listing
- School pins overlay
- Recently sold comps mode
- Agent-mode notes per property
- Showing route mode (multi-stop arrows)
- True 3D AR with AR.js (current implementation uses 2D overlay positioned by bearing — accurate enough and far less finicky)

## Brand

KLINEKRAFT // single accent color is currently `#FFB800` amber. Swap to CB Blue (`#012169`) by changing the `--accent` CSS variable at the top of `index.html` if this lands as an official CB Select tool.
