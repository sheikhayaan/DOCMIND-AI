"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

type PageTransitionProps = {
  children: ReactNode;
};

// Wraps each route in a subtle page entrance animation.
export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex min-h-full flex-col"
    >
      {children}
    </motion.div>
  );
}
