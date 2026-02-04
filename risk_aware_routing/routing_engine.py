import osmnx as ox
import networkx as nx
import json
import h3

class RoutingEngine:
    def __init__(self, place_name="Chicago, Illinois"):
        print(f"Initializing Graph for {place_name}...")
        self.G = ox.graph_from_place(place_name, network_type='drive')
        self.G = ox.add_edge_speeds(self.G)
        self.G = ox.add_edge_travel_times(self.G)
        # We keep the graph in WGS84 (Lat/Lng) for H3 compatibility
        self.risk_data = {}

    def load_risk_api(self, json_path):
        """Loads the provided routing_risk_api.json"""
        with open(json_path, 'r') as f:
            data = json.load(f)
            self.risk_data = data.get("cells", {})
        print(f"Loaded {len(self.risk_data)} risk-mapped hexagons.")

    def get_comparison(self, start_coords, end_coords, beta=5.0, hour=12, is_weekend=False):
        """
        Returns two routes: Fastest (Beta=0) and Risk-Aware (Beta=User Value)
        plus the stats for comparison.
        """
        # 1. Get the Fastest Route (Beta = 0)
        fastest_path_coords = self.get_route(start_coords, end_coords, beta=0, hour=hour, is_weekend=is_weekend)
        
        # 2. Get the Risk-Aware Route
        safest_path_coords = self.get_route(start_coords, end_coords, beta=beta, hour=hour, is_weekend=is_weekend)

        # 3. Calculate Stats for both
        stats = {
            "fastest": self._calculate_route_stats(fastest_path_coords, hour, is_weekend),
            "safest": self._calculate_route_stats(safest_path_coords, hour, is_weekend)
        }
        
        # Calculate improvements
        stats["reduction_in_risk_pct"] = round(
            (1 - (stats["safest"]["total_risk"] / max(stats["fastest"]["total_risk"], 1))) * 100, 1
        )
        stats["extra_time_seconds"] = round(stats["safest"]["total_time"] - stats["fastest"]["total_time"], 0)

        return {
            "fastest_route": fastest_path_coords,
            "safest_route": safest_path_coords,
            "metrics": stats
        }

    def _calculate_route_stats(self, coords, hour, is_weekend):
        """Helper to sum up time and risk for any list of coordinates"""
        total_time = 0
        total_risk = 0
        time_key = self._get_time_key(hour, is_weekend)

        for i in range(len(coords) - 1):
            # Find edge between these points
            u = ox.nearest_nodes(self.G, coords[i][1], coords[i][0])
            v = ox.nearest_nodes(self.G, coords[i+1][1], coords[i+1][0])
            
            edge_data = self.G.get_edge_data(u, v)
            if edge_data:
                # Use the first key in multi-graph
                data = list(edge_data.values())[0]
                total_time += data.get('travel_time', 0)
                
                # Risk Lookup
                cell = h3.latlng_to_cell(coords[i][0], coords[i][1], 9)
                if cell in self.risk_data:
                    base = self.risk_data[cell].get("base_risk", 0)
                    mod = self.risk_data[cell].get("time_modifiers", {}).get(time_key, 1.0)
                    total_risk += base * mod
        
        return {"total_time": total_time, "total_risk": total_risk}

    def _get_time_key(self, hour, is_weekend):
        """Maps hour to the keys in your JSON (e.g., 'morning_rush_weekday')"""
        day_type = "weekend" if is_weekend else "weekday"
        
        if 0 <= hour < 6: period = "night"
        elif 6 <= hour < 9: period = "morning_rush"
        elif 9 <= hour < 16: period = "midday"
        elif 16 <= hour < 19: period = "evening_rush"
        elif 19 <= hour < 22: period = "evening"
        else: period = "night"
            
        return f"{period}_{day_type}"

    def get_route(self, start_coords, end_coords, beta=0.5, hour=12, is_weekend=False):
        """
        start_coords: [lat, lng]
        beta: Risk sensitivity (0 = fastest, 1.0+ = much safer)
        """
        # Find nearest nodes
        orig_node = ox.nearest_nodes(self.G, start_coords[1], start_coords[0])
        dest_node = ox.nearest_nodes(self.G, end_coords[1], end_coords[0])

        time_key = self._get_time_key(hour, is_weekend)

        def risk_cost_func(u, v, data):
            travel_time = data.get('travel_time', 1.0)
            node_data = self.G.nodes[u]
            lat, lng = node_data['y'], node_data['x']
            cell = h3.latlng_to_cell(lat, lng, 9)
            
            # CHANGE: Default to a small "unknown" risk rather than 0
            # This forces the algorithm to prefer roads it actually HAS data for.
            risk_val = 2.0 
            
            if cell in self.risk_data:
                cell_info = self.risk_data[cell]
                base = cell_info.get("base_risk", 2.0)
                modifier = cell_info.get("time_modifiers", {}).get(time_key, 1.0)
                risk_val = base * modifier
            
            return travel_time + (beta * risk_val)

        # Compute shortest path using the risk-weighted function
        path = nx.shortest_path(self.G, orig_node, dest_node, weight=risk_cost_func)
        
        # Format output as [lat, lng] for Mapbox
        return [[self.G.nodes[n]['y'], self.G.nodes[n]['x']] for n in path]