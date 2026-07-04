"use client";

import { motion } from "framer-motion";

type ServiceUnavailableProps = {
  onRetry: () => void;
};

// Shows a friendly full-screen fallback when the backend cannot be reached.
export function ServiceUnavailable({ onRetry }: ServiceUnavailableProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-5 text-white">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl shadow-black/40"
      >
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
          <span className="size-2 rounded-full bg-red-400" />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal text-white">
          Service temporarily unavailable.
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-zinc-200"
        >
          Retry
        </button>
      </motion.section>
    </main>
  );
}
