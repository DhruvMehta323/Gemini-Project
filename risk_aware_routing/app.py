from flask import Flask, request, jsonify
from routing_engine import RoutingEngine
from gemini_service import GeminiService
from flask_cors import CORS
from dotenv import load_dotenv
import json
import copy
import os
import osmnx as ox

load_dotenv()

app = Flask(__name__)
CORS(app)

# Init Engine (Manhattan - full NYC graph too large for memory)
engine = RoutingEngine("Manhattan, New York, USA")
engine.load_risk_api("../output/routing_risk_api.json")

# Load static data for dynamic heatmap
with open("../output/grid_risk.geojson", 'r') as f:
    base_heatmap = json.load(f)
with open("../output/time_patterns.json", 'r') as f:
    time_patterns = json.load(f)

# Create hourly multiplier lookup
hourly_multipliers = {h['hour']: h['risk_multiplier'] for h in time_patterns['hourly']}

# Init Gemini AI service
gemini_svc = None
if os.environ.get('GEMINI_API_KEY'):
    gemini_svc = GeminiService()
    print("Gemini AI service initialized.")
else:
    print("WARNING: GEMINI_API_KEY not set. /chat endpoint will not work.")

# Geocoding cache
_geocode_cache = {}

def geocode_place(place_name):
    """Convert a place name to [lat, lng] within Manhattan context."""
    normalized = place_name.strip().lower()
    if normalized in _geocode_cache:
        return _geocode_cache[normalized]
    query = f"{place_name}, Manhattan, New York, NY"
    result = ox.geocode(query)
    coords = [result[0], result[1]]
    _geocode_cache[normalized] = coords
    return coords

def get_time_label(h):
    if h == 0: return "12 AM"
    if h == 12: return "12 PM"
    if h < 12: return f"{h} AM"
    return f"{h - 12} PM"

@app.route('/get-route', methods=['POST'])
def get_route():
    req = request.json
    # Expects: {"start": [lat, lng], "end": [lat, lng], "beta": 0.5, "hour": 17}
    
    try:
        path = engine.get_route(
            start_coords=req['start'],
            end_coords=req['end'],
            beta=float(req.get('beta', 0.5)),
            hour=int(req.get('hour', 12)),
            is_weekend=bool(req.get('is_weekend', False)),
            travel_mode=req.get('travel_mode', 'walking')
        )
        return jsonify({"status": "success", "route": path})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/compare-routes', methods=['POST'])
def compare_routes():
    req = request.json
    try:
        comparison = engine.get_comparison(
            start_coords=req['start'],
            end_coords=req['end'],
            beta=float(req.get('beta', 5.0)),
            hour=int(req.get('hour', 12)),
            is_weekend=bool(req.get('is_weekend', False)),
            travel_mode=req.get('travel_mode', 'walking')
        )
        return jsonify({"status": "success", "data": comparison})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/heatmap/<int:hour>', methods=['GET'])
def get_heatmap(hour):
    """Returns risk heatmap GeoJSON adjusted for the specified hour"""
    try:
        hour = max(0, min(23, hour))  # Clamp to valid range
        multiplier = hourly_multipliers.get(hour, 1.0)

        # Create adjusted copy of heatmap
        adjusted = copy.deepcopy(base_heatmap)
        for feature in adjusted['features']:
            base_risk = feature['properties'].get('risk_score', 0)
            # Apply time multiplier and normalize
            adjusted_risk = base_risk * multiplier
            feature['properties']['risk_score'] = min(100, adjusted_risk)
            feature['properties']['hour'] = hour
            feature['properties']['multiplier'] = multiplier

        return jsonify(adjusted)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/chat', methods=['POST'])
def chat():
    """AI-powered natural language routing with safety briefing."""
    if not gemini_svc:
        return jsonify({
            "status": "error",
            "error_type": "no_api_key",
            "message": "Gemini AI is not configured. Please set GEMINI_API_KEY in the .env file."
        })

    user_message = request.json.get('message', '')
    if not user_message.strip():
        return jsonify({
            "status": "error",
            "error_type": "empty_message",
            "message": "Please type a message describing where you want to go."
        })

    # Step 1: Parse intent with Gemini
    user_hour = request.json.get('user_hour', None)
    parsed = gemini_svc.parse_route_request(user_message, user_hour=user_hour)

    if not parsed or not parsed.get('start_name') or not parsed.get('end_name'):
        return jsonify({
            "status": "error",
            "error_type": "parse_failed",
            "message": gemini_svc.get_fallback_message(user_message),
            "parsed": None
        })

    # Step 2: Geocode place names
    try:
        start_coords = geocode_place(parsed['start_name'])
    except Exception:
        return jsonify({
            "status": "error",
            "error_type": "geocode_failed",
            "message": f"I couldn't find '{parsed['start_name']}' in Manhattan. Could you try a different landmark or address?",
            "parsed": parsed
        })

    try:
        end_coords = geocode_place(parsed['end_name'])
    except Exception:
        return jsonify({
            "status": "error",
            "error_type": "geocode_failed",
            "message": f"I couldn't find '{parsed['end_name']}' in Manhattan. Could you try a different landmark or address?",
            "parsed": parsed
        })

    # Step 3: Bounds check
    if not engine.is_in_bounds(start_coords[0], start_coords[1]):
        return jsonify({
            "status": "error",
            "error_type": "out_of_bounds",
            "message": f"'{parsed['start_name']}' is outside our Manhattan coverage area. Try a Manhattan landmark instead.",
            "parsed": {**parsed, "start_coords": start_coords, "end_coords": end_coords}
        })

    if not engine.is_in_bounds(end_coords[0], end_coords[1]):
        return jsonify({
            "status": "error",
            "error_type": "out_of_bounds",
            "message": f"'{parsed['end_name']}' is outside our Manhattan coverage area. Try a Manhattan landmark instead.",
            "parsed": {**parsed, "start_coords": start_coords, "end_coords": end_coords}
        })

    # Step 4: Calculate routes
    try:
        comparison = engine.get_comparison(
            start_coords=start_coords,
            end_coords=end_coords,
            beta=parsed.get('beta', 5.0),
            hour=parsed.get('hour', 12),
            is_weekend=parsed.get('is_weekend', False),
            travel_mode=parsed.get('travel_mode', 'walking')
        )
    except Exception as e:
        return jsonify({
            "status": "error",
            "error_type": "routing_failed",
            "message": f"I found both locations but couldn't calculate a route between them: {str(e)}",
            "parsed": {**parsed, "start_coords": start_coords, "end_coords": end_coords}
        })

    # Step 5: Generate safety briefing with Gemini
    multiplier = hourly_multipliers.get(parsed.get('hour', 12), 1.0)
    briefing = gemini_svc.generate_safety_briefing(
        parsed=parsed,
        metrics=comparison['metrics'],
        hourly_multiplier=multiplier,
        fastest_coords=comparison.get('fastest_route'),
        safest_coords=comparison.get('safest_route')
    )

    return jsonify({
        "status": "success",
        "parsed": {**parsed, "start_coords": start_coords, "end_coords": end_coords},
        "route_data": comparison,
        "safety_briefing": briefing,
        "ai_summary": f"Found routes from {parsed['start_name']} to {parsed['end_name']} for {get_time_label(parsed.get('hour', 12))}."
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)