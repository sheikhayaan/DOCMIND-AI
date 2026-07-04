'use client';
import { useState, useRef, useEffect, Fragment, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  FileText,
  Copy,
  CheckCheck,
  ChevronDown,
  CheckCircle,
  AlertTriangle,
  Info,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import { queryDocument, getSuggestions, type ChatHistoryMessage } from '@/lib/api';

const ParticleBackground = dynamic(() => import('@/components/ParticleBackground'), {
  ssr: false,
});

interface Source {
  page: number;
  text: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
  sources?: Source[];
  confidence?: string;
  time: string;
}

const CAPABILITIES = [
  '📄 Find information',
  '🔢 Analyze data',
  '📋 Summarize sections',
  '⚖️ Compare content',
  '🔍 Locate specifics',
];

const TYPE_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  legal: { bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.3)', color: '#c084fc' },
  financial: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.3)', color: '#4ade80' },
  research: { bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)', color: '#818cf8' },
  technical: { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)', color: '#fb923c' },
  medical: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', color: '#f87171' },
  general: { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', color: '#aaaaaa' },
};

const CONFIDENCE_STYLES: Record<
  string,
  { bg: string; border: string; color: string; label: string; Icon: LucideIcon }
> = {
  high: {
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.3)',
    color: '#4ade80',
    label: 'High confidence',
    Icon: CheckCircle,
  },
  medium: {
    bg: 'rgba(234,179,8,0.12)',
    border: 'rgba(234,179,8,0.3)',
    color: '#facc15',
    label: 'Medium confidence',
    Icon: Info,
  },
  low: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.3)',
    color: '#f87171',
    label: 'Low confidence',
    Icon: AlertTriangle,
  },
};

// Render **bold** segments inside AI text
function parseMarkdown(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: '#ffffff', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// AI answer rendered word-by-word so a completed response still "types" in.
function AnimatedAnswer({ text }: { text: string }) {
  const words = text.split(/(\s+)/); // keep whitespace tokens
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {words.map((w, i) => {
        if (/^\s+$/.test(w)) return <Fragment key={i}>{w}</Fragment>;
        return (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.015, duration: 0.2 }}
            style={{ display: 'inline-block' }}
          >
            {parseMarkdown(w)}
          </motion.span>
        );
      })}
    </span>
  );
}

// Source chip that expands downward to reveal snippet text on hover.
function SourceChip({ source, delay }: { source: Source; delay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onHoverStart={() => setOpen(true)}
      onHoverEnd={() => setOpen(false)}
      style={{
        background: 'rgba(99,102,241,0.1)',
        border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: open ? '16px' : '999px',
        color: '#a5b4fc',
        fontSize: '14px',
        cursor: 'default',
        overflow: 'hidden',
        maxWidth: open ? '320px' : '120px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 18px' }}>
        <FileText size={13} />
        Page {source.page}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            style={{ overflow: 'hidden' }}
          >
            <p
              style={{
                padding: '0 18px 12px',
                fontSize: '12px',
                lineHeight: 1.5,
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              {source.text.slice(0, 100)}
              {source.text.length > 100 ? '…' : ''}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatContent />
    </Suspense>
  );
}

function ChatFallback() {
  return <div style={{ minHeight: '100vh', background: '#000', color: '#fff' }} />;
}

function ChatContent() {
  const params = useSearchParams();
  const docId = params.get('docId') || '';
  const filename = params.get('filename') || 'Document';
  const docType = params.get('docType') || 'general';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ChatHistoryMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [focused, setFocused] = useState(false);
  const [isMac] = useState(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch suggested questions on mount
  useEffect(() => {
    let active = true;
    getSuggestions(docId, docType)
      .then((res) => {
        if (active) setSuggestions(res.length ? res : null);
      })
      .catch(() => {
        if (active) setSuggestions(null);
      });
    return () => {
      active = false;
    };
  }, [docId, docType]);

  // Auto scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Track scroll position for "scroll to bottom" button
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distanceFromBottom > 300);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-expand textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [input]);

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setInput('');
    setLoading(true);
    setSuggestions(null);

    const userMsg: Message = { role: 'user', content: trimmed, time: timeNow() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await queryDocument(trimmed, docId, history);
      const aiMsg: Message = {
        role: 'ai',
        content: res.answer,
        sources: res.sources,
        confidence: res.confidence,
        time: timeNow(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setHistory((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: res.answer },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: 'Something went wrong reaching the server. Please try again.',
          confidence: 'low',
          time: timeNow(),
        },
      ]);
    }
    setLoading(false);
  };

  const copyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  };

  const typeStyle = TYPE_STYLES[docType] || TYPE_STYLES.general;
  const charCount = input.length;

  return (
    <div style={{ height: '100vh', overflow: 'hidden', position: 'relative', background: '#000' }}>
      <ParticleBackground />
      <Navbar />

      {/* Subtle depth glow from the top */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.04) 0%, transparent 70%)',
        }}
      />

      {/* Document info pill */}
      <motion.div
        initial={{ opacity: 0, y: -20, x: '-50%' }}
        animate={{ opacity: 1, y: 0, x: '-50%' }}
        transition={{ delay: 0.3 }}
        style={{
          position: 'fixed',
          top: '100px',
          left: '50%',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '999px',
          padding: '12px 24px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          maxWidth: '90vw',
        }}
      >
        {/* Pulsing ready dot */}
        <motion.span
          animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#4ade80',
            boxShadow: '0 0 10px rgba(74,222,128,0.8)',
            flexShrink: 0,
          }}
        />
        <FileText size={18} color="#6366f1" style={{ flexShrink: 0 }} />
        <span
          style={{
            color: '#fff',
            fontSize: '15px',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '240px',
          }}
        >
          {decodeURIComponent(filename)}
        </span>
        <span
          style={{
            background: typeStyle.bg,
            border: `1px solid ${typeStyle.border}`,
            color: typeStyle.color,
            borderRadius: '999px',
            padding: '4px 14px',
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'capitalize',
            flexShrink: 0,
          }}
        >
          {docType}
        </span>
      </motion.div>

      {/* Messages */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          zIndex: 1,
          height: 'calc(100vh - 100px)',
          overflowY: 'auto',
          paddingTop: '170px',
          paddingBottom: '140px',
        }}
      >
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px' }}>
          {/* Empty state */}
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ position: 'relative', textAlign: 'center', paddingTop: '40px' }}
            >
              {/* Giant rotating infinity glyph */}
              <motion.div
                aria-hidden
                animate={{ rotate: 360 }}
                transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
                className="gradient-text"
                style={{
                  position: 'absolute',
                  top: '-40px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '200px',
                  lineHeight: 1,
                  opacity: 0.03,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  fontWeight: 800,
                }}
              >
                ∞
              </motion.div>

              <p
                style={{
                  position: 'relative',
                  fontSize: 'clamp(24px, 4vw, 36px)',
                  fontWeight: 800,
                  color: 'rgba(255,255,255,0.08)',
                  marginBottom: '40px',
                  lineHeight: 1.3,
                }}
              >
                Ask anything about
                <br />
                your document
              </p>

              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                {suggestions === null
                  ? [280, 320, 260, 300].map((w, i) => (
                      <div
                        key={i}
                        className="skeleton-pill"
                        style={{ width: `${w}px`, height: '52px', maxWidth: '90vw' }}
                      />
                    ))
                  : suggestions.map((q, i) => (
                      <motion.button
                        key={q}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        whileHover={{
                          borderColor: '#6366f1',
                          color: '#ffffff',
                          boxShadow: '0 0 20px rgba(99,102,241,0.1)',
                        }}
                        onClick={() => send(q)}
                        style={{
                          padding: '16px 24px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '16px',
                          color: 'rgba(255,255,255,0.6)',
                          fontSize: '16px',
                          cursor: 'pointer',
                          maxWidth: '480px',
                          width: '100%',
                          textAlign: 'left',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {q}
                      </motion.button>
                    ))}
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                style={{
                  position: 'relative',
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  marginTop: '32px',
                }}
              >
                {CAPABILITIES.map((c) => (
                  <span
                    key={c}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '999px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      color: 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* Messages list */}
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => {
              const conf = msg.confidence ? CONFIDENCE_STYLES[msg.confidence] : null;
              const isLastAi = msg.role === 'ai' && i === messages.length - 1;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: msg.role === 'user' ? 30 : -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '32px',
                    gap: '6px',
                  }}
                >
                  {msg.role === 'ai' && (
                    <span style={{ color: '#818cf8', fontSize: '15px', fontWeight: 700 }}>
                      DocMind AI
                    </span>
                  )}

                  {msg.role === 'user' ? (
                    <div
                      className="user-bubble"
                      style={{
                        maxWidth: '85%',
                        background:
                          'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
                        backgroundSize: '200% 200%',
                        borderRadius: '24px 24px 4px 24px',
                        padding: '18px 24px',
                        color: '#fff',
                        fontSize: '17px',
                        lineHeight: 1.6,
                        boxShadow: '0 8px 32px rgba(139,92,246,0.25)',
                      }}
                    >
                      {msg.content}
                    </div>
                  ) : (
                    <div
                      className="ai-bubble"
                      style={{
                        position: 'relative',
                        maxWidth: '90%',
                        background: 'rgba(255,255,255,0.03)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: '24px 24px 24px 4px',
                        padding: '24px 28px',
                        color: 'rgba(255,255,255,0.85)',
                        fontSize: '17px',
                        lineHeight: 1.8,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                      }}
                    >
                      {isLastAi ? (
                        <AnimatedAnswer text={msg.content} />
                      ) : (
                        <span style={{ whiteSpace: 'pre-wrap' }}>{parseMarkdown(msg.content)}</span>
                      )}
                      <button
                        onClick={() => copyMessage(msg.content, i)}
                        className="copy-btn"
                        style={{
                          position: 'absolute',
                          top: '12px',
                          right: '12px',
                          background: 'rgba(255,255,255,0.05)',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '6px',
                          cursor: 'pointer',
                          opacity: 0,
                          transition: 'opacity 0.2s ease',
                        }}
                        title="Copy message"
                      >
                        {copiedIndex === i ? (
                          <CheckCheck size={14} color="#4ade80" />
                        ) : (
                          <Copy size={14} color="#888" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Sources + confidence */}
                  {msg.role === 'ai' && (msg.sources?.length || conf) && (
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingLeft: '4px', alignItems: 'flex-start' }}>
                      {msg.sources?.map((s, j) => (
                        <SourceChip key={j} source={s} delay={0.1 + j * 0.1} />
                      ))}
                      {conf && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={
                            msg.confidence === 'high'
                              ? {
                                  opacity: 1,
                                  boxShadow: [
                                    '0 0 8px rgba(74,222,128,0.4)',
                                    '0 0 20px rgba(74,222,128,0.6)',
                                    '0 0 8px rgba(74,222,128,0.4)',
                                  ],
                                }
                              : msg.confidence === 'low'
                                ? { opacity: 1, x: [0, -2, 2, -2, 0] }
                                : { opacity: 1 }
                          }
                          transition={
                            msg.confidence === 'high'
                              ? { boxShadow: { duration: 2, repeat: Infinity }, opacity: { delay: 0.2 } }
                              : msg.confidence === 'low'
                                ? { x: { duration: 0.4, repeat: Infinity, repeatDelay: 3 }, opacity: { delay: 0.2 } }
                                : { delay: 0.2 }
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: conf.bg,
                            border: `1px solid ${conf.border}`,
                            borderRadius: '999px',
                            padding: '6px 18px',
                            color: conf.color,
                            fontSize: '14px',
                          }}
                        >
                          <conf.Icon size={14} />
                          {conf.label}
                        </motion.span>
                      )}
                    </div>
                  )}

                  {/* Timestamp */}
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.25)',
                      paddingLeft: msg.role === 'ai' ? '4px' : 0,
                      paddingRight: msg.role === 'user' ? '4px' : 0,
                    }}
                  >
                    {msg.time}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Typing indicator */}
          {loading && (
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', marginBottom: '32px' }}
            >
              <span style={{ color: '#818cf8', fontSize: '15px', fontWeight: 700 }}>DocMind AI</span>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '18px 24px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: '24px 24px 24px 4px',
                }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#818cf8' }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToBottom}
            className="glass"
            style={{
              position: 'fixed',
              bottom: '120px',
              right: '24px',
              zIndex: 30,
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(99,102,241,0.2)',
            }}
          >
            <ChevronDown size={20} color="#fff" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(900px, 92vw)',
          zIndex: 10,
        }}
      >
        {/* Keyboard shortcut hint */}
        <AnimatePresence>
          {focused && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              style={{
                position: 'absolute',
                top: '-30px',
                right: '16px',
                fontSize: '12px',
                color: 'rgba(255,255,255,0.35)',
              }}
            >
              {isMac ? '⌘ Enter' : 'Ctrl Enter'} to send
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          animate={{
            borderColor: focused ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)',
            boxShadow: focused
              ? '0 0 0 4px rgba(99,102,241,0.1), 0 8px 32px rgba(0,0,0,0.4)'
              : '0 8px 32px rgba(0,0,0,0.4)',
          }}
          transition={{ duration: 0.25 }}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '12px',
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '28px',
            padding: '8px 8px 8px 28px',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything..."
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: '17px',
              resize: 'none',
              minHeight: '28px',
              maxHeight: '120px',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              padding: '12px 0',
            }}
          />
          <motion.button
            whileHover={input.trim() ? { scale: 1.08 } : {}}
            whileTap={input.trim() ? { scale: 0.92 } : {}}
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className={input.trim() ? 'send-active' : ''}
            style={{
              position: 'relative',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: 'none',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
              background: input.trim() ? 'transparent' : 'rgba(255,255,255,0.06)',
            }}
          >
            <ArrowUp size={20} color={input.trim() ? '#fff' : '#444'} style={{ position: 'relative', zIndex: 1 }} />
          </motion.button>
        </motion.div>
        <div
          style={{
            textAlign: 'right',
            fontSize: '12px',
            color: charCount > 500 ? '#f87171' : 'rgba(255,255,255,0.2)',
            marginTop: '6px',
            paddingRight: '16px',
          }}
        >
          {charCount} / 500
        </div>
      </div>

      {/* Decorative sparkle */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 5, display: 'none' }}
        className="sparkle-deco"
      >
        <Sparkles size={24} color="rgba(255,255,255,0.15)" />
      </motion.div>

      <style jsx global>{`
        .ai-bubble:hover .copy-btn {
          opacity: 1;
        }
        .user-bubble {
          animation: user-shimmer 3s linear infinite;
        }
        @keyframes user-shimmer {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: 100% 100%;
          }
        }
        /* Rotating gradient wheel behind the active send button */
        .send-active::before {
          content: '';
          position: absolute;
          inset: 0;
          background: conic-gradient(from 0deg, #6366f1, #ec4899, #6366f1);
          animation: send-spin 3s linear infinite;
          z-index: 0;
        }
        @keyframes send-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @media (min-width: 900px) {
          .sparkle-deco {
            display: block !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .user-bubble,
          .send-active::before {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
