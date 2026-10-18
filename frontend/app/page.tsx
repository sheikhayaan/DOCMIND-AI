'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, useInView, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import {
  Upload, Zap, Code2, GraduationCap, Briefcase,
  FlaskConical, ArrowRight, CheckCircle2, FileText, Brain,
  Lock, ChevronRight, Sparkles, Search, MessageSquare, AlertCircle, Trash2, History
} from 'lucide-react';
import {
  ensureAccessToken,
  uploadPDF,
  waitForIngestion,
  getDocumentStatus,
  deleteDocument,
  type DocumentRecord,
  type PDFSlotStatus,
} from '@/lib/api';
import {
  listConversations,
  deleteConversation,
  formatConversationTime,
  type StoredConversation,
} from '@/lib/chat-history';

const ParticleBackground = dynamic(() => import('@/components/ParticleBackground'), {
  ssr: false,
});

// ------------- Types ---------------------------------------------------

interface UploadState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  fileName?: string;
  error?: string;
}

// ------------- Animated section wrapper --------------------------------

/** Fades and slides section content up when it enters the viewport */
function Section({ children, id, style = {} }: { children: React.ReactNode; id?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      style={{ padding: '100px 24px', ...style }}
    >
      {children}
    </motion.section>
  );
}

// ------------- 3D App Mockup -------------------------------------------

/** Renders the 3D perspective-tilted app preview that floats in the hero */
function AppMockup() {
  const [tilt, setTilt] = useState({ x: -8, y: 6 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply gentle mouse-tracking parallax to the mockup
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    setTilt({ x: -8 + dy * 6, y: 6 + dx * 8 });
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} style={{ perspective: '1200px', flex: '1 1 480px', maxWidth: 580, minWidth: 300 }}>
      <motion.div
        animate={{ rotateX: tilt.x, rotateY: tilt.y }}
        transition={{ type: 'spring', stiffness: 60, damping: 20 }}
        style={{
          transformStyle: 'preserve-3d',
          borderRadius: 24,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(37,99,235,0.15)',
          background: '#0d1117',
          position: 'relative',
        }}
        className="float-anim app-mockup-shell"
      >
        {/* Window chrome */}
        <div style={{ background: '#161b22', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
            <FileText size={13} color="#3b82f6" />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>DocMind AI</span>
          </div>
        </div>

        {/* App layout */}
        <div style={{ display: 'flex', height: 380 }}>
          {/* Sidebar */}
          <div className="mockup-sidebar" style={{ width: 180, background: '#0d1117', borderRight: '1px solid rgba(255,255,255,0.05)', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(37,99,235,0.12)', color: '#3b82f6', fontSize: 12, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Sparkles size={12} /> New Chat
            </div>
            {['Attention Paper', 'System Design', 'Math Assignment', 'Research Survey'].map((label, i) => (
              <div key={i} style={{ padding: '7px 10px', borderRadius: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}>
                <FileText size={11} /> {label}
              </div>
            ))}
          </div>

          {/* PDF viewer strip */}
          <div className="mockup-pdf" style={{ width: 200, background: '#13171f', borderRight: '1px solid rgba(255,255,255,0.05)', padding: '10px', overflow: 'hidden' }}>
            <div style={{ background: '#1a1f2e', borderRadius: 6, height: '100%', padding: '12px 10px' }}>
              <div style={{ textAlign: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>Attention Is All You Need</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>August 31, 2017</div>
              </div>
              {[100, 80, 90, 70, 85, 60, 75, 88, 65, 78].map((w, i) => (
                <div key={i} style={{ height: 5, borderRadius: 3, background: `rgba(255,255,255,${i % 3 === 0 ? 0.08 : 0.04})`, width: `${w}%`, marginBottom: 4 }} />
              ))}
              <div style={{ marginTop: 8, padding: '6px', background: 'rgba(37,99,235,0.1)', borderRadius: 4, border: '1px solid rgba(37,99,235,0.2)' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>Abstract</div>
                {[90, 75, 85, 70].map((w, i) => (
                  <div key={i} style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', width: `${w}%`, marginBottom: 3 }} />
                ))}
              </div>
            </div>
          </div>

          {/* Chat panel */}
          <div style={{ flex: 1, background: '#0d1117', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 8 }}>
              {['Chat', 'Sources', 'Notes'].map((t, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? '#3b82f6' : 'rgba(255,255,255,0.3)', paddingBottom: 4, borderBottom: i === 0 ? '2px solid #3b82f6' : 'none', cursor: 'pointer' }}>{t}</span>
              ))}
            </div>
            {/* User message */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ background: '#1d3e8f', borderRadius: '10px 10px 2px 10px', padding: '7px 10px', maxWidth: '85%', fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
                What is the main contribution of this paper?
              </div>
            </div>
            {/* AI response */}
            <div style={{ background: '#161b22', borderRadius: '2px 10px 10px 10px', padding: '10px 12px', maxWidth: '95%' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, marginBottom: 6 }}>
                The main contribution is the <span style={{ color: '#60a5fa' }}>Transformer</span> — a novel model architecture relying solely on attention mechanisms.
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Key points:</div>
              {['Self-attention for sequences', 'State-of-the-art results', 'More parallelizable'].map((p, i) => (
                <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', display: 'flex', gap: 5, alignItems: 'flex-start', marginTop: 3 }}>
                  <span style={{ color: '#3b82f6', marginTop: 1 }}>•</span> {p}
                </div>
              ))}
            </div>
            {/* Source badge */}
            <div style={{ marginTop: 'auto', padding: '6px 10px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 8, fontSize: 10, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={10} /> Sources: Attention Is All You Need · p. 1–2
            </div>
          </div>
        </div>
      </motion.div>

      {/* Annotation */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        style={{ position: 'absolute', top: -40, right: -20, pointerEvents: 'none' }}
      >
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 13, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', textAlign: 'right', lineHeight: 1.3 }}>
          From PDFs<br />to real insights
        </div>
        <svg width="60" height="40" viewBox="0 0 60 40" fill="none" style={{ marginLeft: 'auto' }}>
          <path d="M5 5 Q30 0 55 35" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </motion.div>
    </div>
  );
}

// ------------- Saved documents + chats panel ---------------------------

/** Lists the user's uploaded PDFs with their saved chat, so the home page can
    resume a conversation or free a PDF slot without opening a chat first. */
function SavedWorkspace({
  documents,
  conversations,
  slots,
  busyDocId,
  onOpen,
  onDelete,
}: {
  documents: DocumentRecord[];
  conversations: StoredConversation[];
  slots: PDFSlotStatus | null;
  busyDocId: string | null;
  onOpen: (doc: DocumentRecord) => void;
  onDelete: (doc: DocumentRecord) => void;
}) {
  const chatByDoc = new Map(conversations.map((item) => [item.docId, item]));
  const knownIds = new Set(documents.map((doc) => doc.doc_id));
  // Chats saved before a document was deleted still deserve to be reopenable.
  const orphanChats = conversations.filter((item) => !knownIds.has(item.docId));
  const total = documents.length + orphanChats.length;

  if (!total) return null;

  return (
    <Section id="chats" style={{ paddingTop: 0 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3b82f6', textTransform: 'uppercase', marginBottom: 10 }}>Your workspace</p>
            <h2 style={{ fontSize: 'clamp(24px, 3.4vw, 36px)', fontWeight: 800, letterSpacing: '-0.03em' }}>Documents &amp; chat history</h2>
          </div>
          {slots && (
            <div style={{ fontSize: 12, color: slots.remaining > 0 ? 'rgba(255,255,255,0.5)' : '#fbbf24' }}>
              {slots.remaining > 0
                ? `${slots.used} of ${slots.limit} PDF slots used`
                : 'All PDF slots are full — delete one to upload another'}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {documents.map((doc) => {
            const chat = chatByDoc.get(doc.doc_id);
            return (
              <div
                key={doc.doc_id}
                className="glass"
                style={{ padding: 18, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                  <FileText size={16} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.filename}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}>
                      {doc.chunk_count} sections · {doc.question_count} questions
                      {chat?.updatedAt ? ` · ${formatConversationTime(chat.updatedAt)}` : ''}
                    </div>
                  </div>
                </div>

                {chat ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.55)', fontSize: 12, minWidth: 0 }}>
                    <MessageSquare size={12} color="#60a5fa" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chat.preview || `${chat.messageCount} saved messages`}
                    </span>
                  </div>
                ) : (
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>No saved chat yet</div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => onOpen(doc)}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(37,99,235,0.16)', color: '#93c5fd', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {chat ? 'Continue chat' : 'Open chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(doc)}
                    disabled={busyDocId === doc.doc_id}
                    title="Delete this PDF and free the slot"
                    style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: busyDocId === doc.doc_id ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Trash2 size={12} />
                    {busyDocId === doc.doc_id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}

          {orphanChats.map((chat) => (
            <div key={chat.docId} className="glass" style={{ padding: 18, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                <History size={16} color="#a855f7" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.filename}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}>
                    Saved chat · {chat.messageCount} messages
                    {chat.updatedAt ? ` · ${formatConversationTime(chat.updatedAt)}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'rgba(255,255,255,0.55)', fontSize: 12, minWidth: 0 }}>
                <MessageSquare size={12} color="#a855f7" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.preview || 'Saved conversation'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
                <button
                  type="button"
                  onClick={() => onOpen({ doc_id: chat.docId, filename: chat.filename } as DocumentRecord)}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(168,85,247,0.35)', background: 'rgba(168,85,247,0.14)', color: '#d8b4fe', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Open chat
                </button>
                <button
                  type="button"
                  onClick={() => onDelete({ doc_id: chat.docId, filename: chat.filename } as DocumentRecord)}
                  title="Delete this saved chat"
                  style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ------------- Main Page -----------------------------------------------

export default function HomePage() {
  const router = useRouter();
  const [upload, setUpload] = useState<UploadState>({ status: 'idle', progress: 0 });
  const [dragActive, setDragActive] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 400], [0, -60]);
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);

  // Workspace state: uploaded PDFs, their saved chats, and the slot budget.
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [slots, setSlots] = useState<PDFSlotStatus | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  // Loads the signed-in (or guest) document list plus local chat transcripts.
  const refreshWorkspace = useCallback(async () => {
    setConversations(listConversations());
    try {
      await ensureAccessToken();
      const status = await getDocumentStatus();
      setDocuments(status.data.documents);
      setSlots(status.data.pdf_slots);
    } catch {
      // Backend unreachable — the rest of the page still works.
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the first paint is not blocked by state
    // updates and the lint rule against synchronous effect setState is moot.
    void Promise.resolve().then(() => refreshWorkspace());
  }, [refreshWorkspace]);

  // Resumes a saved conversation from the home page.
  const openSavedChat = useCallback((doc: DocumentRecord) => {
    const saved = listConversations().find((item) => item.docId === doc.doc_id);
    const name = saved?.filename || doc.filename || 'Document';
    const type = saved?.docType || 'general';
    router.push(
      `/chat?docId=${encodeURIComponent(doc.doc_id)}` +
        `&filename=${encodeURIComponent(name)}` +
        `&docType=${encodeURIComponent(type)}`,
    );
  }, [router]);

  // Deletes a PDF (freeing its slot) together with its saved chat.
  const removeSavedDoc = useCallback(async (doc: DocumentRecord) => {
    if (!window.confirm(`Delete “${doc.filename}”? This frees a PDF slot and removes its saved chat.`)) return;
    setBusyDocId(doc.doc_id);
    try {
      await ensureAccessToken();
      if (documents.some((item) => item.doc_id === doc.doc_id)) {
        await deleteDocument(doc.doc_id);
      }
    } catch {
      // Already gone server-side: still clear the local transcript.
    } finally {
      deleteConversation(doc.doc_id);
      setBusyDocId(null);
      await refreshWorkspace();
    }
  }, [documents, refreshWorkspace]);

  // Handle scroll to hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  }, []);

  /** Handles PDF selection, queues ingestion, and polls until the document is ready */
  const handleFileUpload = useCallback(async (file: File) => {
    // Case-insensitive PDF check
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    if (!isPDF) {
      setUpload({ status: 'error', progress: 0, error: 'Please select a valid PDF file' });
      return;
    }

    setUpload({ status: 'uploading', progress: 8, fileName: file.name });
    try {
      await ensureAccessToken();
      const result = await uploadPDF(file);
      if (!result.success || !result.doc_id) {
        setUpload({ status: 'error', progress: 0, error: result.message ?? 'Upload failed' });
        return;
      }
      // Store blob URL so the chat page can render the PDF preview panel
      const blobUrl = URL.createObjectURL(file);
      sessionStorage.setItem(`pdf_url_${result.doc_id}`, blobUrl);
      setUpload({ status: 'uploading', progress: 12, fileName: file.name });
      await waitForIngestion(result.doc_id, (status) => {
        setUpload({
          status: 'uploading',
          progress: status.progress,
          fileName: file.name,
        });
      });
      setUpload({ status: 'done', progress: 100, fileName: file.name });
      setTimeout(() => {
        router.push(`/chat?docId=${result.doc_id}&filename=${encodeURIComponent(file.name)}`);
      }, 250);
    } catch (err) {
      setUpload({ status: 'error', progress: 0, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }, [router]);

  /** Drag and drop handlers */
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const openPicker = () => {
    fileInputRef.current?.click();
  };

  // Feature cards data
  const features = [
    { icon: <Brain size={22} color="#60a5fa" />, title: '384D Vector Embeddings', desc: 'Local HuggingFace embeddings for fast, private document indexing without sending data to third parties.' },
    { icon: <Search size={22} color="#a78bfa" />, title: 'Hybrid Retrieval', desc: 'Combines semantic similarity search with BM25 keyword ranking for maximum relevance accuracy.' },
    { icon: <FileText size={22} color="#34d399" />, title: 'Page-level Citations', desc: 'Every answer links back to the exact page number and text excerpt it was derived from.' },
    { icon: <MessageSquare size={22} color="#f472b6" />, title: 'Conversational Memory', desc: 'Follow-up questions preserve context from previous messages for natural multi-turn dialogue.' },
    { icon: <Lock size={22} color="#fb923c" />, title: 'Enterprise Security', desc: 'JWT signed sessions, IP rate limiting, injection scanning, and per-user document isolation.' },
    { icon: <Zap size={22} color="#facc15" />, title: 'Sub-second Answers', desc: 'Groq-powered LLM inference with parallel vector search returns answers in under 1 second.' },
  ];

  const steps = [
    { icon: <Upload size={24} color="#3b82f6" />, step: '01', title: 'Upload your PDF', desc: 'Drop any PDF. The system extracts, chunks, and indexes every page using vector embeddings stored in Pinecone.' },
    { icon: <Search size={24} color="#a855f7" />, step: '02', title: 'Ask anything', desc: 'Type natural language questions. The hybrid retrieval pipeline finds the most relevant chunks across your document.' },
    { icon: <Sparkles size={24} color="#ec4899" />, step: '03', title: 'Get cited answers', desc: 'Receive accurate answers from the LLM with exact page citations showing where information was found.' },
  ];

  const techStack = [
    { name: 'Next.js 16', color: '#fff' },
    { name: 'FastAPI', color: '#009688' },
    { name: 'LangChain', color: '#1c64f2' },
    { name: 'Pinecone', color: '#00d4aa' },
    { name: 'Groq LLM', color: '#f97316' },
    { name: 'HuggingFace', color: '#ffbd59' },
    { name: 'Framer Motion', color: '#bb86fc' },
    { name: 'TypeScript', color: '#3178c6' },
  ];

  const audience = [
    { icon: <GraduationCap size={28} color="#60a5fa" />, title: 'Students', desc: 'Learn deeper' },
    { icon: <FlaskConical size={28} color="#a78bfa" />, title: 'Researchers', desc: 'Analyze faster' },
    { icon: <Briefcase size={28} color="#34d399" />, title: 'Professionals', desc: 'Work smarter' },
    { icon: <Code2 size={28} color="#f472b6" />, title: 'Developers', desc: 'Build with knowledge' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', overflowX: 'clip' }} className="noise">
      <ParticleBackground />
      <Navbar />

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
      />

      {/* Ambient glow orbs */}
      <div className="glow-orb" style={{ width: 600, height: 600, background: 'radial-gradient(circle, rgba(37,99,235,0.25) 0%, transparent 70%)', top: -100, left: -100 }} />
      <div className="glow-orb" style={{ width: 500, height: 500, background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)', top: 200, right: -100 }} />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div id="top" ref={heroRef} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', padding: 'clamp(92px, 12vw, 120px) clamp(16px, 4vw, 24px) 60px', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 'clamp(32px, 5vw, 60px)', flexWrap: 'wrap' }}>
          {/* Left column */}
          <motion.div style={{ flex: '1 1 460px', y: heroY, opacity: heroOpacity }}>
            {/* Tag */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20 }}
            >
              <span className="badge" style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)', color: '#60a5fa' }}>
                <Sparkles size={12} /> Document Intelligence / RAG
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ fontSize: 'clamp(40px, 5.5vw, 68px)', fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.04em', marginBottom: 4 }}
            >
              Your Documents,
            </motion.h1>
            {/* The gradient lives on an unanimated child: browsers drop
                background-clip:text paint while the animating parent is on its
                own compositing layer, which made this line invisible. */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ marginBottom: 20 }}
            >
              <h1
                className="blue-gradient-text"
                style={{ fontSize: 'clamp(40px, 5.5vw, 68px)', fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.04em', margin: 0 }}
              >
                Understood.
              </h1>
            </motion.div>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{ fontSize: 17, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, maxWidth: 480, marginBottom: 28 }}
            >
              Ask questions about your PDFs and get answers grounded in the knowledge inside your documents.
            </motion.p>

            {/* Interactive Dropzone Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={openPicker}
              style={{
                borderRadius: 24,
                padding: 'clamp(18px, 3vw, 24px)',
                background: dragActive ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.03)',
                border: dragActive ? '2px dashed #3b82f6' : '1px dashed rgba(255,255,255,0.18)',
                boxShadow: dragActive ? '0 0 40px rgba(37,99,235,0.3)' : '0 8px 32px rgba(0,0,0,0.3)',
                cursor: upload.status === 'uploading' ? 'wait' : 'pointer',
                transition: 'all 0.3s ease',
                marginBottom: 28,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: upload.status === 'done' ? 'rgba(34,197,94,0.15)' : 'rgba(37,99,235,0.15)',
                  border: upload.status === 'done' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(37,99,235,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {upload.status === 'uploading' ? (
                    <div className="spin" style={{ width: 22, height: 22, border: '2.5px solid rgba(255,255,255,0.2)', borderTopColor: '#3b82f6', borderRadius: '50%' }} />
                  ) : upload.status === 'done' ? (
                    <CheckCircle2 size={24} color="#4ade80" />
                  ) : (
                    <Upload size={24} color="#60a5fa" />
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {upload.status === 'uploading' ? (
                      `Indexing ${upload.fileName}...`
                    ) : upload.status === 'done' ? (
                      'Document Uploaded Successfully!'
                    ) : (
                      <>Drop your PDF here or click to browse</>
                    )}
                  </div>

                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
                    {upload.status === 'uploading' ? (
                      'Extracting text & generating 384D vector embeddings...'
                    ) : upload.status === 'done' ? (
                      'Redirecting to chat interface...'
                    ) : (
                      'Supports research papers, technical specs, manuals & reports'
                    )}
                  </p>

                  {/* Progress Bar */}
                  {upload.status === 'uploading' && (
                    <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: '0%' }}
                        animate={{ width: `${upload.progress}%` }}
                        transition={{ duration: 0.3 }}
                        style={{ height: '100%', background: 'linear-gradient(90deg, #3b82f6, #818cf8)' }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Error display */}
            <AnimatePresence>
              {upload.status === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 20
                  }}
                >
                  <AlertCircle size={16} /> {upload.error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action Row */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 28 }}
            >
              <button
                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                className="outline-btn"
                style={{ padding: '12px 24px', borderRadius: '12px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                ▶ Explore Interactive Demo
              </button>
            </motion.div>

            {/* Trust badges */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {['PDF Ingestion', 'RAG Retrieval', 'Grounded Answers'].map((label, i) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>{label}</span>
                    {i < 2 && <ArrowRight size={12} color="rgba(255,255,255,0.3)" />}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {['Context-aware', 'Source-backed', 'Document-focused'].map((label) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                    <CheckCircle2 size={14} color="#3b82f6" /> {label}
                  </span>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* Right column — 3D mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{ flex: '1 1 480px', position: 'relative', display: 'flex', justifyContent: 'center' }}
          >
            <AppMockup />
          </motion.div>
        </div>
      </div>

      {/* ── YOUR DOCUMENTS & CHATS ──────────────────────────────────── */}
      <SavedWorkspace
        documents={documents}
        conversations={conversations}
        slots={slots}
        busyDocId={busyDocId}
        onOpen={openSavedChat}
        onDelete={removeSavedDoc}
      />

      {/* ── TRUSTED BY ──────────────────────────────────────────────── */}
      <Section style={{ padding: '60px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <p style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 40 }}>
            Trusted by learners, researchers and builders
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 32, alignItems: 'center' }}>
            {audience.map(({ icon, title, desc }) => (
              <div key={title} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                {icon}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{desc}</div>
                </div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 32 }}>
              <p style={{ fontStyle: 'italic', fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 1.55, maxWidth: 360, marginLeft: 'auto' }}>
                &ldquo;DocMind AI turns static documents into an interactive knowledge base.&rdquo;
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>— A smarter way to read</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────── */}
      <Section id="how-it-works">
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3b82f6', textTransform: 'uppercase', marginBottom: 12 }}>Process</p>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, letterSpacing: '-0.03em' }}>How DocMind Works</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {steps.map(({ icon, step, title, desc }, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{ padding: 'clamp(24px, 4vw, 32px)', borderRadius: 24, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ position: 'absolute', top: 16, right: 20, fontSize: 48, fontWeight: 900, color: 'rgba(255,255,255,0.03)', lineHeight: 1 }}>{step}</div>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  {icon}
                </div>
                <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{title}</h3>
                <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, fontSize: 14 }}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <Section id="features" style={{ background: 'rgba(255,255,255,0.01)', padding: '100px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3b82f6', textTransform: 'uppercase', marginBottom: 12 }}>Capabilities</p>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, letterSpacing: '-0.03em' }}>Built for Precision</h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginTop: 14, maxWidth: 480, margin: '14px auto 0' }}>Every feature designed for accurate, fast document intelligence</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {features.map(({ icon, title, desc }, i) => (
              <motion.div
                key={title}
                className="feature-card glass"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                whileHover={{ y: -6, boxShadow: '0 20px 60px rgba(37,99,235,0.12)' }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  {icon}
                </div>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{title}</h3>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.65 }}>{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── TECHNOLOGY ─────────────────────────────────────────────── */}
      <Section id="technology">
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3b82f6', textTransform: 'uppercase', marginBottom: 12 }}>Stack</p>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em' }}>Powered by Modern AI</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
            {techStack.map(({ name, color }, i) => (
              <motion.div
                key={name}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ scale: 1.08, y: -3 }}
                style={{ padding: '10px 22px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}30`, color: color, fontSize: 13, fontWeight: 600, cursor: 'default', boxShadow: `0 0 20px ${color}10` }}
              >
                {name}
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── CTA BANNER ─────────────────────────────────────────────── */}
      <Section id="demo" style={{ padding: '80px 24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center', padding: '64px 48px', borderRadius: 28, background: 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(124,58,237,0.06))', border: '1px solid rgba(37,99,235,0.18)', position: 'relative', overflow: 'hidden' }}
        >
          <div className="glow-orb" style={{ width: 300, height: 300, background: 'radial-gradient(circle, rgba(37,99,235,0.2) 0%, transparent 70%)', top: -50, left: -50 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: '#3b82f6', textTransform: 'uppercase', marginBottom: 16 }}>Get Started Free</p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 16 }}>Try DocMind AI</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 36, lineHeight: 1.6 }}>
            Private, fast and accurate. Upload your first document and experience document intelligence with cited answers.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={openPicker} className="glow-btn" style={{ padding: '14px 32px', borderRadius: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload size={16} /> Upload a PDF
            </button>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="outline-btn" style={{ padding: '14px 32px', borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.8)' }}>
              View on GitHub <ChevronRight size={16} />
            </a>
          </div>
        </motion.div>
      </Section>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={14} color="white" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>DocMind AI</span>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>© 2024 DocMind AI · Built with Next.js + FastAPI + LangChain</p>
          <div style={{ display: 'flex', gap: 20 }}>
            {['Privacy', 'Terms', 'GitHub'].map((link) => (
              <a key={link} href="#" style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textDecoration: 'none', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
