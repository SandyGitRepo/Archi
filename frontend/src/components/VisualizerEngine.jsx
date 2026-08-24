import React from "react";
import { motion } from "framer-motion";

const STATE_COLOR = {
  idle: "#00F0FF",
  listening: "#00F0FF",
  thinking: "#B026FF",
  speaking: "#FF0055",
};

// -------- ORB MODE --------
const Orb = ({ state, level }) => {
  const color = STATE_COLOR[state] || "#00F0FF";
  const active = state === "speaking" || state === "listening";
  const scale = 1 + (active ? level * 0.28 : 0);
  const spin = state === "thinking" ? 6 : state === "idle" ? 40 : 18;

  return (
    <div className="archi-orb-wrap" style={{ "--accent": color }} data-testid="visualizer-orb">
      {/* outer reactive rings */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="archi-ring"
          style={{
            width: `${300 + i * 90}px`,
            height: `${300 + i * 90}px`,
            borderColor: color,
            opacity: 0.12 + i * 0.05,
          }}
          animate={{ rotate: i % 2 === 0 ? 360 : -360, scale: active ? 1 + level * 0.06 * (i + 1) : 1 }}
          transition={{ rotate: { duration: spin + i * 6, repeat: Infinity, ease: "linear" }, scale: { duration: 0.15 } }}
        />
      ))}

      {/* rotating conic aura */}
      <motion.div
        className="archi-orb-aura"
        style={{ background: `conic-gradient(from 0deg, transparent, ${color}, transparent 70%)` }}
        animate={{ rotate: 360 }}
        transition={{ duration: spin, repeat: Infinity, ease: "linear" }}
      />

      {/* core */}
      <motion.div
        className="archi-orb-core"
        style={{
          background: `radial-gradient(circle at 38% 32%, ${color}, #04121a 62%, #020508 100%)`,
          boxShadow: `0 0 60px ${color}, 0 0 140px ${color}55, inset 0 0 60px ${color}66`,
        }}
        animate={{ scale }}
        transition={{ duration: 0.12 }}
      >
        <div className="archi-orb-shine" />
        <span className="archi-orb-label">ARCHI</span>
      </motion.div>

      {/* equalizer bars around bottom */}
      <div className="archi-eq">
        {Array.from({ length: 28 }).map((_, i) => {
          const h = active ? 6 + Math.abs(Math.sin(i * 0.7 + Date.now() / 200)) * level * 46 : 6;
          return (
            <span
              key={i}
              style={{ height: `${h}px`, background: color, opacity: active ? 0.9 : 0.25 }}
            />
          );
        })}
      </div>
    </div>
  );
};

// -------- CIRCUIT MODE --------
const Circuit = ({ state, level }) => {
  const color = STATE_COLOR[state] || "#00F0FF";
  const active = state === "speaking" || state === "listening";
  const dur = state === "thinking" ? 1.2 : 3;

  const nodes = [
    [120, 120], [300, 90], [480, 130], [640, 100],
    [90, 300], [760, 320], [130, 480], [320, 520],
    [520, 500], [700, 480], [420, 300], [230, 250],
    [560, 250], [640, 400], [200, 400],
  ];

  return (
    <div className="archi-circuit-wrap" style={{ "--accent": color }} data-testid="visualizer-circuit">
      <svg viewBox="0 0 850 620" className="archi-circuit-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* traces */}
        {nodes.map(([x, y], i) => (
          <line
            key={`l-${i}`}
            x1={x}
            y1={y}
            x2={425}
            y2={310}
            stroke={color}
            strokeWidth="1"
            opacity="0.18"
          />
        ))}
        {/* animated pulses along traces */}
        {nodes.map(([x, y], i) => (
          <circle key={`p-${i}`} r="3.5" fill={color} filter="url(#glow)">
            <animate
              attributeName="cx"
              values={`${x};425`}
              dur={`${dur + (i % 4) * 0.4}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="cy"
              values={`${y};310`}
              dur={`${dur + (i % 4) * 0.4}s`}
              repeatCount="indefinite"
            />
            <animate attributeName="opacity" values="0;1;0" dur={`${dur + (i % 4) * 0.4}s`} repeatCount="indefinite" />
          </circle>
        ))}
        {/* nodes */}
        {nodes.map(([x, y], i) => (
          <g key={`n-${i}`}>
            <rect x={x - 7} y={y - 7} width="14" height="14" fill="none" stroke={color} strokeWidth="1.4" opacity="0.5" />
            <circle cx={x} cy={y} r="3" fill={color} opacity="0.8" />
          </g>
        ))}

        {/* central chip */}
        <g filter="url(#glow)">
          <rect
            x={425 - 95}
            y={310 - 48}
            width="190"
            height="96"
            rx="6"
            fill="#040a0f"
            stroke={color}
            strokeWidth="2"
            opacity={0.95}
            style={{ transform: `scale(${active ? 1 + level * 0.05 : 1})`, transformOrigin: "425px 310px" }}
          />
          {/* chip legs */}
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={`t-${i}`} x1={425 - 84 + i * 24} y1={310 - 48} x2={425 - 84 + i * 24} y2={310 - 62} stroke={color} strokeWidth="2" />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={`b-${i}`} x1={425 - 84 + i * 24} y1={310 + 48} x2={425 - 84 + i * 24} y2={310 + 62} stroke={color} strokeWidth="2" />
          ))}
        </g>
        <text x="425" y="318" textAnchor="middle" className="archi-chip-text" fill={color} filter="url(#glow)">
          ARCHI
        </text>
      </svg>
    </div>
  );
};

export const VisualizerEngine = ({ state = "idle", mode = "orb", level = 0 }) => {
  return (
    <div className="archi-visualizer" data-testid="visualizer-engine" data-state={state} data-mode={mode}>
      {mode === "orb" ? <Orb state={state} level={level} /> : <Circuit state={state} level={level} />}
    </div>
  );
};

export default VisualizerEngine;
