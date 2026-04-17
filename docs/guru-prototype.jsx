import { useState, useEffect, useRef } from "react";

const PAGES = {
  LANDING: "landing",
  AUTH: "auth",
  CHAT: "chat",
  HISTORY: "history",
  SETTINGS: "settings",
  BILLING: "billing",
};

const tokens = {
  bg: { deep: "#0a0a0f", surface: "#111118", raised: "#1a1a24", overlay: "#22222e", hover: "#2a2a38" },
  text: { primary: "#d4cfc4", secondary: "#8a8578", muted: "#5a5650", accent: "#c4a35a", link: "#7a9ec2" },
  border: { subtle: "#2a2a34", medium: "#3a3a48", accent: "#c4a35a33" },
  tradition: { gnosticism: "#c2785a", kabbalah: "#7a7ac2", hermeticism: "#c4a35a", neoplatonism: "#5a8ac2", vedanta: "#c25a7a", buddhism: "#5ac27a", mysticism: "#a05ac2", sufism: "#5ac2a0", taoism: "#7ac27a" },
  tier: { verified: "#c4a35a", proposed: "#7a9ec2", inferred: "#5a5650" },
};

function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setMobile(mq.matches);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

function NavBar({ page, setPage, user }) {
  const mobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { id: PAGES.CHAT, label: "Query" },
    { id: PAGES.HISTORY, label: "Sessions" },
    { id: PAGES.SETTINGS, label: "Scope" },
    { id: PAGES.BILLING, label: "Account" },
  ];

  return (
    <nav style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: mobile ? "10px 16px" : "12px 24px",
      borderBottom: `1px solid ${tokens.border.subtle}`,
      background: tokens.bg.surface, position: "sticky", top: 0, zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: mobile ? 10 : 20 }}>
        <button onClick={() => setPage(PAGES.CHAT)} style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 18 : 22, fontWeight: 600, color: tokens.text.accent, letterSpacing: 3 }}>GURU</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, border: `1px solid ${tokens.border.subtle}`, padding: "2px 5px", borderRadius: 2 }}>v2</span>
        </button>
        {!mobile && (
          <div style={{ display: "flex", gap: 4 }}>
            {navItems.map(item => (
              <button key={item.id} onClick={() => setPage(item.id)} style={{
                background: page === item.id ? tokens.bg.raised : "none",
                border: page === item.id ? `1px solid ${tokens.border.subtle}` : "1px solid transparent",
                color: page === item.id ? tokens.text.primary : tokens.text.secondary,
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, padding: "6px 12px", borderRadius: 3, cursor: "pointer",
              }}>{item.label}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, padding: "3px 7px",
          background: user?.tier === "pro" ? `${tokens.text.accent}15` : tokens.bg.raised,
          border: `1px solid ${user?.tier === "pro" ? tokens.border.accent : tokens.border.subtle}`,
          borderRadius: 2, textTransform: "uppercase", letterSpacing: 1,
        }}>{user?.tier || "free"}</span>
        {mobile ? (
          <button onClick={() => setMenuOpen(!menuOpen)} style={{
            background: "none", border: "none", cursor: "pointer", color: tokens.text.secondary,
            fontSize: 20, padding: "4px 2px", lineHeight: 1, fontFamily: "'IBM Plex Mono', monospace",
          }}>{menuOpen ? "✕" : "≡"}</button>
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: `linear-gradient(135deg, ${tokens.tradition.hermeticism}, ${tokens.tradition.gnosticism})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: tokens.bg.deep, fontWeight: 700,
          }}>{user?.initials || "?"}</div>
        )}
      </div>
      {mobile && menuOpen && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: tokens.bg.surface, borderBottom: `1px solid ${tokens.border.subtle}`, zIndex: 99 }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setPage(item.id); setMenuOpen(false); }} style={{
              display: "block", width: "100%", textAlign: "left", padding: "14px 20px",
              background: page === item.id ? tokens.bg.raised : "none", border: "none",
              borderBottom: `1px solid ${tokens.border.subtle}`,
              color: page === item.id ? tokens.text.accent : tokens.text.secondary,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, cursor: "pointer", letterSpacing: 1,
            }}>{item.label}</button>
          ))}
        </div>
      )}
    </nav>
  );
}

function Citation({ tradition, text, section, quote, tier }) {
  const mobile = useIsMobile();
  const color = tokens.tradition[tradition?.toLowerCase()] || tokens.text.secondary;
  const tierSymbol = tier === "verified" ? "◆" : tier === "proposed" ? "◇" : "○";
  const tierColor = tokens.tier[tier] || tokens.tier.inferred;
  return (
    <div style={{ borderLeft: `2px solid ${color}`, padding: mobile ? "6px 10px" : "8px 12px", margin: "6px 0", background: `${color}08` }}>
      <div style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: mobile ? 9 : 10, color: tokens.text.muted,
        marginBottom: 4, display: "flex", alignItems: "center", gap: mobile ? 4 : 6, flexWrap: "wrap",
      }}>
        <span style={{ color: tierColor }}>{tierSymbol}</span>
        <span style={{ color }}>{tradition}</span>
        <span style={{ opacity: 0.4 }}>|</span><span>{text}</span>
        <span style={{ opacity: 0.4 }}>|</span><span>{section}</span>
      </div>
      {quote && (
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 13 : 14, color: tokens.text.primary, fontStyle: "italic", lineHeight: 1.5 }}>"{quote}"</div>
      )}
    </div>
  );
}

function LandingPage({ setPage }) {
  const mobile = useIsMobile();
  return (
    <div style={{
      minHeight: "100vh", background: tokens.bg.deep, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden",
      padding: mobile ? "40px 20px" : "60px 24px",
    }}>
      <div style={{
        position: "absolute", width: mobile ? 300 : 600, height: mobile ? 300 : 600, borderRadius: "50%", top: "30%", left: "50%",
        transform: "translate(-50%, -50%)", background: `radial-gradient(circle, ${tokens.text.accent}08 0%, transparent 70%)`, filter: "blur(60px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", inset: 0, opacity: 0.03,
        backgroundImage: `linear-gradient(0deg, ${tokens.text.primary} 1px, transparent 1px), linear-gradient(90deg, ${tokens.text.primary} 1px, transparent 1px)`,
        backgroundSize: mobile ? "40px 40px" : "80px 80px",
      }} />
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, width: "100%", maxWidth: 560 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 48 : 72, fontWeight: 300, color: tokens.text.accent, letterSpacing: mobile ? 10 : 16, marginBottom: 8 }}>GURU</div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: mobile ? 9 : 11, color: tokens.text.muted, letterSpacing: mobile ? 2 : 4, marginBottom: mobile ? 32 : 48, textTransform: "uppercase" }}>Cross-Tradition Esoteric Analysis</div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: mobile ? 4 : 6, marginBottom: mobile ? 32 : 48 }}>
          {Object.keys(tokens.tradition).map(t => (
            <span key={t} style={{
              fontFamily: "'IBM Plex Mono', monospace", fontSize: mobile ? 8 : 9, color: tokens.tradition[t],
              padding: mobile ? "2px 5px" : "3px 8px", border: `1px solid ${tokens.tradition[t]}33`, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1,
            }}>{t}</span>
          ))}
        </div>
        <p style={{
          fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 15 : 18, color: tokens.text.secondary,
          maxWidth: 480, margin: "0 auto", marginBottom: mobile ? 28 : 40, lineHeight: 1.7, fontStyle: "italic", padding: mobile ? "0 8px" : 0,
        }}>
          Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot, Neoplatonic emanations, and Vedantic consciousness — traced to their sources, every claim cited.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexDirection: mobile ? "column" : "row", padding: mobile ? "0 24px" : 0 }}>
          <button onClick={() => setPage(PAGES.AUTH)} style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: mobile ? "14px 32px" : "12px 32px",
            background: tokens.text.accent, color: tokens.bg.deep, border: "none", borderRadius: 2, cursor: "pointer", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase",
          }}>Begin</button>
          <button style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: mobile ? "14px 32px" : "12px 32px",
            background: "none", color: tokens.text.secondary, border: `1px solid ${tokens.border.medium}`, borderRadius: 2, cursor: "pointer", letterSpacing: 1,
          }}>Learn More</button>
        </div>
        <div style={{ marginTop: mobile ? 40 : 64, background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20, textAlign: "left" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, marginBottom: 10, letterSpacing: 1 }}>SAMPLE QUERY</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 14 : 15, color: tokens.text.primary, marginBottom: 14, lineHeight: 1.6 }}>
            "How does the concept of divine spark appear across traditions?"
          </div>
          <Citation tradition="Gnosticism" text="Gospel of Thomas" section="Logion 77" quote="I am the light that is over all things." tier="verified" />
          <Citation tradition="Vedanta" text="Chandogya Upanishad" section="6.8.7" tier="verified" />
          <Citation tradition="Hermeticism" text="Corpus Hermeticum" section="Tractate I.6" tier="proposed" />
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, marginTop: 10, display: "flex", gap: mobile ? 10 : 16, flexWrap: "wrap" }}>
            <span>◆ 4 verified</span><span>◇ 2 proposed</span><span>5 traditions</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthPage({ setPage, setUser }) {
  const mobile = useIsMobile();
  const [mode, setMode] = useState("signin");
  const handleAuth = () => { setUser({ initials: "IV", tier: "free", email: "user@example.com" }); setPage(PAGES.CHAT); };
  return (
    <div style={{ minHeight: "100vh", background: tokens.bg.deep, display: "flex", alignItems: "center", justifyContent: "center", padding: mobile ? "24px 16px" : 24 }}>
      <div style={{ width: "100%", maxWidth: 380, background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 24 : 32 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: tokens.text.accent, letterSpacing: 6, textAlign: "center", marginBottom: 4 }}>GURU</div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, textAlign: "center", letterSpacing: 2, marginBottom: 24, textTransform: "uppercase" }}>{mode === "signin" ? "Sign In" : "Create Account"}</div>
        {["Continue with Google", "Continue with GitHub"].map(label => (
          <button key={label} onClick={handleAuth} style={{ width: "100%", padding: "12px 16px", background: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`, borderRadius: 3, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: tokens.text.primary, marginBottom: 8 }}>{label}</button>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: tokens.border.subtle }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, letterSpacing: 2 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: tokens.border.subtle }} />
        </div>
        <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, display: "block", marginBottom: 4, letterSpacing: 1 }}>EMAIL</label>
        <input type="email" placeholder="scholar@example.com" style={{ width: "100%", padding: "12px", background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`, borderRadius: 3, color: tokens.text.primary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, marginBottom: 16, outline: "none", boxSizing: "border-box", WebkitAppearance: "none" }} />
        {mode === "signup" && (
          <><label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, display: "block", marginBottom: 4, letterSpacing: 1 }}>PASSWORD</label>
          <input type="password" style={{ width: "100%", padding: "12px", background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`, borderRadius: 3, color: tokens.text.primary, fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, marginBottom: 16, outline: "none", boxSizing: "border-box", WebkitAppearance: "none" }} /></>
        )}
        <button onClick={handleAuth} style={{ width: "100%", padding: "13px 16px", background: tokens.text.accent, border: "none", borderRadius: 3, color: tokens.bg.deep, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>{mode === "signin" ? "Sign In" : "Create Account"}</button>
        <div style={{ textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: tokens.text.muted }}>
          {mode === "signin" ? "New to Guru? " : "Already have an account? "}
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} style={{ background: "none", border: "none", color: tokens.text.link, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", padding: "4px 2px" }}>{mode === "signin" ? "Create account" : "Sign in"}</button>
        </div>
      </div>
    </div>
  );
}

function ChatPage() {
  const mobile = useIsMobile();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const sampleResponse = {
    text: `The concept of a divine spark — a fragment of transcendent light or consciousness embedded within the human being — appears across multiple esoteric traditions with striking structural parallels.

In the Gnostic framework, the divine spark is a pneumatic seed trapped in material existence by the Demiurge. Liberation requires gnosis — direct experiential knowledge that awakens the spark to its true origin in the Pleroma.

The Vedantic tradition frames this through Atman. The individual self is ontologically identical with Brahman. The barrier is maya — the veil of illusion.

Hermetic thought bridges these. The Poimandres describes the human nous as a luminous fragment of the divine Mind that descended into matter through its own desire.`,
    citations: [
      { tradition: "Gnosticism", text: "Gospel of Thomas", section: "Logion 77", quote: "I am the light that is over all things.", tier: "verified" },
      { tradition: "Gnosticism", text: "Apocryphon of John", section: "Section 4", tier: "verified" },
      { tradition: "Vedanta", text: "Chandogya Upanishad", section: "6.8.7", quote: "Tat tvam asi — thou art that.", tier: "verified" },
      { tradition: "Hermeticism", text: "Corpus Hermeticum", section: "Tractate I.6", tier: "proposed" },
      { tradition: "Kabbalah", text: "Zohar", section: "1:15a", tier: "proposed" },
    ],
    meta: { chunks: 12, traditions: 5, verified: 3, proposed: 2 },
  };
  const handleSend = () => { if (!input.trim()) return; setMessages(prev => [...prev, { role: "user", content: input }]); setInput(""); setLoading(true); setTimeout(() => { setMessages(prev => [...prev, { role: "assistant", ...sampleResponse }]); setLoading(false); }, 2000); };
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 53px)", background: tokens.bg.deep }}>
      <div style={{ flex: 1, overflowY: "auto", padding: mobile ? "16px 0" : "24px 0", WebkitOverflowScrolling: "touch" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.6, padding: mobile ? "0 16px" : 0 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 24 : 32, color: tokens.text.accent, letterSpacing: 8, marginBottom: 12 }}>GURU</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: mobile ? 10 : 11, color: tokens.text.muted, maxWidth: 400, textAlign: "center", lineHeight: 1.8, marginBottom: 20, padding: "0 12px" }}>
              Ask about concepts across traditions. Every claim is traced to its source.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 460, padding: mobile ? "0 8px" : 0 }}>
              {["How does emanation differ between Plotinus and the Zohar?", "What traditions describe ego death as prerequisite for awakening?", "Compare apophatic theology across Christian and Buddhist thought"].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{
                  background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 3,
                  padding: mobile ? "12px 14px" : "10px 14px", fontFamily: "'Cormorant Garamond', serif",
                  fontSize: mobile ? 14 : 13, color: tokens.text.secondary, cursor: "pointer", textAlign: "left", width: "100%",
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ maxWidth: 680, margin: "0 auto", padding: mobile ? "0 14px" : "0 24px", marginBottom: mobile ? 18 : 24 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: msg.role === "user" ? tokens.text.accent : tokens.text.muted, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>{msg.role === "user" ? "You" : "Guru"}</div>
            {msg.role === "user" ? (
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 15 : 16, color: tokens.text.primary, lineHeight: 1.6, padding: mobile ? "10px 12px" : "12px 16px", background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4 }}>{msg.content}</div>
            ) : (
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 14 : 15, color: tokens.text.primary, lineHeight: 1.7, marginBottom: 14, whiteSpace: "pre-wrap" }}>{msg.text}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>References</div>
                {msg.citations?.map((c, j) => <Citation key={j} {...c} />)}
                <div style={{ display: "flex", gap: mobile ? 10 : 16, marginTop: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, padding: "8px 0", borderTop: `1px solid ${tokens.border.subtle}`, flexWrap: "wrap" }}>
                  <span>◆ {msg.meta?.verified}</span><span>◇ {msg.meta?.proposed}</span><span>{msg.meta?.traditions} traditions</span><span>{msg.meta?.chunks} chunks</span>
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ maxWidth: 680, margin: "0 auto", padding: mobile ? "0 14px" : "0 24px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 8 }}>GURU</div>
            <div style={{ display: "flex", gap: 4, padding: "14px 0" }}>
              {[0, 1, 2].map(i => (<div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: tokens.text.accent, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`, opacity: 0.4 }} />))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: mobile ? "12px 12px max(12px, env(safe-area-inset-bottom))" : "16px 24px", borderTop: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Ask across traditions..." style={{
              flex: 1, padding: mobile ? "13px 12px" : "12px 16px", background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 3, color: tokens.text.primary, fontFamily: "'Cormorant Garamond', serif", fontSize: 16, outline: "none", WebkitAppearance: "none", minWidth: 0,
            }} />
          <button onClick={handleSend} style={{
            padding: mobile ? "13px 16px" : "12px 20px", background: input.trim() ? tokens.text.accent : tokens.bg.raised,
            border: "none", borderRadius: 3, color: input.trim() ? tokens.bg.deep : tokens.text.muted, fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, cursor: input.trim() ? "pointer" : "default", fontWeight: 600, letterSpacing: 1, flexShrink: 0,
          }}>QUERY</button>
        </div>
        <div style={{ maxWidth: 680, margin: "5px auto 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, display: "flex", gap: mobile ? 8 : 16, flexWrap: "wrap" }}>
          <span>8 traditions</span><span>34 texts</span><span>Free · 27/30 today</span>
        </div>
      </div>
    </div>
  );
}

function HistoryPage() {
  const mobile = useIsMobile();
  const sessions = [
    { id: 1, title: "Divine spark across traditions", queries: 4, date: "Apr 15", traditions: ["Gnosticism", "Vedanta", "Hermeticism"] },
    { id: 2, title: "Emanation hierarchies: Plotinus vs Zohar", queries: 7, date: "Apr 14", traditions: ["Neoplatonism", "Kabbalah"] },
    { id: 3, title: "Apophatic theology comparison", queries: 3, date: "Apr 12", traditions: ["Mysticism", "Buddhism"] },
    { id: 4, title: "Ego death as soteriological prerequisite", queries: 5, date: "Apr 10", traditions: ["Buddhism", "Sufism", "Gnosticism"] },
    { id: 5, title: "Sacred sound and mantra", queries: 2, date: "Apr 8", traditions: ["Vedanta", "Sufism", "Kabbalah"] },
  ];
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: mobile ? "16px 14px" : 24 }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 16, textTransform: "uppercase" }}>Session History</div>
      {sessions.map(s => (
        <button key={s.id} style={{ width: "100%", display: "block", background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 12 : 16, marginBottom: 6, cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 14 : 16, color: tokens.text.primary, marginBottom: 6 }}>{s.title}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {s.traditions.map(t => {
                  const color = tokens.tradition[t.toLowerCase()] || tokens.text.secondary;
                  return <span key={t} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color, letterSpacing: 1, padding: "2px 5px", border: `1px solid ${color}33`, borderRadius: 2 }}>{t}</span>;
                })}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted }}>{s.date}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, marginTop: 2 }}>{s.queries}q</div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SettingsPage() {
  const mobile = useIsMobile();
  const [traditions, setTraditions] = useState({
    Gnosticism: { active: true, texts: { "Gospel of Thomas": true, "Gospel of Philip": true, "Apocryphon of John": true, "Trimorphic Protennoia": false, "On the Origin of the World": true }},
    Kabbalah: { active: true, texts: { "Sefer Yetzirah": true, "Zohar": true, "Bahir": true }},
    Hermeticism: { active: true, texts: { "Corpus Hermeticum": true, "Emerald Tablet": true, "Asclepius": true }},
    Neoplatonism: { active: false, texts: { "Enneads": false, "Elements of Theology": false }},
    Vedanta: { active: true, texts: { "Mandukya Upanishad": true, "Chandogya Upanishad": true, "Brihadaranyaka Upanishad": true }},
    Buddhism: { active: true, texts: { "Heart Sutra": true, "Diamond Sutra": true, "Dhammapada": true }},
    Mysticism: { active: true, texts: { "Eckhart Sermons": true, "Cloud of Unknowing": true, "Divine Names": true }},
    Sufism: { active: true, texts: { "Fusus al-Hikam": true, "Masnavi": true }},
    Taoism: { active: true, texts: { "Tao Te Ching": true, "Chuang Tzu": true }},
  });
  const [expanded, setExpanded] = useState(null);
  const totalTexts = Object.values(traditions).flatMap(t => Object.values(t.texts)).length;
  const activeTexts = Object.values(traditions).flatMap(t => t.active ? Object.values(t.texts).filter(Boolean) : []).length;
  const activeTraditions = Object.values(traditions).filter(t => t.active).length;
  const toggleTradition = (name) => setTraditions(prev => ({ ...prev, [name]: { ...prev[name], active: !prev[name].active, texts: Object.fromEntries(Object.keys(prev[name].texts).map(t => [t, !prev[name].active])) }}));
  const toggleText = (tradition, text) => setTraditions(prev => { const nt = { ...prev[tradition].texts, [text]: !prev[tradition].texts[text] }; return { ...prev, [tradition]: { ...prev[tradition], texts: nt, active: Object.values(nt).some(Boolean) }}; });

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: mobile ? "16px 14px" : 24 }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Corpus Scope</div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: tokens.text.secondary, marginBottom: 20 }}>
        {activeTexts}/{totalTexts} texts · {activeTraditions}/{Object.keys(traditions).length} traditions
      </div>
      {Object.entries(traditions).map(([name, data]) => {
        const color = tokens.tradition[name.toLowerCase()] || tokens.text.secondary;
        const isExpanded = expanded === name;
        return (
          <div key={name} style={{ background: tokens.bg.surface, border: `1px solid ${data.active ? color + "33" : tokens.border.subtle}`, borderRadius: 4, marginBottom: 5, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: mobile ? "12px 12px" : "10px 14px", cursor: "pointer", gap: 10, minHeight: mobile ? 48 : "auto" }}
              onClick={() => setExpanded(isExpanded ? null : name)}>
              <div onClick={e => { e.stopPropagation(); toggleTradition(name); }} style={{
                width: mobile ? 22 : 16, height: mobile ? 22 : 16, borderRadius: 2,
                border: `1.5px solid ${data.active ? color : tokens.border.medium}`,
                background: data.active ? color + "22" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
              }}>{data.active && <span style={{ color, fontSize: mobile ? 14 : 11, lineHeight: 1 }}>✓</span>}</div>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: mobile ? 16 : 15, color: data.active ? tokens.text.primary : tokens.text.muted, flex: 1 }}>{name}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted }}>{Object.values(data.texts).filter(Boolean).length}/{Object.keys(data.texts).length}</span>
              <span style={{ color: tokens.text.muted, fontSize: 10, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>
            </div>
            {isExpanded && (
              <div style={{ padding: mobile ? "0 12px 10px 46px" : "0 14px 10px 42px", borderTop: `1px solid ${tokens.border.subtle}` }}>
                {Object.entries(data.texts).map(([text, active]) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: 8, padding: mobile ? "8px 0" : "5px 0", cursor: "pointer", minHeight: mobile ? 40 : "auto" }}
                    onClick={() => toggleText(name, text)}>
                    <div style={{
                      width: mobile ? 20 : 13, height: mobile ? 20 : 13, borderRadius: 2,
                      border: `1.5px solid ${active ? color + "88" : tokens.border.medium}`,
                      background: active ? color + "15" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>{active && <span style={{ color: color + "aa", fontSize: mobile ? 12 : 9, lineHeight: 1 }}>✓</span>}</div>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: mobile ? 13 : 12, color: active ? tokens.text.secondary : tokens.text.muted }}>{text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, padding: mobile ? "12px 20px" : "8px 16px", background: tokens.text.accent, color: tokens.bg.deep, border: "none", borderRadius: 2, cursor: "pointer", fontWeight: 600 }}>Save</button>
        <button style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, padding: mobile ? "12px 20px" : "8px 16px", background: "none", color: tokens.text.muted, border: `1px solid ${tokens.border.subtle}`, borderRadius: 2, cursor: "pointer" }}>Reset to All</button>
      </div>
    </div>
  );
}

function BillingPage({ user }) {
  const mobile = useIsMobile();
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: mobile ? "16px 14px" : 24 }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 18, textTransform: "uppercase" }}>Account</div>
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20, marginBottom: 12 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Current Plan</div>
        <div style={{ display: "flex", gap: 10, flexDirection: mobile ? "column" : "row" }}>
          {[{ id: "free", name: "Free", price: null, features: ["30 queries/day", "All traditions", "Standard model"] },
            { id: "pro", name: "Pro", price: "$12/mo", features: ["Unlimited queries", "Premium model", "Citation export", "Priority retrieval"] }].map(plan => (
            <div key={plan.id} style={{ flex: 1, padding: mobile ? 14 : 16, background: user?.tier === plan.id ? `${tokens.text.accent}08` : tokens.bg.raised, border: `1px solid ${user?.tier === plan.id ? tokens.border.accent : tokens.border.subtle}`, borderRadius: 4 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: tokens.text.primary, marginBottom: 4, display: "flex", alignItems: "baseline", gap: 8 }}>
                {plan.name}{plan.price && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: tokens.text.accent }}>{plan.price}</span>}
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: tokens.text.muted, lineHeight: 1.8 }}>{plan.features.map((f, i) => <div key={i}>{f}</div>)}</div>
              {user?.tier === plan.id ? <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.accent, marginTop: 8, letterSpacing: 1 }}>CURRENT</div>
                : plan.id === "pro" && <button style={{ marginTop: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: mobile ? "10px 14px" : "6px 14px", background: tokens.text.accent, color: tokens.bg.deep, border: "none", borderRadius: 2, cursor: "pointer", fontWeight: 600, letterSpacing: 1 }}>UPGRADE</button>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20, marginBottom: 12 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Usage Today</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: tokens.text.secondary }}>Queries</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: tokens.text.primary }}>3 / 30</span>
        </div>
        <div style={{ height: 3, background: tokens.bg.raised, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: "10%", height: "100%", background: tokens.text.accent, borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Account Details</div>
        {[{ label: "Email", value: user?.email || "user@example.com" }, { label: "Member since", value: "April 2026" }, { label: "Total queries", value: "147" }, { label: "Sessions", value: "23" }].map(row => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: mobile ? "8px 0" : "6px 0", borderBottom: `1px solid ${tokens.border.subtle}` }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: tokens.text.muted }}>{row.label}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: tokens.text.secondary }}>{row.value}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexDirection: mobile ? "column" : "row" }}>
          <button style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: mobile ? "12px 14px" : "6px 14px", background: "none", color: tokens.text.link, border: `1px solid ${tokens.border.subtle}`, borderRadius: 2, cursor: "pointer", width: mobile ? "100%" : "auto" }}>Manage in Clerk</button>
          <button style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, padding: mobile ? "12px 14px" : "6px 14px", background: "none", color: "#c25a5a", border: "1px solid #c25a5a33", borderRadius: 2, cursor: "pointer", width: mobile ? "100%" : "auto" }}>Delete Account</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(PAGES.LANDING);
  const [user, setUser] = useState(null);
  const authedPages = [PAGES.CHAT, PAGES.HISTORY, PAGES.SETTINGS, PAGES.BILLING];
  const isAuthed = authedPages.includes(page);
  return (
    <div style={{ background: tokens.bg.deep, minHeight: "100vh", color: tokens.text.primary }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html { -webkit-text-size-adjust: 100%; }
        body { background: ${tokens.bg.deep}; overscroll-behavior: none; }
        ::selection { background: ${tokens.text.accent}44; color: ${tokens.text.primary}; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${tokens.border.subtle}; border-radius: 3px; }
        input::placeholder { color: ${tokens.text.muted}; }
        button:active { transform: scale(0.98); }
        @keyframes pulse { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 0.6; transform: scale(1.1); } }
        @media (max-width: 640px) { ::-webkit-scrollbar { display: none; } }
      `}</style>
      {isAuthed && <NavBar page={page} setPage={setPage} user={user} />}
      {page === PAGES.LANDING && <LandingPage setPage={setPage} />}
      {page === PAGES.AUTH && <AuthPage setPage={setPage} setUser={setUser} />}
      {page === PAGES.CHAT && <ChatPage />}
      {page === PAGES.HISTORY && <HistoryPage />}
      {page === PAGES.SETTINGS && <SettingsPage />}
      {page === PAGES.BILLING && <BillingPage user={user} />}
    </div>
  );
}
