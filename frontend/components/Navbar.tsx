'use client';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Sun, Moon, FileText } from 'lucide-react';
import AccountMenu from '@/components/AccountMenu';

// Navigation links for smooth scroll or cross-route navigation
const NAV_LINKS = [
  { label: 'Product', id: 'features' },
  { label: 'How it works', id: 'how-it-works' },
  { label: 'Technology', id: 'technology' },
];

// Main navigation component with scroll detection, mobile menu, and theme toggle
export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(true);

  // Detect scroll position to apply backdrop blur
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Scrolls to a section or navigates to the homepage with a hash
  const scrollTo = (id: string) => {
    setMenuOpen(false);
    if (pathname === '/') {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    } else {
      router.push(`/#${id}`);
    }
  };

  // Navigates to the home page top
  const goHome = () => {
    setMenuOpen(false);
    if (pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
    else router.push('/');
  };

  return (
    <>
      <motion.nav
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 1000,
          padding: '0 24px',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.3s, border-color 0.3s, backdrop-filter 0.3s',
          background: scrolled ? 'rgba(5,9,20,0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          WebkitBackdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        }}
      >
        {/* Logo */}
        <button onClick={goHome} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(37,99,235,0.5)' }}>
            <FileText size={16} color="white" />
          </div>
          <div>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#fff', letterSpacing: '-0.02em' }}>DocMind</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#3b82f6', letterSpacing: '-0.02em' }}> AI</span>
          </div>
        </button>

        {/* Desktop nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }} className="desktop-nav">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'color 0.2s', padding: '4px 0' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}
            >
              {link.label}
            </button>
          ))}
          <a href="https://github.com" target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.65)')}>
            GitHub
          </a>
        </div>

        {/* Right side actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Theme toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="nav-theme"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: '6px', borderRadius: '8px', transition: 'color 0.2s, background 0.2s', display: 'flex' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Profile avatar once signed in; a Sign in CTA for anonymous visitors. */}
          <AccountMenu />

          {/* Open DocMind CTA */}
          <button
            onClick={goHome}
            className="glow-btn desktop-nav"
            style={{ padding: '9px 20px', borderRadius: '10px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Open DocMind →
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ display: 'none', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px' }}
            className="mobile-menu-btn"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </motion.nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(5,9,20,0.97)', backdropFilter: 'blur(20px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '28px', padding: '80px 24px 40px' }}
          >
            {NAV_LINKS.map((link) => (
              <button key={link.id} onClick={() => scrollTo(link.id)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, fontWeight: 700, cursor: 'pointer' }}>
                {link.label}
              </button>
            ))}
            <button onClick={() => { setMenuOpen(false); goHome(); }} className="glow-btn" style={{ padding: '14px 32px', borderRadius: '12px', fontSize: 16, fontWeight: 700, marginTop: 8 }}>
              Open DocMind →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        /* Keep the profile control and hamburger on one line on narrow phones. */
        @media (max-width: 420px) {
          .nav-theme { display: none !important; }
        }
      `}</style>
    </>
  );
}
