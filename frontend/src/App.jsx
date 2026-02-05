import React, { useState } from 'react';
import Map, { Source, Layer, Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Shield, Zap, Navigation, Clock } from 'lucide-react';
import { compareRoutes } from './api/client';

// !!! REPLACE WITH YOUR MAPBOX TOKEN !!!
const MAPBOX_TOKEN = 'pk.YOUR_TOKEN_HERE'; 

export default function App() {
  const [viewState, setViewState] = useState({
    longitude: -74.0060, latitude: 40.7128, zoom: 12, pitch: 45
  });

  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState({ start: null, end: null });
  const [mode, setMode] = useState('start'); 

  const handleMapClick = (evt) => {
    const { lat, lng } = evt.lngLat;
    if (mode === 'start') {
      setPoints(p => ({ ...p, start: [lat, lng] }));
      setMode('end');
    } else {
      setPoints(p => ({ ...p, end: [lat, lng] }));
    }
  };

  const runAnalysis = async () => {
    if (!points.start || !points.end) return;
    setLoading(true);
    try {
      const res = await compareRoutes(points.start, points.end, 5.0, 18, false);
      setRouteData(res.data);
    } catch (e) {
      alert("Backend error! Make sure Python server is running.");
    }
    setLoading(false);
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-mnc-brand overflow-hidden">
      {/* SIDEBAR */}
      <div className="w-full md:w-[400px] z-20 p-6 flex flex-col gap-4 glass-panel m-0 md:m-4">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <Shield className="w-8 h-8 text-mnc-accent" />
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-teal-300">
              SafePath AI
            </h1>
            <p className="text-xs text-slate-400">Enterprise Risk Navigation</p>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4 flex-1">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Navigation className="w-4 h-4" /> Trip Points
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setMode('start')}
                className={`p-3 rounded-lg text-sm border ${mode === 'start' ? 'bg-mnc-accent' : 'border-slate-600'}`}
              >
                {points.start ? "Start Set ✓" : "Set Start"}
              </button>
              <button 
                onClick={() => setMode('end')}
                className={`p-3 rounded-lg text-sm border ${mode === 'end' ? 'bg-mnc-accent' : 'border-slate-600'}`}
              >
                {points.end ? "End Set ✓" : "Set End"}
              </button>
            </div>
          </div>

          <button 
            onClick={runAnalysis}
            disabled={loading || !points.start || !points.end}
            className="w-full py-4 mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl font-bold text-white flex justify-center gap-2"
          >
            {loading ? <Clock className="animate-spin" /> : <Zap />}
            {loading ? "Analyzing..." : "Calculate Safe Path"}
          </button>

          {/* Results */}
          {routeData && (
            <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="flex justify-between items-center p-3 mb-2 rounded-lg bg-safety-green/10 text-safety-green">
                <span>Risk Reduction</span>
                <span className="font-bold text-xl">{routeData.metrics.reduction_in_risk_pct}%</span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-orange-500/10 text-orange-400">
                <span>Time Added</span>
                <span className="font-bold text-xl">+{routeData.metrics.extra_time_seconds}s</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MAP */}
      <div className="flex-1 relative h-full">
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onClick={handleMapClick}
        >
          {routeData && (
            <>
              <Source id="fast" type="geojson" data={{ type: 'Feature', geometry: { type: 'LineString', coordinates: routeData.fastest_route.map(p => [p[1], p[0]]) } }}>
                <Layer id="fast-line" type="line" paint={{ 'line-color': '#64748b', 'line-width': 4, 'line-opacity': 0.5 }} />
              </Source>
              <Source id="safe" type="geojson" data={{ type: 'Feature', geometry: { type: 'LineString', coordinates: routeData.safest_route.map(p => [p[1], p[0]]) } }}>
                <Layer id="safe-line" type="line" paint={{ 'line-color': '#10b981', 'line-width': 5 }} />
              </Source>
            </>
          )}
          {points.start && <Marker longitude={points.start[1]} latitude={points.start[0]} color="#3b82f6" />}
          {points.end && <Marker longitude={points.end[1]} latitude={points.end[0]} color="#ef4444" />}
        </Map>
      </div>
    </div>
  );
}