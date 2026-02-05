from flask import Flask, request, jsonify
from routing_engine import RoutingEngine
from flask_cors import CORS
import json
import copy

app = Flask(__name__)
CORS(app)

# Init Engine (Manhattan only for faster loading & cleaner demo)
engine = RoutingEngine("Manhattan, New York, USA")
engine.load_risk_api("../output/routing_risk_api.json")

# Load static data for dynamic heatmap
with open("../output/grid_risk.geojson", 'r') as f:
    base_heatmap = json.load(f)
with open("../output/time_patterns.json", 'r') as f:
    time_patterns = json.load(f)

# Create hourly multiplier lookup
hourly_multipliers = {h['hour']: h['risk_multiplier'] for h in time_patterns['hourly']}

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
            is_weekend=bool(req.get('is_weekend', False))
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
            is_weekend=bool(req.get('is_weekend', False))
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

if __name__ == '__main__':
    app.run(debug=True, port=5000)