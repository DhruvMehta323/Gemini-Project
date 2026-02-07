import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBearing, getDistance, getTurnDirection, generateInstructions, interpolate } from './navUtils';
import './NavigationPanel.css';

export default function NavigationPanel({ route, totalTime, onPositionUpdate, onNavStateUpdate, onClose, autoStart }) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [navMode, setNavMode] = useState(null); // 'sim' | 'gps'
  const [currentStep, setCurrentStep] = useState(0);
  const [distanceRemaining, setDistanceRemaining] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [progress, setProgress] = useState(0);
  const [instructions, setInstructions] = useState([]);

  const simRef = useRef(null);
  const gpsRef = useRef(null);
  const stepListRef = useRef(null);

  // Generate instructions when route changes
  useEffect(() => {
    if (route && route.length > 1) {
      const instrs = generateInstructions(route);
      setInstructions(instrs);

      // Calculate total distance
      let total = 0;
      for (let i = 0; i < route.length - 1; i++) {
        total += getDistance(route[i], route[i + 1]);
      }
      setDistanceRemaining(Math.round(total));
      setTimeRemaining(Math.round(totalTime || total / 1.4)); // 1.4 m/s walking speed
    }
  }, [route, totalTime]);

  // Scroll active step into view
  useEffect(() => {
    if (stepListRef.current) {
      const activeEl = stepListRef.current.querySelector('.nav-step.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentStep]);

  // Report navigation state to parent (for voice nav integration)
  useEffect(() => {
    if (onNavStateUpdate) {
      onNavStateUpdate({ instructions, currentStep, isNavigating });
    }
  }, [instructions, currentStep, isNavigating, onNavStateUpdate]);

  // Find which step we're closest to
  const updateStep = useCallback((pos) => {
    if (!instructions.length) return;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < instructions.length; i++) {
      const d = getDistance(pos, instructions[i].coord);
      if (d < minDist) {
        minDist = d;
        closest = i;
      }
    }
    // Advance to next step if we're close enough (within 20m)
    if (minDist < 20 && closest < instructions.length - 1) {
      closest = Math.max(closest, currentStep);
    }
    setCurrentStep(closest);
  }, [instructions, currentStep]);

  // Simulation: animate along the route
  const startSimulation = () => {
    if (!route || route.length < 2) return;
    setIsNavigating(true);
    setNavMode('sim');
    setCurrentStep(0);
    setProgress(0);

    let segIndex = 0;
    let fraction = 0;
    const totalSegs = route.length - 1;
    const speed = 0.02; // fraction per tick — controls simulation speed

    const tick = () => {
      fraction += speed;

      if (fraction >= 1) {
        fraction = 0;
        segIndex++;
        if (segIndex >= totalSegs) {
          // Arrived
          const endPos = route[route.length - 1];
          onPositionUpdate(endPos);
          setProgress(100);
          setDistanceRemaining(0);
          setTimeRemaining(0);
          setCurrentStep(instructions.length - 1);
          setNavMode(null);
          return;
        }
      }

      const pos = interpolate(route[segIndex], route[segIndex + 1], fraction);
      onPositionUpdate(pos);

      // Update progress
      const progressPct = ((segIndex + fraction) / totalSegs) * 100;
      setProgress(progressPct);

      // Update remaining distance
      let remaining = 0;
      remaining += getDistance(pos, route[segIndex + 1]) * (1 - fraction);
      for (let i = segIndex + 1; i < totalSegs; i++) {
        remaining += getDistance(route[i], route[i + 1]);
      }
      setDistanceRemaining(Math.round(remaining));
      setTimeRemaining(Math.round(remaining / 1.4));

      updateStep(pos);

      simRef.current = requestAnimationFrame(tick);
    };

    simRef.current = requestAnimationFrame(tick);
  };

  // GPS: track real position
  const startGPS = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setIsNavigating(true);
    setNavMode('gps');

    gpsRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const pos = [position.coords.latitude, position.coords.longitude];
        onPositionUpdate(pos);
        updateStep(pos);

        // Update remaining distance from current position to end
        let remaining = getDistance(pos, route[route.length - 1]);
        setDistanceRemaining(Math.round(remaining));
        setTimeRemaining(Math.round(remaining / 1.4));
      },
      (error) => {
        console.error('GPS error:', error);
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
  };

  // Auto-start navigation when triggered from voice call
  useEffect(() => {
    if (!autoStart || !route || route.length < 2 || isNavigating) return;
    if (autoStart === 'sim') startSimulation();
    else if (autoStart === 'gps') startGPS();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const stopNavigation = () => {
    if (simRef.current) cancelAnimationFrame(simRef.current);
    if (gpsRef.current) navigator.geolocation.clearWatch(gpsRef.current);
    setIsNavigating(false);
    setNavMode(null);
    setProgress(0);
    setCurrentStep(0);
    onPositionUpdate(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (simRef.current) cancelAnimationFrame(simRef.current);
      if (gpsRef.current) navigator.geolocation.clearWatch(gpsRef.current);
    };
  }, []);

  const formatDist = (m) => {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    return `${m} m`;
  };

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = Math.round(s % 60);
    if (mins > 0) return `${mins} min`;
    return `${secs} sec`;
  };

  // Current instruction to display prominently
  const currentInstruction = instructions[currentStep] || null;
  const nextInstruction = instructions[currentStep + 1] || null;

  return (
    <div className="nav-panel">
      <div className="nav-header">
        <span className="nav-title">Navigation</span>
        <button className="nav-close" onClick={() => { stopNavigation(); onClose(); }}>
          ✕
        </button>
      </div>

      {!isNavigating ? (
        // Pre-navigation: show start options
        <div className="nav-start-section">
          <div className="nav-route-summary">
            <div className="nav-summary-item">
              <span className="nav-summary-value">{formatDist(distanceRemaining)}</span>
              <span className="nav-summary-label">Distance</span>
            </div>
            <div className="nav-summary-item">
              <span className="nav-summary-value">{formatTime(timeRemaining)}</span>
              <span className="nav-summary-label">Est. Time</span>
            </div>
            <div className="nav-summary-item">
              <span className="nav-summary-value">{instructions.length}</span>
              <span className="nav-summary-label">Steps</span>
            </div>
          </div>
          <button className="nav-start-btn simulate" onClick={startSimulation}>
            ▶ Simulate Navigation
          </button>
          <button className="nav-start-btn gps" onClick={startGPS}>
            📡 Use Live GPS
          </button>
        </div>
      ) : (
        // Active navigation
        <div className="nav-active">
          {/* Mode indicator + Progress bar */}
          <div className="nav-mode-badge">
            {navMode === 'sim' ? '▶ Simulating' : '📡 Live GPS'}
          </div>
          <div className="nav-progress-bar">
            <div className="nav-progress-fill" style={{ width: `${progress}%` }} />
          </div>

          {/* Current instruction - big display */}
          {currentInstruction && (
            <div className="nav-current">
              <span className="nav-current-icon">{currentInstruction.icon}</span>
              <div className="nav-current-text">
                <span className="nav-current-label">{currentInstruction.label}</span>
                {nextInstruction && (
                  <span className="nav-current-next">
                    Then: {nextInstruction.icon} {nextInstruction.label} in {formatDist(nextInstruction.distance)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="nav-stats">
            <div className="nav-stat">
              <span className="nav-stat-value">{formatDist(distanceRemaining)}</span>
              <span className="nav-stat-label">Remaining</span>
            </div>
            <div className="nav-stat">
              <span className="nav-stat-value">{formatTime(timeRemaining)}</span>
              <span className="nav-stat-label">ETA</span>
            </div>
            <div className="nav-stat">
              <span className="nav-stat-value">{Math.round(progress)}%</span>
              <span className="nav-stat-label">Done</span>
            </div>
          </div>

          {/* Step list */}
          <div className="nav-steps" ref={stepListRef}>
            {instructions.map((instr, i) => (
              <div
                key={i}
                className={`nav-step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`}
              >
                <span className="nav-step-icon">{i < currentStep ? '✓' : instr.icon}</span>
                <span className="nav-step-label">{instr.label}</span>
                {instr.distance > 0 && (
                  <span className="nav-step-dist">{formatDist(instr.distance)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Stop button */}
          <button className="nav-stop-btn" onClick={stopNavigation}>
            ■ Stop Navigation
          </button>
        </div>
      )}
    </div>
  );
}
