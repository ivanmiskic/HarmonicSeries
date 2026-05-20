export const spring = { type: "spring" as const, stiffness: 120, damping: 20 };

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.32, 0.72, 0, 1] } },
};

export const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

export const scalePress = {
  whileTap: { scale: 0.98 },
  whileHover: { scale: 1.02 },
};
