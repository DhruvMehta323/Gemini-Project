# StreetWise

**Find safer routes through Chicago — because Google Maps won't tell you which streets to avoid at 2 AM.**

---

## The story behind this

One of us had just moved to Chicago. First month in the city, walking back from a friend's place around 11 PM. Didn't know the neighborhoods. Google Maps gave the "fastest route" — straight through a stretch that, as we later found out, had multiple assault incidents that same week. Nothing happened that night, but it easily could have.

That stuck with us. Why doesn't navigation software care about *safety*? It optimizes for time, distance, tolls — but never once asks "hey, maybe don't walk down this street alone at midnight?"

So we built StreetWise.

---

## What it actually does

StreetWise is a navigation app for Chicago that routes you around danger — not just traffic. It pulls **49,505 real crash records** and **thousands of crime reports** from Chicago's open data portal, maps them onto a street-level hex grid, and finds you a path that's actually safer.

The kicker? You lose maybe 2-3 extra minutes of walking. That's it. For **40% less risk** on average.

### Talk to it like a friend

No dropdowns. No forms. Just tell it where you want to go:

> *"Walk me from Millennium Park to Navy Pier, it's late and I'm alone"*

It picks up on context. "Late" and "alone" means it cranks safety priority way up. It knows that crime risk at 11 PM is wildly different from 2 PM. It checks the weather. Then it gives you two routes — fastest and safest — and explains the tradeoff in plain English.

You can also just **call it**. Hit the phone icon and have a voice conversation. It sounds like a friend giving you directions, not a GPS robot.

### The risk isn't static

This is the part we're most proud of. Risk in StreetWise isn't a fixed heatmap — it shifts constantly:

- **3 PM on a weekday** has **7x more crash risk** than 4 AM. The time slider lets you see this in real-time on the map.
- **Thunderstorm with hail?** That's a 1.7x risk multiplier on top of everything else. StreetWise checks live weather from Open-Meteo and adjusts.
- **Walking vs driving vs cycling** — completely different risk profiles. Pedestrians face 70% crime / 30% crash weighting. Drivers? 90% crash / 10% crime. Because if you're in a car, getting mugged isn't really your problem — intersections are.

---

## How the routing works

Every street segment in Chicago sits inside an **H3 hexagonal cell** (resolution 9, about 0.1 km² each — roughly a city block). Each cell gets a risk score from 0-100 based on:

1. **Crash density** — 49,505 geocoded crashes, severity-weighted (fatal > injury > fender bender)
2. **Crime density** — street crimes filtered by type (homicide=10x weight, robbery=5x, theft=2x)
3. **Time pattern** — hourly multipliers from historical data
4. **Weather** — live conditions applied on top

The routing engine uses **NetworkX** with a custom cost function:

```
cost = travel_time + (beta * risk_score)
```

`beta` is how much you care about safety. Say "I'm with my kids" and beta goes to 9. Say "just get me there fast" and it drops to 0. The AI infers this from how you talk.

Two routes come back: fastest path and safest path. You see both on the map, pick one, and start navigating — Google Maps style with camera follow, bearing rotation, and turn-by-turn voice.

---

## The numbers

| | |
|---|---|
| Crash records analyzed | **49,505** (Aug 2025 — Feb 2026) |
| H3 grid cells | **4,824** covering all of Chicago |
| Data quality score | **100/100** (fully geocoded + temporal) |
| Peak-to-low risk ratio | **7.04x** (3 PM vs 4 AM) |
| Typical risk reduction | **~40%** for 2-3 min extra |
| Most dangerous density | **95 crashes/km** (O'Hare St) |
| Grid resolution | **0.1 km²** per cell (street-level) |

---

## Features

**Navigation**
- Google Maps-style live navigation with camera follow + bearing rotation
- Turn-by-turn voice directions with 10-second advance warnings
- Demo mode to simulate a walk without GPS
- Works on mobile — optimized for 10fps rendering

**AI Buddy**
- Natural language route requests (text or voice)
- Gemini-powered conversation with Chicago street knowledge
- Context-aware: detects time, weather, travel mode, safety concern level
- Voice calls with interrupt support — tap to cut in anytime
- Off-route detection with re-routing alerts

**Visualization**
- Live risk heatmap with hour-of-day slider
- Side-by-side fastest vs safest route comparison
- Weather badge with real-time conditions
- Risk metrics overlay (crash %, crime %, time multiplier)

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, react-map-gl, Mapbox GL JS, Framer Motion |
| Backend | Flask, NetworkX, OSMnx, GeoPandas, H3 |
| AI | Google Gemini 3 Flash (chat + parse), Gemini 2.5 Flash TTS |
| Data | Chicago Data Portal (crashes + crimes), Open-Meteo (weather) |
| Spatial | H3 hexagonal grid (res 9), Haversine distance, Mapbox geocoding |
| Deploy | Render (gunicorn + static build) |

---

## Run it locally

**Backend**
```bash
cd risk_aware_routing
pip install -r requirements.txt
# Add your keys to .env:
#   GEMINI_API_KEY=your_key
#   MAPBOX_TOKEN=your_token
python app.py
```

**Frontend**
```bash
cd frontend
npm install
# Add to .env:
#   VITE_MAPBOX_TOKEN=your_token
npm run dev
```

Open `http://localhost:5173` and try: *"Walk from Willis Tower to Wrigley Field at night"*

---

## What we'd build next

- Expand beyond Chicago (the pipeline is city-agnostic, just needs data)
- Community reports — let users flag sketchy areas in real-time
- Historical "safe walk" patterns from anonymized GPS traces
- Integration with city emergency services for live incident avoidance
- Offline mode with pre-cached risk tiles

---

## Why this matters

Every year, thousands of pedestrians and cyclists are injured on Chicago streets. Most of them were just going somewhere — to work, to a friend's place, home from a bar. The data to avoid the worst streets already exists. It's public. It's free. Nobody was using it to help people navigate.

Now we are.

---

*Built at [hackathon name] 2026*
