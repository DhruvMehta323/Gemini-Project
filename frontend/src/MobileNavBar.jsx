import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NAV_ICONS } from './navUtils';
import './MobileNavBar.css';

function MnbIcon({ type, size = 28, color = 'white' }) {
  const icon = NAV_ICONS[type];
  if (!icon) return null;
  const isFilled = type === 'start' || type === 'arrive';
  return (
    <svg width={size} height={size} viewBox={icon.viewBox}
      fill={isFilled ? color : 'none'}
      stroke={isFilled ? 'none' : color}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={icon.path} />
    </svg>
  );
}

export default function MobileNavBar({ show, instruction, nextInstruction, progress, distanceToTurn, onTap }) {
  const formatDist = (m) => {
    if (!m) return '';
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m)} m`;
  };

  return (
    <AnimatePresence>
      {show && instruction && (
        <motion.div
          className="mobile-nav-bar"
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={onTap}
        >
          <div className="mnb-progress" style={{ width: `${progress || 0}%` }} />
          <div className="mnb-content">
            <span className="mnb-icon">
              <MnbIcon type={instruction.svgType} size={28} color="#10b981" />
            </span>
            <div className="mnb-text">
              <span className="mnb-instruction">
                {distanceToTurn > 0 && <span className="mnb-dist">{formatDist(distanceToTurn)} — </span>}
                {instruction.label}
              </span>
              {nextInstruction && (
                <span className="mnb-next">
                  Then {nextInstruction.label}
                  {nextInstruction.distance > 0 ? ` in ${formatDist(nextInstruction.distance)}` : ''}
                </span>
              )}
            </div>
            <svg className="mnb-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
