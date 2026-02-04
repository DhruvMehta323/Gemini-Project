from flask import Flask, request, jsonify
from routing_engine import RoutingEngine
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Init Engine
engine = RoutingEngine("Chicago, Illinois")
engine.load_risk_api("routing_risk_api.json")

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

if __name__ == '__main__':
    app.run(debug=True, port=5000)