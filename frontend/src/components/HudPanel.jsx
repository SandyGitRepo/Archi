import React from "react";
import { motion } from "framer-motion";

export const HudPanel = ({ title, side = "left", accent = "#00F0FF", children, footer, testId }) => {
  return (
    <motion.div
      data-testid={testId}
      initial={{ opacity: 0, x: side === "left" ? -40 : 40, filter: "blur(8px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="archi-hud-panel"
      style={{ "--accent": accent }}
    >
      <div className="archi-hud-scan" />
      <div className="archi-hud-head">
        <span className="archi-hud-dot" />
        <span className="archi-hud-title">{title}</span>
      </div>
      <div className="archi-hud-body">{children}</div>
      {footer ? <div className="archi-hud-footer">{footer}</div> : null}
    </motion.div>
  );
};

export default HudPanel;
