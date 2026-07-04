"use client";

import { AnimatePresence, motion } from "framer-motion";

export type ToastMessage = {
  id: string;
  type: "success" | "error";
  message: string;
};

type ToastStackProps = {
  toasts: ToastMessage[];
};

// Renders animated toast notifications in the bottom-right corner.
export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={`rounded-xl border px-4 py-3 text-sm shadow-2xl ${
              toast.type === "success"
                ? "border-emerald-400/20 bg-emerald-500 text-white"
                : "border-red-400/20 bg-red-500 text-white"
            }`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
