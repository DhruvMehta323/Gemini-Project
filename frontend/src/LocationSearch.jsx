import React, { useState, useRef, useEffect, useCallback } from 'react';
import './LocationSearch.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
// Chicago center for proximity bias
const PROXIMITY = '-87.6298,41.8781';
// Chicago metro bounding box
const BBOX = '-88.1,41.5,-87.3,42.15';
// Session token for Mapbox Search Box billing (stable per component mount)
const SESSION_TOKEN = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

export default function LocationSearch({ placeholder, value, onSelect, onClear, onFocus }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  // Sync display value when coords set externally (e.g. map tap or GPS)
  useEffect(() => {
    if (value) {
      setQuery(`${value[0].toFixed(4)}, ${value[1].toFixed(4)}`);
    } else {
      setQuery('');
    }
  }, [value]);

  // Reverse geocode when coords set externally to show place name
  useEffect(() => {
    if (!value || !MAPBOX_TOKEN) return;
    const [lat, lng] = value;
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (data.features?.length) {
          setQuery(data.features[0].place_name.replace(/, United States$/, ''));
        }
      })
      .catch(() => {});
  }, [value]);

  // Search using Mapbox Search Box API v1 (much better POI/business results)
  const searchPlaces = useCallback((text) => {
    if (!text || text.length < 2 || !MAPBOX_TOKEN) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(
      `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(text)}&access_token=${MAPBOX_TOKEN}&session_token=${SESSION_TOKEN}&proximity=${PROXIMITY}&bbox=${BBOX}&limit=7&types=poi,address,place&language=en&country=US`
    )
      .then(r => r.json())
      .then(data => {
        const suggestions = data.suggestions || [];
        setResults(suggestions);
        setShowDropdown(true);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleInput = (e) => {
    const text = e.target.value;
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(text), 300);
  };

  // On select: retrieve full feature (with coordinates) from Search Box API
  const handleSelect = (suggestion) => {
    const displayName = suggestion.full_address || suggestion.name || 'Selected location';
    setQuery(displayName.replace(/, United States$/, ''));
    setResults([]);
    setShowDropdown(false);

    // Retrieve coordinates via mapbox_id
    if (suggestion.mapbox_id && MAPBOX_TOKEN) {
      fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}?access_token=${MAPBOX_TOKEN}&session_token=${SESSION_TOKEN}`
      )
        .then(r => r.json())
        .then(data => {
          const feature = data.features?.[0];
          if (feature?.geometry?.coordinates) {
            const [lng, lat] = feature.geometry.coordinates;
            onSelect([lat, lng]);
          }
        })
        .catch(() => {});
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    onClear();
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (results.length) setShowDropdown(true);
    onFocus?.();
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, []);

  return (
    <div className="location-search">
      <input
        ref={inputRef}
        className="location-search-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={handleInput}
        onFocus={handleFocus}
        autoComplete="off"
      />
      {query && (
        <button className="location-search-clear" onClick={handleClear} type="button">
          &times;
        </button>
      )}
      {loading && <div className="location-search-spinner" />}
      {showDropdown && (
        <div className="location-search-dropdown" ref={dropdownRef}>
          {results.length > 0 ? results.map((s, i) => (
            <button
              key={s.mapbox_id || i}
              className="location-search-result"
              onClick={() => handleSelect(s)}
              type="button"
            >
              <span className="lsr-icon">📍</span>
              <div className="lsr-text">
                <span className="lsr-name">{s.name}</span>
                <span className="lsr-address">
                  {(s.full_address || s.place_formatted || '').replace(/, United States$/, '')}
                </span>
              </div>
            </button>
          )) : (
            !loading && query.length >= 2 && (
              <div className="location-search-empty">No results — try a different name</div>
            )
          )}
        </div>
      )}
    </div>
  );
}
