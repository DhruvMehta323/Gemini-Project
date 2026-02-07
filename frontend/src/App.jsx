import React, { useState, useEffect, useCallback } from 'react';
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import ChatPanel from './ChatPanel';
import NavigationPanel from './NavigationPanel';
import './App.css';

export default function App() {
  // Manhattan bounds for reference
  const MANHATTAN_BOUNDS = {
    minLat: 40.700, maxLat: 40.880,
    minLng: -74.020, maxLng: -73.900
  };

  const [viewState, setViewState] = useState({
    longitude: -73.975,
    latitude: 40.758,
    zoom: 13,
    pitch: 40,
    bearing: 0
  });

  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState({ start: null, end: null });
  const [mode, setMode] = useState('start');
  const [hour, setHour] = useState(17);
  const [beta, setBeta] = useState(5);
  const [riskData, setRiskData] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [activeTab, setActiveTab] = useState('manual');
  const [travelMode, setTravelMode] = useState('walking');
  const [navRoute, setNavRoute] = useState(null); // which route to navigate (safest_route or fastest_route coords)
  const [navTime, setNavTime] = useState(0);
  const [navPosition, setNavPosition] = useState(null); // live position [lat, lng]
  const [showNav, setShowNav] = useState(false);
  const [navInstructions, setNavInstructions] = useState([]);
  const [navCurrentStep, setNavCurrentStep] = useState(0);
  const [isActivelyNavigating, setIsActivelyNavigating] = useState(false);
  const [navAutoStart, setNavAutoStart] = useState(null); // 'sim' | 'gps' | null

  const handleChatRoute = (chatRouteData, startCoords, endCoords, chatHour, chatBeta) => {
    setRouteData(chatRouteData);
    setPoints({ start: startCoords, end: endCoords });
    setHour(chatHour);
    setBeta(chatBeta);
  };

  const startNavigation = (routeType, autoStart = null) => {
    if (!routeData) return;
    const coords = routeType === 'fastest' ? routeData.fastest_route : routeData.safest_route;
    const time = routeType === 'fastest'
      ? routeData.metrics.fastest.total_time
      : routeData.metrics.safest.total_time;
    setNavRoute(coords);
    setNavTime(time);
    setShowNav(true);
    setNavAutoStart(autoStart);
  };

  const handleNavStateUpdate = useCallback(({ instructions, currentStep, isNavigating }) => {
    setNavInstructions(instructions);
    setNavCurrentStep(currentStep);
    setIsActivelyNavigating(isNavigating);
  }, []);

  const navContext = {
    instructions: navInstructions,
    currentStep: navCurrentStep,
    currentPosition: navPosition,
    isNavigating: isActivelyNavigating,
    route: navRoute,
  };

  const closeNavigation = () => {
    setShowNav(false);
    setNavRoute(null);
    setNavPosition(null);
    setNavInstructions([]);
    setNavCurrentStep(0);
    setIsActivelyNavigating(false);
    setNavAutoStart(null);
  };

  // Load risk heatmap data based on selected hour
  useEffect(() => {
    fetch(`/api/heatmap/${hour}`)
      .then(res => res.json())
      .then(data => setRiskData(data))
      .catch(err => {
        console.log('Dynamic heatmap failed, trying static:', err);
        // Fallback to static file
        fetch('/grid_risk.geojson')
          .then(res => res.json())
          .then(data => setRiskData(data))
          .catch(err2 => console.log('Risk data not loaded:', err2));
      });
  }, [hour]);

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
      const response = await fetch('/api/compare-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: points.start,
          end: points.end,
          beta: beta,
          hour: hour,
          is_weekend: false,
          travel_mode: travelMode
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setRouteData(data.data);
      } else {
        alert('Route calculation failed: ' + data.message);
      }
    } catch {
      alert("Backend error! Make sure Flask server is running on port 5000.");
    }
    setLoading(false);
  };

  const resetPoints = () => {
    setPoints({ start: null, end: null });
    setRouteData(null);
    setMode('start');
  };

  const routeToGeoJSON = (coords) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coords.map(p => [p[1], p[0]])
    }
  });

  const getTimeLabel = (h) => {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        {/* Header */}
        <div className="header">
          <div className="logo">🛡️</div>
          <div>
            <h1>SafePath NYC</h1>
            <p>AI-Powered Safe Routing</p>
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">48K+</span>
            <span className="stat-label">Crashes</span>
          </div>
          <div className="stat-card">
            <span className="stat-value cyan">15K+</span>
            <span className="stat-label">Crimes</span>
          </div>
          <div className="stat-card">
            <span className="stat-value green">5.8K</span>
            <span className="stat-label">Risk Zones</span>
          </div>
        </div>

        {/* Heatmap Toggle */}
        <div className="toggle-section">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={(e) => setShowHeatmap(e.target.checked)}
            />
            <span className="toggle-text">🔥 Show Risk Heatmap</span>
          </label>
        </div>

        {/* Tab Switcher */}
        <div className="tab-switcher">
          <button
            className={`tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            Manual
          </button>
          <button
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            AI Chat
          </button>
        </div>

        {activeTab === 'manual' ? (
          <>
            {/* Instructions */}
            <div className="instructions">
              <div className="instruction-item">
                <span className="step blue">1</span>
                <span>Click map to set start</span>
              </div>
              <div className="instruction-item">
                <span className="step red">2</span>
                <span>Click again for destination</span>
              </div>
              <div className="instruction-item">
                <span className="step green">3</span>
                <span>Calculate & compare routes</span>
              </div>
            </div>

            {/* Point Buttons */}
            <div className="section">
              <label className="section-label">TRIP POINTS</label>
              <div className="button-grid">
                <button
                  onClick={() => setMode('start')}
                  className={`point-btn ${mode === 'start' ? 'active blue' : ''} ${points.start ? 'set' : ''}`}
                >
                  {points.start ? '✓ Start Set' : '📍 Set Start'}
                </button>
                <button
                  onClick={() => setMode('end')}
                  className={`point-btn ${mode === 'end' ? 'active red' : ''} ${points.end ? 'set' : ''}`}
                >
                  {points.end ? '✓ End Set' : '🏁 Set End'}
                </button>
              </div>
              {(points.start || points.end) && (
                <button onClick={resetPoints} className="reset-btn">
                  ↺ Reset Points
                </button>
              )}
            </div>

            {/* Travel Mode */}
            <div className="section">
              <label className="section-label">TRAVEL MODE</label>
              <div className="mode-switcher">
                <button
                  className={`mode-btn ${travelMode === 'walking' ? 'active' : ''}`}
                  onClick={() => setTravelMode('walking')}
                >
                  🚶 Walk
                </button>
                <button
                  className={`mode-btn ${travelMode === 'cycling' ? 'active' : ''}`}
                  onClick={() => setTravelMode('cycling')}
                >
                  🚴 Bike
                </button>
                <button
                  className={`mode-btn ${travelMode === 'driving' ? 'active' : ''}`}
                  onClick={() => setTravelMode('driving')}
                >
                  🚗 Drive
                </button>
              </div>
              <div className="mode-hint">
                {travelMode === 'walking' && 'Crime risk weighted 70% — crashes 30%'}
                {travelMode === 'cycling' && 'Crime + crash risk weighted equally'}
                {travelMode === 'driving' && 'Crash risk weighted 90% — crime 10%'}
              </div>
            </div>

            {/* Time Slider */}
            <div className="section">
              <div className="section-header">
                <label className="section-label">TIME OF TRAVEL</label>
                <span className="time-display">{getTimeLabel(hour)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="23"
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value))}
                className="slider"
              />
              <div className="slider-labels">
                <span>12am</span>
                <span>6am</span>
                <span>12pm</span>
                <span>6pm</span>
                <span>11pm</span>
              </div>
            </div>

            {/* Safety Slider */}
            <div className="section">
              <div className="section-header">
                <label className="section-label">SAFETY PRIORITY</label>
                <span className={`priority-badge ${beta > 6 ? 'green' : beta < 3 ? 'orange' : 'blue'}`}>
                  {beta > 6 ? '🛡️ Safer' : beta < 3 ? '⚡ Faster' : '⚖️ Balanced'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={beta}
                onChange={(e) => setBeta(parseFloat(e.target.value))}
                className="slider"
              />
              <div className="slider-labels">
                <span>⚡ Speed</span>
                <span>🛡️ Safety</span>
              </div>
            </div>

            {/* Calculate Button */}
            <button
              onClick={runAnalysis}
              disabled={loading || !points.start || !points.end}
              className="calculate-btn"
            >
              {loading ? '⏳ Analyzing...' : '⚡ Calculate Safe Path'}
            </button>

            {/* Results */}
            {routeData && (
              <div className="results">
                <div className="results-header">ROUTE COMPARISON</div>

                <div className="result-cards">
                  <div className="result-card green">
                    <span className="result-label">Risk Reduction</span>
                    <span className="result-value">{routeData.metrics.reduction_in_risk_pct}%</span>
                  </div>
                  <div className="result-card orange">
                    <span className="result-label">Extra Time</span>
                    <span className="result-value">+{Math.round(routeData.metrics.extra_time_seconds)}s</span>
                  </div>
                </div>

                <div className="comparison">
                  <div className="compare-item">
                    <div className="dot amber"></div>
                    <span>Fastest: {routeData.metrics.fastest.total_risk.toFixed(0)} risk</span>
                  </div>
                  <div className="compare-item">
                    <div className="dot green"></div>
                    <span>Safest: {routeData.metrics.safest.total_risk.toFixed(0)} risk</span>
                  </div>
                </div>

                {/* Navigate buttons */}
                {!showNav && (
                  <div className="nav-buttons">
                    <button className="nav-btn safest" onClick={() => startNavigation('safest')}>
                      🛡️ Navigate Safest
                    </button>
                    <button className="nav-btn fastest" onClick={() => startNavigation('fastest')}>
                      ⚡ Navigate Fastest
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Navigation Panel (appears after clicking Navigate) */}
            {showNav && navRoute && (
              <NavigationPanel
                route={navRoute}
                totalTime={navTime}
                onPositionUpdate={setNavPosition}
                onNavStateUpdate={handleNavStateUpdate}
                onClose={closeNavigation}
                autoStart={navAutoStart}
              />
            )}
          </>
        ) : (
          <>
            <ChatPanel onRouteReceived={handleChatRoute} onStartNavigation={startNavigation} navContext={navContext} />
            {showNav && navRoute && (
              <NavigationPanel
                route={navRoute}
                totalTime={navTime}
                onPositionUpdate={setNavPosition}
                onNavStateUpdate={handleNavStateUpdate}
                onClose={closeNavigation}
                autoStart={navAutoStart}
              />
            )}
          </>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Powered by NYC Open Data</span>
          <span className="status">● Online</span>
        </div>
      </div>

      {/* Map */}
      <div className="map-container">
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" />

          {/* Risk Heatmap Layer */}
          {riskData && showHeatmap && (
            <Source id="risk-data" type="geojson" data={riskData}>
              <Layer
                id="risk-heatmap"
                type="fill"
                paint={{
                  'fill-color': [
                    'interpolate',
                    ['linear'],
                    ['get', 'risk_score'],
                    0, 'rgba(0, 255, 100, 0.1)',
                    20, 'rgba(50, 205, 50, 0.2)',
                    40, 'rgba(255, 255, 0, 0.3)',
                    60, 'rgba(255, 165, 0, 0.4)',
                    80, 'rgba(255, 69, 0, 0.5)',
                    100, 'rgba(255, 0, 0, 0.6)'
                  ],
                  'fill-outline-color': 'rgba(255,255,255,0.1)'
                }}
              />
            </Source>
          )}

          {/* Routes */}
          {routeData && (
            <>
              <Source id="fastest-route" type="geojson" data={routeToGeoJSON(routeData.fastest_route)}>
                <Layer
                  id="fastest-line-shadow"
                  type="line"
                  paint={{
                    'line-color': '#000000',
                    'line-width': 12,
                    'line-opacity': 0.4,
                    'line-blur': 3
                  }}
                />
                <Layer
                  id="fastest-line"
                  type="line"
                  paint={{
                    'line-color': '#f59e0b',
                    'line-width': 6,
                    'line-opacity': 0.9
                  }}
                />
              </Source>
              <Source id="safest-route" type="geojson" data={routeToGeoJSON(routeData.safest_route)}>
                <Layer
                  id="safest-line-glow"
                  type="line"
                  paint={{
                    'line-color': '#10b981',
                    'line-width': 14,
                    'line-opacity': 0.3,
                    'line-blur': 4
                  }}
                />
                <Layer
                  id="safest-line"
                  type="line"
                  paint={{
                    'line-color': '#10b981',
                    'line-width': 6,
                    'line-opacity': 1
                  }}
                />
              </Source>
            </>
          )}

          {/* Markers */}
          {points.start && (
            <Marker longitude={points.start[1]} latitude={points.start[0]} anchor="center">
              <div className="marker blue">A</div>
            </Marker>
          )}
          {points.end && (
            <Marker longitude={points.end[1]} latitude={points.end[0]} anchor="center">
              <div className="marker red">B</div>
            </Marker>
          )}

          {/* Live navigation position marker */}
          {navPosition && (
            <Marker longitude={navPosition[1]} latitude={navPosition[0]} anchor="center">
              <div className="nav-marker"></div>
            </Marker>
          )}
        </Map>

        {/* Map Overlay */}
        <div className="map-overlay">
          {!points.start && <span>👆 Click map to set START</span>}
          {points.start && !points.end && <span>👆 Click map to set END</span>}
          {points.start && points.end && !routeData && <span>✓ Ready - Click Calculate</span>}
          {routeData && <span>🗺️ Routes displayed</span>}
        </div>

        {/* Legend */}
        <div className="map-legend">
          {showHeatmap && (
            <div className="legend-section">
              <span className="legend-title">Risk Level @ {getTimeLabel(hour)}</span>
              <div className="risk-gradient"></div>
              <div className="risk-labels">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>
          )}
          {routeData && (
            <div className="legend-section">
              <span className="legend-title">Routes</span>
              <div className="legend-item">
                <div className="legend-line amber"></div>
                <span>Fastest</span>
              </div>
              <div className="legend-item">
                <div className="legend-line green"></div>
                <span>Safest</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
