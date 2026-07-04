'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useScroll,
  useTransform,
  useSpring,
  useInView,
} from 'framer-motion';
import {
  CloudUpload,
  CheckCircle,
  X,
  FileText,
  Database,
  FileSearch,
  Zap,
  MessageSquare,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import HeroOrbit from '@/components/HeroOrbit';
import Navbar from '@/components/Navbar';
import ScrambleText from '@/components/ScrambleText';
import { uploadPDF } from '@/lib/api';

const ParticleBackground = dynamic(() => import('@/components/ParticleBackground'), {
  ssr: false,
});

const GlassHero = dynamic(() => import('@/components/GlassHero'), {
  ssr: false,
});

const HERO_TAGLINES = [
  'Ask. Cite. Understand.',
  'Every answer, traced to a page.',
  'Your documents, decoded.',
  'Private. Fast. Grounded.',
];

const STAGES = ['Uploading...', 'Reading PDF...', 'Creating embeddings...', 'Ready!'];
const TECH = ['Groq', 'Pinecone', 'LangChain', 'Next.js', 'FastAPI'];
const TRUST_SIGNALS = ['Private by design', 'Cited answers', '50MB PDF support'];
const HEADING_WORDS = ['Chat', 'with', 'any', 'Document', 'instantly'];

const HERO_BADGES = [
  { icon: Database, color: '#6366f1', label: '384D Embeddings' },
  { icon: FileSearch, color: '#a855f7', label: 'Page Citations' },
  { icon: Zap, color: '#ec4899', label: 'Hybrid Search' },
];

const METRICS = [
  { value: '10x', label: 'faster than manual search' },
  { value: '99%', label: 'accuracy on text PDFs' },
  { value: '<3s', label: 'average response time' },
  { value: '100%', label: 'private — your data stays yours' },
];

const STEPS = [
  {
    n: '01',
    title: 'Upload your document',
    text: 'Drop any PDF and the system extracts and indexes every page using vector embeddings.',
  },
  {
    n: '02',
    title: 'Ask anything',
    text: "Type natural language questions about your document's content, just like talking to a person.",
  },
  {
    n: '03',
    title: 'Get cited answers',
    text: 'Receive accurate answers with exact page numbers showing where the information was found.',
  },
];

const FEATURES = [
  {
    icon: Database,
    color: '#6366f1',
    title: '384D vector embeddings',
    text: 'Local HuggingFace embeddings for fast, private document indexing.',
  },
  {
    icon: FileSearch,
    color: '#a855f7',
    title: 'Page-level citations',
    text: 'Every answer links back to the exact page it came from in your document.',
  },
  {
    icon: Zap,
    color: '#ec4899',
    title: 'Hybrid retrieval',
    text: 'Combines semantic and keyword search for the most relevant results.',
  },
  {
    icon: MessageSquare,
    color: '#818cf8',
    title: 'Conversational memory',
    text: 'Follow-up questions understand context from previous messages.',
  },
];

// GitHub mark (lucide has no Github icon in this version).
function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}

// Counts a numeric value up from 0 when scrolled into view; passes through
// non-numeric display strings (like "10x" or "<3s") with an animated number part.
function MetricCounter({ value, label, index }: { value: string; label: string; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [display, setDisplay] = useState(() =>
    /[0-9]/.test(value) ? value.replace(/[0-9]+/, '0') : value,
  );

  useEffect(() => {
    if (!inView) return;
    const match = value.match(/[0-9]+/);
    if (!match) return;
    const target = parseInt(match[0], 10);
    const prefix = value.slice(0, match.index);
    const suffix = value.slice((match.index ?? 0) + match[0].length);
    const duration = 1500;
    const startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(`${prefix}${Math.round(target * eased)}${suffix}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.5 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ type: 'spring', stiffness: 120, damping: 16, delay: index * 0.08 }}
      style={{ textAlign: 'center', padding: '0 16px' }}
    >
      <div
        style={{
          width: '40px',
          height: '2px',
          margin: '0 auto 16px',
          borderRadius: '2px',
          background: 'linear-gradient(90deg, #6366f1, #ec4899)',
        }}
      />
      <div
        className="gradient-text count-up"
        style={{ fontSize: 'clamp(48px, 6vw, 72px)', fontWeight: 800, lineHeight: 1 }}
      >
        {display}
      </div>
      <p style={{ marginTop: '10px', fontSize: '14px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
        {label}
      </p>
    </motion.div>
  );
}

// 3D tilt feature card — rotates toward the cursor with a shine that follows.
function TiltFeatureCard({
  feature,
  index,
}: {
  feature: (typeof FEATURES)[number];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 200, damping: 18 });
  const sry = useSpring(ry, { stiffness: 200, damping: 18 });
  const shineX = useMotionValue(50);
  const shineY = useMotionValue(50);
  const shine = useTransform(
    [shineX, shineY],
    ([x, y]: number[]) =>
      `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.06) 0%, transparent 60%)`,
  );
  const [hovering, setHovering] = useState(false);
  const Icon = feature.icon;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    ry.set(Math.max(-5, Math.min(5, (px - cx) * 0.01)));
    rx.set(Math.max(-5, Math.min(5, (py - cy) * -0.01)));
    shineX.set((px / rect.width) * 100);
    shineY.set((py / rect.height) * 100);
  };

  const reset = () => {
    rx.set(0);
    ry.set(0);
    setHovering(false);
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.4 }}
      onMouseEnter={() => setHovering(true)}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className="glass depth-card feature-card"
      style={{
        position: 'relative',
        borderRadius: '20px',
        padding: '28px',
        cursor: 'default',
        rotateX: srx,
        rotateY: sry,
        transformStyle: 'preserve-3d',
        transformPerspective: 800,
      }}
    >
      {/* Shine overlay following the cursor */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          opacity: hovering ? 1 : 0,
          transition: 'opacity 0.3s ease',
          background: shine,
          pointerEvents: 'none',
        }}
      />
      <div className="feature-icon" style={{ color: feature.color }}>
        <Icon size={26} />
      </div>
      <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>
        {feature.title}
      </h3>
      <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
        {feature.text}
      </p>
    </motion.div>
  );
}

export default function Home() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadCardRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showScrollHint, setShowScrollHint] = useState(true);

  const { scrollYProgress } = useScroll();
  const scrollBarWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const cardRotateX = useMotionValue(0);
  const cardRotateY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 55, damping: 22 });
  const springY = useSpring(mouseY, { stiffness: 55, damping: 22 });
  const springRotateX = useSpring(cardRotateX, { stiffness: 150, damping: 18 });
  const springRotateY = useSpring(cardRotateY, { stiffness: 150, damping: 18 });
  // Glare highlight position (%) that tracks the cursor across the card face.
  const cardGlareX = useMotionValue(50);
  const cardGlareY = useMotionValue(50);
  const cardGlare = useTransform(
    [cardGlareX, cardGlareY],
    ([gx, gy]: number[]) =>
      `radial-gradient(420px circle at ${gx}% ${gy}%, rgba(255,255,255,0.12), transparent 45%)`,
  );
  const [cardHover, setCardHover] = useState(false);

  // Trailing dot inside the drop zone.
  const dotX = useMotionValue(-100);
  const dotY = useMotionValue(-100);
  const dotSpringX = useSpring(dotX, { stiffness: 220, damping: 28 });
  const dotSpringY = useSpring(dotY, { stiffness: 220, damping: 28 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [mouseX, mouseY]);

  // 3D tilt the upload card toward the cursor, measured within its own bounds.
  const handleCardMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = uploadCardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height; // 0..1
    cardRotateY.set((px - 0.5) * 16); // left/right -> ±8deg
    cardRotateX.set((0.5 - py) * 16); // up/down -> ±8deg
    cardGlareX.set(px * 100);
    cardGlareY.set(py * 100);
  };

  const handleCardLeave = () => {
    cardRotateX.set(0);
    cardRotateY.set(0);
    cardGlareX.set(50);
    cardGlareY.set(50);
    setCardHover(false);
  };

  // Hide the scroll indicator once the user scrolls past 100px.
  useEffect(() => {
    const onScroll = () => setShowScrollHint(window.scrollY < 100);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleFile = (f: File) => {
    if (f.type !== 'application/pdf') {
      setError('Please upload a PDF file only');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('File too large. Maximum size is 50MB');
      return;
    }
    if (f.size < 1024) {
      setError('File appears to be empty');
      return;
    }
    setFile(f);
    setError('');
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError('');

    let s = 0;
    const interval = setInterval(() => {
      s++;
      if (s < STAGES.length - 1) setStage(s);
      else clearInterval(interval);
    }, 1200);

    try {
      const res = await uploadPDF(file);
      clearInterval(interval);
      setStage(STAGES.length - 1);
      setSuccess(true);
      setTimeout(() => {
        router.push(
          `/chat?docId=${res.doc_id}&filename=${encodeURIComponent(file.name)}&docType=${res.doc_type || 'general'}`,
        );
      }, 800);
    } catch (uploadError) {
      clearInterval(interval);
      setError(
        uploadError instanceof Error ? uploadError.message : 'Upload failed. Please try again.',
      );
      setLoading(false);
      setStage(0);
    }
  };

  const scrollToUpload = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => fileRef.current?.click(), 600);
  };

  // HERO_BODY_PLACEHOLDER
  return (
    <div style={{ position: 'relative', background: '#000000', minHeight: '100vh' }}>
      <ParticleBackground />

      {/* Ambient glows */}
      <motion.div
        aria-hidden="true"
        animate={{ scale: [1, 1.12, 1], opacity: [0.35, 0.55, 0.35] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="hero-ambient hero-ambient-left"
      />
      <motion.div
        aria-hidden="true"
        animate={{ scale: [1.08, 0.94, 1.08], opacity: [0.4, 0.62, 0.4] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="hero-ambient hero-ambient-right"
      />

      {/* Scroll progress bar */}
      <motion.div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '3px',
          width: scrollBarWidth,
          background: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)',
          zIndex: 100,
        }}
      />

      {/* Mouse spotlight */}
      <motion.div
        style={{
          position: 'fixed',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 1,
          left: springX,
          top: springY,
          translateX: '-50%',
          translateY: '-50%',
        }}
      />

      <Navbar />

      <section
        id="top"
        className="hero-section"
        style={{ position: 'relative', zIndex: 2, minHeight: '100vh', display: 'flex', alignItems: 'center' }}
      >
        <div className="hero-grid" style={{ margin: '0 auto', width: '100%', alignItems: 'center' }}>
          {/* Left text */}
          <div className="hero-copy">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              style={{
                display: 'inline-block',
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: '999px',
                padding: '10px 24px',
                color: '#a5b4fc',
                fontSize: '15px',
                marginBottom: '32px',
              }}
            >
              ✦ Powered by RAG Architecture
            </motion.div>

            {/* Staggered word-flip heading */}
            <h1
              style={{
                fontSize: 'clamp(58px, 5.6vw, 94px)',
                fontWeight: 800,
                lineHeight: 0.98,
                letterSpacing: '-0.045em',
                marginBottom: '32px',
                color: '#ffffff',
                textWrap: 'balance',
                perspective: '1000px',
              }}
            >
              {HEADING_WORDS.map((word, i) => (
                <motion.span
                  key={word + i}
                  initial={{ opacity: 0, y: 60, rotateX: 90 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0 }}
                  transition={{ delay: 0.3 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={{ display: 'inline-block', transformOrigin: 'bottom', marginRight: '0.22em' }}
                  className={word === 'instantly' ? 'gradient-text hero-glow-word' : 'hero-word'}
                >
                  {word}
                </motion.span>
              ))}
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              style={{ fontSize: '22px', lineHeight: 1.5, color: 'rgba(255,255,255,0.45)', maxWidth: '540px' }}
            >
              Upload PDFs and get instant AI answers complete with citations.
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.95, duration: 0.5 }}
              className="hero-tagline"
            >
              <span className="hero-tagline-bracket">{'>'}</span>
              <ScrambleText phrases={HERO_TAGLINES} className="hero-tagline-text" />
              <span className="hero-tagline-caret" />
            </motion.div>

            {/* Feature badges */}
            <div className="hero-badges">
              {HERO_BADGES.map((badge, i) => {
                const Icon = badge.icon;
                return (
                  <motion.span
                    key={badge.label}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.85 + i * 0.1 }}
                    whileHover="hover"
                    className="hero-badge"
                  >
                    <motion.span
                      variants={{ hover: { rotate: 360 } }}
                      transition={{ duration: 0.4 }}
                      style={{ display: 'inline-flex', color: badge.color }}
                    >
                      <Icon size={15} />
                    </motion.span>
                    {badge.label}
                  </motion.span>
                );
              })}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.5 }}
              className="trust-row"
            >
              {TRUST_SIGNALS.map((signal) => (
                <span key={signal}>
                  <CheckCircle size={14} />
                  {signal}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right upload card */}
          <motion.div
            ref={uploadCardRef}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5, duration: 0.7 }}
            onMouseEnter={() => setCardHover(true)}
            onMouseMove={handleCardMove}
            onMouseLeave={handleCardLeave}
            className="hero-upload"
            style={{
              rotateX: springRotateX,
              rotateY: springRotateY,
              transformPerspective: 1200,
              transformStyle: 'preserve-3d',
            }}
          >
            {/* Aurora halo behind the card */}
            <motion.div
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="upload-aurora"
            />
            <GlassHero />
            <HeroOrbit />
            <div
              className="glass upload-shell gradient-border"
              style={{
                position: 'relative',
                borderRadius: '32px',
                padding: '32px',
                transformStyle: 'preserve-3d',
                boxShadow:
                  '0 0 0 1px rgba(99,102,241,0.1), 0 32px 64px rgba(0,0,0,0.6), 0 0 80px rgba(99,102,241,0.08) inset',
              }}
            >
              {/* Cursor-tracking glare highlight */}
              <motion.div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '32px',
                  background: cardGlare,
                  opacity: cardHover ? 1 : 0,
                  transition: 'opacity 0.4s ease',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
              <div className="upload-card-header">
                <div>
                  <span className="upload-card-kicker">DOCUMENT WORKSPACE</span>
                  <h2>Upload your PDF</h2>
                </div>
                <span className="secure-pill">
                  <span className="secure-dot" />
                  Secure
                </span>
              </div>

              <motion.div
                ref={dropRef}
                className="upload-dropzone"
                animate={{
                  scale: dragging ? 1.02 : 1,
                  borderColor: dragging ? '#6366f1' : 'rgba(255,255,255,0.15)',
                  backgroundColor: dragging ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.01)',
                  boxShadow: dragging ? '0 0 40px rgba(99,102,241,0.3) inset' : '0 0 0 rgba(99,102,241,0)',
                }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                onClick={() => fileRef.current?.click()}
                onMouseMove={(e) => {
                  const rect = dropRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  dotX.set(e.clientX - rect.left);
                  dotY.set(e.clientY - rect.top);
                }}
                onMouseLeave={() => {
                  dotX.set(-100);
                  dotY.set(-100);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
                style={{
                  position: 'relative',
                  border: '2px dashed rgba(255,255,255,0.15)',
                  borderRadius: '16px',
                  padding: '76px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(12px)',
                  overflow: 'hidden',
                }}
              >
                {/* Cursor trail dot */}
                <motion.div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: dotSpringX,
                    top: dotSpringY,
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: 'rgba(99,102,241,0.8)',
                    boxShadow: '0 0 16px rgba(99,102,241,0.9)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
                <motion.div
                  animate={
                    dragging
                      ? { scale: [1, 1.3, 1] }
                      : { y: [0, -4, 0] }
                  }
                  transition={
                    dragging
                      ? { duration: 0.8, repeat: Infinity, ease: 'easeInOut' }
                      : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
                  }
                  className="upload-icon-wrap"
                  style={{ position: 'relative', zIndex: 1 }}
                >
                  <CloudUpload size={38} color="#a5b4fc" strokeWidth={1.5} />
                </motion.div>
                <p style={{ position: 'relative', zIndex: 1, color: '#ffffff', fontWeight: 600, fontSize: '18px', marginTop: '16px' }}>
                  Drop your PDF here
                </p>
                <p style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.35)', fontSize: '14px', marginTop: '4px' }}>
                  or click to browse
                </p>
                <span className="upload-file-note">PDF only · Up to 50MB</span>
              </motion.div>

              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              <AnimatePresence>
                {file && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '16px',
                      padding: '10px 16px',
                      background: 'rgba(99,102,241,0.12)',
                      border: '1px solid rgba(99,102,241,0.3)',
                      borderRadius: '999px',
                      fontSize: '14px',
                    }}
                  >
                    <FileText size={16} color="#a5b4fc" />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#fff' }}>
                      {file.name}
                    </span>
                    <X
                      size={16}
                      color="#888"
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <p style={{ color: '#f87171', fontSize: '14px', marginTop: '12px', textAlign: 'center' }}>
                  {error}
                </p>
              )}

              <motion.button
                whileHover={!loading && file ? { scale: 1.02 } : {}}
                whileTap={!loading && file ? { scale: 0.99 } : {}}
                onClick={handleUpload}
                disabled={!file || loading}
                className={success ? 'analyze-btn analyze-success' : 'analyze-btn'}
                style={{ width: '100%', marginTop: '28px' }}
              >
                {success ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.2, 1] }}
                    transition={{ duration: 0.4 }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                  >
                    <CheckCircle size={20} /> Document Ready
                  </motion.span>
                ) : loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                    <span className="analyze-spinner" />
                    {STAGES[stage]}
                  </span>
                ) : (
                  'Analyze Document →'
                )}
              </motion.button>

              {loading && (
                <div
                  style={{
                    height: '2px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '999px',
                    marginTop: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
                    transition={{ duration: 0.4 }}
                    style={{ height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)' }}
                  />
                </div>
              )}
            </div>

            {/* Tech pills */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              {TECH.map((t, i) => (
                <motion.span
                  key={t}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.05 }}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '999px',
                    padding: '8px 18px',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: '14px',
                  }}
                >
                  {t}
                </motion.span>
              ))}
            </div>
          </motion.div>

          {/* Scroll indicator */}
          <AnimatePresence>
            {showScrollHint && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="scroll-indicator"
              >
                <span>Scroll to explore</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {[0, 1].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, 8, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                      style={{ marginTop: i === 1 ? '-10px' : 0 }}
                    >
                      <ChevronDown size={20} color="rgba(255,255,255,0.3)" />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* SECTIONS_PLACEHOLDER */}
      {/* ===================== METRICS ===================== */}
      <section className="story-section" style={{ position: 'relative', zIndex: 2, padding: '40px 24px 80px' }}>
        <div className="metrics-grid">
          {METRICS.map((m, i) => (
            <div key={m.label} className="metric-cell">
              <MetricCounter value={m.value} label={m.label} index={i} />
            </div>
          ))}
        </div>
      </section>

      {/* ===================== HOW IT WORKS ===================== */}
      <section className="story-section" style={{ position: 'relative', zIndex: 2, padding: '40px 24px 120px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <motion.span
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="section-kicker"
          >
            ONE DOCUMENT. THREE STEPS.
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 800, textAlign: 'center', marginBottom: '64px', color: '#ffffff' }}
          >
            How DocMind works
          </motion.h2>

          <div className="steps-wrap">
            {/* Animated connecting line */}
            <svg className="steps-line" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
              <motion.line
                x1="0"
                y1="1"
                x2="100"
                y2="1"
                stroke="url(#stepGrad)"
                strokeWidth="2"
                strokeDasharray="100"
                initial={{ strokeDashoffset: 100 }}
                whileInView={{ strokeDashoffset: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 2, ease: 'easeInOut' }}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="stepGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>

            <div className="steps-grid">
              {STEPS.map((step, i) => (
                <motion.div
                  key={step.n}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15, duration: 0.5 }}
                  whileHover={{ y: -8, borderColor: 'rgba(99,102,241,0.4)' }}
                  className="glass depth-card process-card"
                  style={{ borderRadius: '20px', padding: '32px', position: 'relative' }}
                >
                  {/* Pulsing connection dot */}
                  <motion.span
                    aria-hidden
                    animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
                    className="step-dot"
                  />
                  <div className="gradient-text" style={{ fontSize: '40px', fontWeight: 800, opacity: 0.3, marginBottom: '12px' }}>
                    {step.n}
                  </div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{step.title}</h3>
                  <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>{step.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== FEATURES ===================== */}
      <section id="features" className="story-section" style={{ position: 'relative', zIndex: 2, padding: '40px 24px 120px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
          <motion.span
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="section-kicker"
          >
            ENGINEERED FOR ACCURACY
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 800, textAlign: 'center', marginBottom: '12px', color: '#ffffff' }}
          >
            Built for precision
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '18px', marginBottom: '64px' }}
          >
            Every feature designed for accurate, fast document intelligence
          </motion.p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
            {FEATURES.map((f, i) => (
              <TiltFeatureCard key={f.title} feature={f} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ===================== DEMO CTA ===================== */}
      <section id="demo" style={{ position: 'relative', zIndex: 2, padding: '40px 24px 160px' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="glass demo-cta"
          style={{
            maxWidth: '800px',
            margin: '0 auto',
            borderRadius: '32px',
            padding: '64px 40px',
            textAlign: 'center',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          {/* Animated gradient mesh */}
          <div className="mesh mesh-1" aria-hidden />
          <div className="mesh mesh-2" aria-hidden />
          <div className="mesh mesh-3" aria-hidden />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <h2 className="gradient-text" style={{ fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: 800 }}>
              Try DocMind AI
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '18px', margin: '16px auto 32px', maxWidth: '480px' }}>
              Private, fast and accurate. Upload your first document and experience document intelligence with cited answers.
            </p>
            <div className="demo-buttons">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={scrollToUpload}
                className="glow-btn"
                style={{ padding: '18px 40px', borderRadius: '999px', fontSize: '17px', fontWeight: 700 }}
              >
                Upload a Document
              </motion.button>
              <motion.a
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ghost-btn"
              >
                <GithubMark size={18} />
                View on GitHub
              </motion.a>
            </div>
          </div>
        </motion.div>
      </section>
      {/* Decorative sparkle */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 5 }}
      >
        <Sparkles size={24} color="rgba(255,255,255,0.15)" />
      </motion.div>

      {/* STYLE_PLACEHOLDER */}
      <style jsx global>{`
        .hero-section {
          padding: 124px 32px 64px;
        }
        .hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.85fr);
          gap: clamp(56px, 7vw, 112px);
          max-width: 1320px;
        }
        .hero-copy {
          width: 100%;
          max-width: 660px;
          justify-self: end;
        }
        .hero-upload {
          position: relative;
          width: 100%;
          max-width: 520px;
          justify-self: start;
          will-change: transform;
          transform-style: preserve-3d;
        }
        .upload-aurora {
          position: absolute;
          z-index: -2;
          top: 50%;
          left: 50%;
          width: 800px;
          height: 800px;
          max-width: 150%;
          max-height: 150%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: conic-gradient(from 0deg, #6366f1, #8b5cf6, #ec4899, #6366f1);
          filter: blur(120px);
          opacity: 0.15;
          pointer-events: none;
          will-change: transform;
        }
        .glass-hero-canvas {
          position: absolute;
          z-index: -1;
          top: 50%;
          left: 50%;
          width: 560px;
          height: 560px;
          max-width: 130%;
          transform: translate(-50%, -54%);
          pointer-events: none;
          will-change: transform;
        }
        .hero-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 28px;
        }
        /* Decrypt tagline — terminal aesthetic with glowing flicker glyphs. */
        .hero-tagline {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 20px;
          font-family: 'SFMono-Regular', ui-monospace, 'Cascadia Code', Menlo, monospace;
          font-size: 16px;
          letter-spacing: 0.02em;
        }
        .hero-tagline-bracket {
          color: #818cf8;
          font-weight: 700;
        }
        .hero-tagline-text {
          color: rgba(255, 255, 255, 0.85);
        }
        .hero-tagline-text :global(.scramble-ghost) {
          color: #a855f7;
          text-shadow: 0 0 10px rgba(168, 85, 247, 0.8);
        }
        .hero-tagline-caret {
          display: inline-block;
          width: 9px;
          height: 18px;
          background: linear-gradient(180deg, #6366f1, #ec4899);
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
          animation: caret-blink 1s steps(1) infinite;
        }
        @keyframes caret-blink {
          0%,
          50% {
            opacity: 1;
          }
          50.01%,
          100% {
            opacity: 0;
          }
        }
        /* Flowing animated gradient + living glow on the accent word. */
        .hero-glow-word {
          background-size: 220% 220%;
          animation: hero-gradient-flow 6s ease-in-out infinite;
          will-change: filter, background-position;
          filter: drop-shadow(0 0 18px rgba(168, 85, 247, 0.45));
        }
        @keyframes hero-gradient-flow {
          0%,
          100% {
            background-position: 0% 50%;
            filter: drop-shadow(0 0 16px rgba(99, 102, 241, 0.4));
          }
          50% {
            background-position: 100% 50%;
            filter: drop-shadow(0 0 34px rgba(236, 72, 153, 0.6));
          }
        }
        /* Subtle depth on the solid heading words. */
        .hero-word {
          text-shadow: 0 2px 24px rgba(99, 102, 241, 0.18);
        }
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(12px);
          color: rgba(255, 255, 255, 0.7);
          font-size: 13px;
          font-weight: 500;
        }
        .scroll-indicator {
          position: absolute;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          color: rgba(255, 255, 255, 0.3);
          font-size: 13px;
          pointer-events: none;
        }
        .hero-orbit {
          position: absolute;
          z-index: -1;
          top: 50%;
          left: 50%;
          width: 720px;
          height: 720px;
          transform: translate(-50%, -50%);
          transform-style: preserve-3d;
          perspective: 1200px;
          pointer-events: none;
        }
        .orbit-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          border: 1px solid rgba(129, 140, 248, 0.2);
          border-radius: 50%;
          box-shadow: 0 0 36px rgba(99, 102, 241, 0.08), inset 0 0 30px rgba(168, 85, 247, 0.05);
          transform-style: preserve-3d;
        }
        .orbit-ring::before,
        .orbit-ring::after {
          position: absolute;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #a5b4fc;
          box-shadow: 0 0 18px #818cf8;
          content: '';
        }
        .orbit-ring::before {
          top: 12%;
          left: 17%;
        }
        .orbit-ring::after {
          right: 10%;
          bottom: 23%;
          background: #f0abfc;
          box-shadow: 0 0 18px #ec4899;
        }
        .orbit-ring-outer {
          width: 610px;
          height: 610px;
          margin: -305px 0 0 -305px;
        }
        .orbit-ring-inner {
          width: 490px;
          height: 490px;
          margin: -245px 0 0 -245px;
          border-color: rgba(236, 72, 153, 0.13);
        }
        .orbit-core {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 430px;
          height: 430px;
          margin: -215px 0 0 -215px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, rgba(168, 85, 247, 0.08) 36%, transparent 72%);
          filter: blur(24px);
        }
        .orbit-item {
          position: absolute;
          z-index: 3;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 13px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          background: rgba(8, 8, 16, 0.72);
          color: rgba(255, 255, 255, 0.7);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(16px);
        }
        .orbit-item svg {
          color: #a5b4fc;
        }
        .orbit-item-pdf {
          top: 13%;
          left: 9%;
          transform: translateZ(80px) rotate(-7deg);
        }
        .orbit-item-vectors {
          top: 33%;
          right: 3%;
          transform: translateZ(110px) rotate(6deg);
        }
        .orbit-item-answers {
          bottom: 11%;
          left: 21%;
          transform: translateZ(95px) rotate(4deg);
        }
        .trust-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 22px;
          margin-top: 30px;
        }
        .trust-row span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: rgba(255, 255, 255, 0.38);
          font-size: 13px;
          font-weight: 500;
        }
        .trust-row svg {
          color: #818cf8;
        }
        .upload-shell {
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }
        .upload-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }
        .upload-card-kicker {
          display: block;
          margin-bottom: 7px;
          color: rgba(165, 180, 252, 0.65);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.18em;
        }
        .upload-card-header h2 {
          color: #fff;
          font-size: 21px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .secure-pill {
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          gap: 7px;
          padding: 7px 11px;
          border: 1px solid rgba(52, 211, 153, 0.16);
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.07);
          color: rgba(167, 243, 208, 0.72);
          font-size: 11px;
          font-weight: 600;
        }
        .secure-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 10px rgba(52, 211, 153, 0.8);
        }
        .upload-icon-wrap {
          display: grid;
          width: 68px;
          height: 68px;
          margin: 0 auto;
          place-items: center;
          border: 1px solid rgba(129, 140, 248, 0.2);
          border-radius: 20px;
          background: rgba(99, 102, 241, 0.1);
          box-shadow: 0 0 36px rgba(99, 102, 241, 0.16);
        }
        .upload-file-note {
          display: block;
          margin-top: 14px;
          color: rgba(255, 255, 255, 0.2);
          font-size: 11px;
          letter-spacing: 0.04em;
        }
        /* STYLE_PLACEHOLDER_2 */
        /* Analyze button */
        .analyze-btn {
          position: relative;
          overflow: hidden;
          isolation: isolate;
          padding: 18px;
          border: none;
          border-radius: 16px;
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
          box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.3), 0 8px 32px rgba(168, 85, 247, 0.35),
            0 0 80px rgba(236, 72, 153, 0.15);
          transition: box-shadow 0.3s ease, transform 0.2s ease;
        }
        .analyze-btn:hover:not(:disabled) {
          box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.5), 0 8px 48px rgba(168, 85, 247, 0.6),
            0 0 120px rgba(236, 72, 153, 0.3);
        }
        .analyze-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: -1;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
          transform: translateX(-100%);
          transition: transform 0.6s ease;
        }
        .analyze-btn:hover:not(:disabled)::after {
          transform: translateX(100%);
        }
        .analyze-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .analyze-success {
          background: linear-gradient(135deg, #10b981, #059669) !important;
          box-shadow: 0 0 80px rgba(16, 185, 129, 0.8) !important;
        }
        .analyze-spinner {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          animation: analyze-spin 0.7s linear infinite;
        }
        @keyframes analyze-spin {
          to {
            transform: rotate(360deg);
          }
        }
        /* Metrics */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          max-width: 1100px;
          margin: 0 auto;
        }
        .metric-cell {
          position: relative;
          padding: 12px 0;
        }
        .metric-cell:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 10%;
          right: 0;
          width: 1px;
          height: 80%;
          background: rgba(255, 255, 255, 0.06);
        }
        /* Steps connecting line */
        .steps-wrap {
          position: relative;
        }
        .steps-line {
          position: absolute;
          top: 80px;
          left: 12%;
          width: 76%;
          height: 2px;
          z-index: 0;
        }
        .steps-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        .step-dot {
          position: absolute;
          top: -5px;
          left: 32px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #a855f7;
          box-shadow: 0 0 14px rgba(168, 85, 247, 0.9);
        }
        /* Demo CTA mesh */
        .demo-cta {
          position: relative;
          overflow: hidden;
          box-shadow: 0 30px 100px rgba(0, 0, 0, 0.5), 0 0 80px rgba(99, 102, 241, 0.08);
        }
        .mesh {
          position: absolute;
          width: 320px;
          height: 320px;
          border-radius: 50%;
          filter: blur(70px);
          pointer-events: none;
          z-index: 0;
        }
        .mesh-1 {
          top: -60px;
          left: -40px;
          background: rgba(99, 102, 241, 0.4);
          opacity: 0.08;
          animation: mesh-drift-1 9s ease-in-out infinite;
        }
        .mesh-2 {
          bottom: -80px;
          right: -40px;
          background: rgba(168, 85, 247, 0.4);
          opacity: 0.08;
          animation: mesh-drift-2 11s ease-in-out infinite;
        }
        .mesh-3 {
          top: 40%;
          left: 40%;
          background: rgba(236, 72, 153, 0.4);
          opacity: 0.08;
          animation: mesh-drift-3 13s ease-in-out infinite;
        }
        @keyframes mesh-drift-1 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(60px, 40px); }
        }
        @keyframes mesh-drift-2 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-50px, -30px); }
        }
        @keyframes mesh-drift-3 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-40px, 50px); }
        }
        .demo-buttons {
          display: flex;
          gap: 16px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .ghost-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 18px 36px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.7);
          font-size: 17px;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
          transition: border-color 0.3s ease, color 0.3s ease;
        }
        .ghost-btn:hover {
          border-color: rgba(255, 255, 255, 0.9);
          color: #fff;
        }
        /* Shared section helpers */
        .story-section {
          isolation: isolate;
        }
        .story-section::before {
          position: absolute;
          z-index: -1;
          top: 10%;
          left: 50%;
          width: min(900px, 82vw);
          height: 420px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.07), transparent 68%);
          filter: blur(40px);
          content: '';
          transform: translateX(-50%);
          pointer-events: none;
        }
        .section-kicker {
          display: block;
          margin-bottom: 14px;
          color: rgba(165, 180, 252, 0.65);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-align: center;
        }
        .depth-card {
          position: relative;
          overflow: hidden;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
          transition: border-color 0.35s ease, box-shadow 0.35s ease;
          will-change: transform;
        }
        .depth-card::after {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.055), transparent 38%, transparent 68%, rgba(99, 102, 241, 0.045));
          content: '';
          pointer-events: none;
        }
        .feature-icon {
          display: grid;
          width: 50px;
          height: 50px;
          margin-bottom: 18px;
          place-items: center;
          border: 1px solid currentColor;
          border-radius: 15px;
          background: color-mix(in srgb, currentColor 9%, transparent);
          box-shadow: 0 0 26px color-mix(in srgb, currentColor 14%, transparent);
        }
        .hero-ambient {
          position: fixed;
          z-index: 0;
          border-radius: 999px;
          pointer-events: none;
          filter: blur(110px);
          will-change: transform, opacity;
        }
        .hero-ambient-left {
          top: 16%;
          left: -12%;
          width: 38vw;
          height: 38vw;
          background: rgba(99, 102, 241, 0.16);
        }
        .hero-ambient-right {
          top: 24%;
          right: -8%;
          width: 34vw;
          height: 34vw;
          background: rgba(236, 72, 153, 0.12);
        }
        @media (max-width: 1050px) {
          .hero-section {
            padding-top: 132px;
          }
          .hero-grid {
            grid-template-columns: 1fr;
            gap: 56px;
            max-width: 760px;
          }
          .hero-copy,
          .hero-upload {
            justify-self: center;
          }
          .hero-orbit {
            width: 650px;
            height: 650px;
            opacity: 0.75;
          }
          .scroll-indicator {
            display: none;
          }
        }
        @media (max-width: 880px) {
          .metrics-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 32px 0;
          }
          .metric-cell:nth-child(2)::after {
            display: none;
          }
          .steps-line {
            display: none;
          }
          .steps-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .hero-section {
            min-height: auto !important;
            padding: 116px 18px 72px;
          }
          .hero-grid {
            gap: 40px;
          }
          .hero-copy {
            text-align: center;
          }
          .hero-copy p {
            margin-right: auto;
            margin-left: auto;
          }
          .hero-badges,
          .trust-row {
            justify-content: center;
          }
          .hero-tagline {
            justify-content: center;
          }
          .hero-upload {
            transform: none !important;
          }
          .hero-orbit {
            display: none;
          }
          .glass-hero-canvas {
            display: none;
          }
          .upload-shell {
            padding: 24px !important;
          }
          .upload-dropzone {
            padding: 54px 18px !important;
          }
          .hero-ambient {
            width: 70vw;
            height: 70vw;
            filter: blur(80px);
          }
          .demo-buttons {
            flex-direction: column;
          }
          .ghost-btn,
          .demo-buttons .glow-btn {
            width: 100%;
            justify-content: center;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-upload,
          .hero-ambient,
          .upload-aurora,
          .orbit-ring,
          .orbit-core,
          .orbit-item,
          .mesh,
          .hero-glow-word {
            transform: none !important;
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}



