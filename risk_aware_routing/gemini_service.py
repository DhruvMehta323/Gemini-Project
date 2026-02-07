import google.generativeai as genai
import json
import os
from datetime import datetime


class GeminiService:
    def __init__(self):
        genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def parse_route_request(self, user_message, user_hour=None):
        """Gemini Call #1: Extract structured routing parameters from natural language."""
        current_hour = user_hour if user_hour is not None else datetime.now().hour

        prompt = f"""You are a routing assistant for SafePath NYC, a safety-aware navigation app covering Manhattan, New York City. The app uses NYC-wide crash data but the routing engine covers Manhattan's road network.

Your job: Extract structured routing parameters from the user's natural language request.

You MUST return valid JSON with exactly this schema:
{{
  "start_name": string or null,
  "end_name": string or null,
  "hour": integer 0-23,
  "is_weekend": boolean,
  "beta": float 0-10,
  "travel_mode": string,
  "context": string or null
}}

Rules:
- Both start_name and end_name are REQUIRED. If you cannot identify both, set the missing one to null.
- Recognize Manhattan landmarks: Times Square, Penn Station, Grand Central, Central Park, Wall Street, Empire State Building, SoHo, Greenwich Village, Harlem, Union Square, Columbus Circle, Battery Park, Brooklyn Bridge (Manhattan side), Washington Heights, Chinatown, Little Italy, Tribeca, Financial District, Upper East Side, Upper West Side, Midtown, etc.
- Accept addresses like "123 W 42nd St" and cross-streets like "5th Ave and 42nd St".
- For time: "at 11 PM" -> 23, "morning" -> 8, "evening" -> 19, "midnight" -> 0, "rush hour" -> 17. If no time given, use {current_hour}.
- For day: "this weekend" or "Saturday" or "Sunday" -> is_weekend: true. Default false.
- For safety beta: "I'm walking alone at night" -> beta: 8. "Quick route" or "fastest" -> beta: 2. "Safest possible" -> beta: 10. Default: 5.
- Extract ANY safety-relevant context into the context field (e.g. "solo traveler", "with kids", "late at night", "carrying valuables").
- Return ONLY the JSON object, no markdown fences, no explanation.

USER MESSAGE: {user_message}"""

        try:
            response = self.model.generate_content(prompt)
            text = response.text.strip()
            # Strip markdown fences if present
            if text.startswith('```'):
                text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            parsed = json.loads(text)

            if not parsed.get('start_name') or not parsed.get('end_name'):
                return None

            # Clamp values
            parsed['hour'] = max(0, min(23, int(parsed.get('hour', current_hour))))
            parsed['beta'] = max(0.0, min(10.0, float(parsed.get('beta', 5.0))))
            parsed['is_weekend'] = bool(parsed.get('is_weekend', False))
            parsed['travel_mode'] = parsed.get('travel_mode', 'walking')
            parsed['context'] = parsed.get('context', None)

            return parsed
        except (json.JSONDecodeError, Exception) as e:
            print(f"Gemini parse error: {e}")
            return None

    def generate_safety_briefing(self, parsed, metrics, hourly_multiplier=1.0,
                                  fastest_coords=None, safest_coords=None):
        """Gemini Call #2: Generate natural language safety narrative from route data."""
        hour = parsed.get('hour', 12)
        fastest_time = metrics['fastest']['total_time']
        safest_time = metrics['safest']['total_time']

        def fmt_time(seconds):
            mins = int(seconds // 60)
            secs = int(seconds % 60)
            if mins > 0:
                return f"{mins} min {secs} sec"
            return f"{secs} seconds"

        def format_hour(h):
            if h == 0: return "12 AM"
            if h == 12: return "12 PM"
            if h < 12: return f"{h} AM"
            return f"{h - 12} PM"

        def sample_waypoints(coords, n=5):
            """Pick evenly spaced waypoints from a route for Gemini to identify."""
            if not coords or len(coords) < 2:
                return []
            step = max(1, len(coords) // (n + 1))
            return [coords[i] for i in range(step, len(coords) - 1, step)][:n]

        # Risk level from multiplier
        if hourly_multiplier > 1.5:
            risk_level = "high"
        elif hourly_multiplier > 1.2:
            risk_level = "elevated"
        elif hourly_multiplier > 0.8:
            risk_level = "moderate"
        else:
            risk_level = "low"

        hour_label = format_hour(hour)
        day_type = "weekend" if parsed.get('is_weekend') else "weekday"

        # Build waypoint descriptions for routes
        fastest_wp = sample_waypoints(fastest_coords) if fastest_coords else []
        safest_wp = sample_waypoints(safest_coords) if safest_coords else []
        fastest_wp_str = ", ".join([f"({c[0]:.4f}, {c[1]:.4f})" for c in fastest_wp]) if fastest_wp else "N/A"
        safest_wp_str = ", ".join([f"({c[0]:.4f}, {c[1]:.4f})" for c in safest_wp]) if safest_wp else "N/A"

        prompt = f"""You are a safety advisor for SafePath NYC. You've just analyzed two routes through Manhattan and need to give the traveler a detailed, actionable safety briefing.

ROUTE DATA:
- From: {parsed['start_name']} to {parsed['end_name']}
- Time: {hour_label} on a {day_type}
- Travel mode: {parsed.get('travel_mode', 'walking')}
- Traveler context: {parsed.get('context', 'no special context')}

FASTEST ROUTE:
- Travel time: {fmt_time(fastest_time)}
- Cumulative risk score: {round(metrics['fastest']['total_risk'], 1)}
- Waypoints (lat, lng): {fastest_wp_str}

SAFEST ROUTE:
- Travel time: {fmt_time(safest_time)}
- Cumulative risk score: {round(metrics['safest']['total_risk'], 1)}
- Waypoints (lat, lng): {safest_wp_str}

COMPARISON:
- Risk reduction by taking safer route: {metrics['reduction_in_risk_pct']}%
- Extra time for safer route: {fmt_time(metrics['extra_time_seconds'])}

TIME RISK CONTEXT:
- This hour's citywide risk multiplier: {round(hourly_multiplier, 2)}x baseline
- Time period risk level: {risk_level}

Write a safety briefing with these sections (use these exact headers):

**Risk Summary**
One sentence on the key tradeoff — how much safer the recommended route is vs how much time it adds.

**Fastest Route**
Describe the fastest route: which streets/avenues/neighborhoods it passes through (use the waypoint coordinates to identify Manhattan streets and neighborhoods). Note any high-risk areas along this path.

**Recommended Safe Route**
Describe the safer route: which streets/neighborhoods it detours through and why this path is safer. Mention specific landmarks or well-known cross-streets the traveler will pass.

**Safety Tips**
2-3 short, specific tips for this time of day, travel mode, and context. Be practical, not generic.

Tone: Like a knowledgeable local friend. Confident but not alarmist.
Use the **bold headers** exactly as shown. Keep each section to 1-2 sentences. Total under 200 words."""

        try:
            response = self.model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            print(f"Gemini briefing error: {e}")
            return (f"The safer route reduces risk by {metrics['reduction_in_risk_pct']}% "
                    f"with {fmt_time(metrics['extra_time_seconds'])} extra travel time. "
                    f"Risk level at {hour_label}: {risk_level}.")

    def get_fallback_message(self, user_message):
        """When parsing fails, return a helpful conversational error."""
        return ("I couldn't identify both a start and end location from your message. "
                "Try something like: \"Walk from Times Square to Penn Station at 11 PM\" "
                "or \"Central Park to Wall Street, morning rush hour\"")
