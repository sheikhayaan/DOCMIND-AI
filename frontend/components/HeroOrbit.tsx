'use client';

import { motion } from 'framer-motion';
import { FileText, MessageSquareText, ScanSearch } from 'lucide-react';

const ORBIT_ITEMS = [
  { label: 'PDF', className: 'orbit-item orbit-item-pdf', Icon: FileText },
  { label: 'Vectors', className: 'orbit-item orbit-item-vectors', Icon: ScanSearch },
  { label: 'Answers', className: 'orbit-item orbit-item-answers', Icon: MessageSquareText },
];

// Renders the decorative 3D document-processing orbit around the upload workspace.
export default function HeroOrbit() {
  return (
    <div className="hero-orbit" aria-hidden="true">
      <motion.div
        className="orbit-ring orbit-ring-outer"
        animate={{ rotateZ: 360, rotateX: [62, 68, 62] }}
        transition={{
          rotateZ: { duration: 28, repeat: Infinity, ease: 'linear' },
          rotateX: { duration: 7, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
      <motion.div
        className="orbit-ring orbit-ring-inner"
        animate={{ rotateZ: -360, rotateY: [58, 64, 58] }}
        transition={{
          rotateZ: { duration: 22, repeat: Infinity, ease: 'linear' },
          rotateY: { duration: 8, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
      <motion.div
        className="orbit-core"
        animate={{ scale: [0.92, 1.08, 0.92], opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      {ORBIT_ITEMS.map(({ label, className, Icon }, index) => (
        <motion.div
          key={label}
          className={className}
          animate={{ y: [0, index % 2 === 0 ? -12 : 10, 0], rotateZ: [0, 2, 0] }}
          transition={{
            duration: 4.5 + index,
            delay: index * 0.45,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <Icon size={14} />
          <span>{label}</span>
        </motion.div>
      ))}
    </div>
  );
}
