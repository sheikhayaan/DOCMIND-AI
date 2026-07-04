'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';

const LINKS = [
  { label: 'Home', id: 'top' },
  { label: 'Features', id: 'features' },
  { label: 'Demo', id: 'demo' },
];

const LOGO = 'DocMind'.split('');

export default function Navbar() {
  const [active, setActive] = useState('top');
  const [scrolled, setScrolled] = useState(false);
  const [outline, setOutline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 100);
      setOutline(window.scrollY > 300);
    };
    onScroll();
    window.addEventListener('scroll', onScroll);

    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(
      Boolean,
    ) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-40% 0px -50% 0px' },
    );
    sections.forEach((s) => observer.observe(s));

    return () => {
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <motion.nav
        className="nav-shell"
        initial={{ opacity: 0, y: -16, x: '-50%' }}
        animate={{ opacity: 1, y: 0, x: '-50%' }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
        style={{
          position: 'fixed',
          top: '24px',
          left: '50%',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px',
          paddingLeft: '24px',
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: scrolled ? 'blur(40px) saturate(180%)' : 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: scrolled ? 'blur(40px) saturate(180%)' : 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '999px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 60px rgba(99,102,241,0.08) inset',
          transition: 'backdrop-filter 0.3s ease',
          maxWidth: '92vw',
        }}
      >
        {/* Logo — each letter flips in on load */}
        <div
          className="nav-logo"
          style={{
            fontWeight: 800,
            fontSize: '17px',
            whiteSpace: 'nowrap',
            marginRight: '8px',
            cursor: 'pointer',
            display: 'flex',
            perspective: '600px',
          }}
          onClick={() => scrollTo('top')}
        >
          {LOGO.map((ch, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, rotateY: 90 }}
              animate={{ opacity: 1, rotateY: 0 }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              style={{ color: '#ffffff', display: 'inline-block' }}
            >
              {ch}
            </motion.span>
          ))}
          <motion.span
            initial={{ opacity: 0, rotateY: 90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            transition={{ delay: 0.2 + LOGO.length * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="gradient-text nav-logo-ai"
            style={{ display: 'inline-block' }}
          >
            AI
          </motion.span>
        </div>

        {/* Links */}
        <div style={{ display: 'flex', gap: '4px', position: 'relative' }} className="navbar-links">
          {LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              style={{
                position: 'relative',
                padding: '8px 16px',
                fontSize: '14px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: active === link.id ? '#ffffff' : 'rgba(255,255,255,0.5)',
                borderRadius: '999px',
                transition: 'color 0.2s ease',
                zIndex: 1,
              }}
            >
              {active === link.id && (
                <motion.div
                  layoutId="navPill"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255,255,255,0.08)',
                    borderRadius: '999px',
                    zIndex: -1,
                  }}
                />
              )}
              {link.label}
              {active === link.id && (
                <motion.div
                  layoutId="navUnderline"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  style={{
                    position: 'absolute',
                    left: '16px',
                    right: '16px',
                    bottom: '2px',
                    height: '2px',
                    borderRadius: '2px',
                    background: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)',
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* CTA — switches from filled to gradient-outline past 300px scroll */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className={outline ? 'nav-cta-outline' : 'glow-btn'}
          onClick={() => scrollTo('demo')}
          style={{
            padding: '12px 28px',
            borderRadius: '999px',
            fontSize: '14px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            transition: 'background 0.4s ease, box-shadow 0.4s ease, color 0.4s ease',
          }}
        >
          Get Started
        </motion.button>

        {/* Hamburger (mobile only) */}
        <button
          className="nav-hamburger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            display: 'none',
            width: '40px',
            height: '40px',
            borderRadius: '999px',
            border: 'none',
            background: 'rgba(255,255,255,0.06)',
            color: '#fff',
            cursor: 'pointer',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.span
            initial={false}
            animate={{ rotate: menuOpen ? 90 : 0 }}
            transition={{ duration: 0.25 }}
            style={{ display: 'inline-flex' }}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </motion.span>
        </button>

        <style jsx>{`
          .nav-shell {
            isolation: isolate;
            overflow: hidden;
          }
          .nav-shell::before {
            position: absolute;
            z-index: -1;
            inset: 0;
            background: linear-gradient(110deg, transparent 15%, rgba(255, 255, 255, 0.055) 45%, transparent 72%);
            content: '';
            transform: translateX(-120%);
            animation: nav-sheen 8s ease-in-out infinite;
            pointer-events: none;
          }
          .nav-logo {
            position: relative;
          }
          .nav-logo-ai {
            text-shadow: 0 0 12px rgba(168, 85, 247, 0.6);
          }
          .nav-cta-outline {
            position: relative;
            background: rgba(8, 8, 16, 0.6);
            color: #fff;
            border: 1px solid transparent;
            background-image: linear-gradient(rgba(8, 8, 16, 0.6), rgba(8, 8, 16, 0.6)),
              linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
            background-origin: border-box;
            background-clip: padding-box, border-box;
            cursor: pointer;
          }
          .nav-cta-outline:hover {
            box-shadow: 0 0 24px rgba(168, 85, 247, 0.35);
          }
          @keyframes nav-sheen {
            0%,
            68% {
              transform: translateX(-120%);
            }
            88%,
            100% {
              transform: translateX(120%);
            }
          }
          @media (max-width: 768px) {
            .navbar-links {
              display: none !important;
            }
            :global(.nav-shell) .nav-cta-outline,
            :global(.nav-shell) .glow-btn {
              display: none !important;
            }
            .nav-hamburger {
              display: flex !important;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .nav-shell::before {
              animation: none;
            }
          }
        `}</style>
      </motion.nav>

      {/* Full-screen mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 49,
              background: 'rgba(0,0,0,0.95)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '28px',
              padding: '120px 24px 48px',
            }}
          >
            {LINKS.map((link, i) => (
              <motion.button
                key={link.id}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.08 }}
                onClick={() => scrollTo(link.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: active === link.id ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontSize: '32px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {link.label}
              </motion.button>
            ))}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + LINKS.length * 0.08 }}
              className="glow-btn"
              onClick={() => scrollTo('demo')}
              style={{
                marginTop: '16px',
                padding: '18px 56px',
                borderRadius: '999px',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              Get Started
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
