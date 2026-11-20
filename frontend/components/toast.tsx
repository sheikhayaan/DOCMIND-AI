"use client";

import { AnimatePresence, motion } from "framer-motion";
import styles from './toast.module.css';

export type ToastMessage = {
  id: string;
  type: "success" | "error";
  message: string;
};

type ToastStackProps = {
  toasts: ToastMessage[];
};

// Renders non-intercepting fixed notifications without relying on globally loaded utility CSS.
export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div className={styles.viewport} role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={`${styles.toast} ${styles[toast.type]}`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
