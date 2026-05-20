"use client";
import { motion } from "framer-motion";
import clsx from "clsx";
import { ReactNode } from "react";

export function PillButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-accent text-base",
        variant === "ghost" && "ring-1 ring-white/10 bg-white/5 text-foreground hover:bg-white/10",
        className
      )}
    >
      {children}
    </motion.button>
  );
}
