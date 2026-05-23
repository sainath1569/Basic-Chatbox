import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return ""; }
}

function formatDate(isoStr) {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const today = new Date();
    const yest  = new Date(today); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString())  return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function getDayName(isoStr) {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yest = new Date(today); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long" });
  } catch { return ""; }
}

function getRelativeTime(isoStr) {
  try {
    const d     = new Date(isoStr);
    const diffMs = Date.now() - d.getTime();
    const mins   = Math.floor(diffMs / 60000);
    const hours  = Math.floor(diffMs / 3600000);
    const days   = Math.floor(diffMs / 86400000);
    if (mins  < 1)  return "Just now";
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  < 7)  return `${days}d ago`;
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  } catch { return ""; }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getFileStyle(name, mime) {
  const fn = (name || "").toLowerCase(), t = (mime || "").toLowerCase();
  if (t === "application/pdf" || fn.endsWith(".pdf"))
    return { cls: "file-pdf",   icon: "📕" };
  if (t.includes("spreadsheet") || t.includes("excel") || fn.endsWith(".xls") || fn.endsWith(".xlsx"))
    return { cls: "file-excel", icon: "📊" };
  if (t.includes("word") || t.includes("document") || fn.endsWith(".doc") || fn.endsWith(".docx"))
    return { cls: "file-word",  icon: "📄" };
  return { cls: "file-general", icon: "📁" };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); }
    catch (e) { console.warn("SW registration failed:", e); }
  }
}

function fireNotification(sender, text, roomId, roomName) {
  if (Notification.permission !== "granted" || !document.hidden) return;
  const body = text.length > 80 ? text.substring(0, 77) + "…" : text;
  try {
    const n = new Notification(`${sender} · ${roomName}`, {
      body, icon: "/favicon.ico",
      tag: `room-${roomId}`,
      data: { roomId },
    });
    n.addEventListener("click", () => { window.focus(); n.close(); });
  } catch (e) { console.error("Notification error:", e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CREATE CHAT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function CreateChatModal({ onClose, onCreate }) {
  const [name, setName]       = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef              = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed)          { setError("Please enter a chat name."); return; }
    if (trimmed.length > 60) { setError("Max 60 characters."); return; }
    setLoading(true); setError("");
    try   { await onCreate(trimmed); }
    catch (err) { setError(err.message || "Failed to create chat."); setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target.classList.contains("modal-overlay") && onClose()} onKeyDown={handleKeyDown}>
      <div className="create-chat-modal fade-in" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>✨ Start New Chat</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit} className="modal-form">
          <div className="form-group">
            <label htmlFor="new-chat-name-input">Chat Name</label>
            <div className="input-wrapper">
              <span className="input-icon">💬</span>
              <input
                ref={inputRef} id="new-chat-name-input" type="text"
                value={name} onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="e.g. Weekend Plans, Study Group…"
                maxLength={60} className={error ? "input-error" : ""}
              />
            </div>
            {error && <span className="error-text">{error}</span>}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" id="create-chat-submit-btn" disabled={loading}>
              {loading ? "Creating…" : "Create Chat"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHAT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function ChatCard({ room, isPinned, onPin, onClick }) {
  const dayLabel      = getDayName(room.createdAt);
  const dateLabel     = formatDate(room.createdAt);
  const activityLabel = room.lastActivityAt ? getRelativeTime(room.lastActivityAt) : null;

  return (
    <article className="chat-card" onClick={onClick} tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}>
      <div className="chat-card-icon">{room.type === "daily" ? "📅" : "💬"}</div>
      <div className="chat-card-info">
        <div className="chat-card-name">{room.chatName}</div>
        <div className="chat-card-meta">
          <span className="meta-pill day-pill">{dayLabel}</span>
          <span className="meta-sep">·</span>
          <span className="meta-pill">{dateLabel}</span>
          {activityLabel && (
            <><span className="meta-sep">·</span>
              <span className="meta-pill activity-pill">🕐 {activityLabel}</span></>
          )}
        </div>
      </div>
      <div className="chat-card-badges">
        {room.type === "daily" && <span className="daily-badge">Daily</span>}
        <button
          className={`pin-btn ${isPinned ? "pin-btn-active" : ""}`}
          onClick={(e) => { e.stopPropagation(); onPin(room.id); }}
          title={isPinned ? "Unpin" : "Pin chat"} aria-label={isPinned ? "Unpin" : "Pin chat"}
        >📌</button>
      </div>
    </article>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LANDING PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function LandingPage({ onLogin }) {
  const [name, setName]   = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const t = name.trim();
    if (!t)          { setError("Username cannot be empty."); return; }
    if (t.length > 30) { setError("Username must be under 30 characters."); return; }
    onLogin(t);
  };

  return (
    <>
      <div className="background-decor">
        <div className="bubble bubble-1" /><div className="bubble bubble-2" /><div className="bubble bubble-3" />
      </div>
      <main className="landing-outer">
        <div className="glass-card landing-card fade-in">
          <header className="app-header">
            <div className="logo"><span className="logo-icon">💬</span><h1>Chit-Chat Room</h1></div>
            <p className="subtitle">Multi-room chats · Real-time messages</p>
          </header>
          <form onSubmit={submit} className="login-form">
            <div className="form-group">
              <label htmlFor="landing-username">Choose your username</label>
              <div className="input-wrapper">
                <span className="input-icon">@</span>
                <input type="text" id="landing-username" value={name}
                  onChange={(e) => { setName(e.target.value); setError(""); }}
                  placeholder="e.g. wanderer" autoComplete="off" maxLength={30}
                  className={error ? "input-error" : ""} />
              </div>
              <span className="error-text">{error}</span>
            </div>
            <button type="submit" id="landing-enter-btn" className="btn btn-primary btn-full">
              <span>Enter Dashboard</span>
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </form>
        </div>
      </main>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function Dashboard({ username, chatRooms, pinnedChats, loading, onCreateChat, onOpenChat, onTogglePin, onLogout, onRefresh }) {
  const [showModal, setShowModal]     = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notifState, setNotifState]   = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  const q = searchQuery.toLowerCase();
  const match  = (r) => r.chatName.toLowerCase().includes(q);
  const pinned = chatRooms.filter((r) => pinnedChats.has(r.id) && match(r));
  const recent = chatRooms.filter((r) => !pinnedChats.has(r.id) && match(r));

  const handleCreate = async (name) => {
    await onCreateChat(name);
    setShowModal(false);
  };

  const requestNotif = () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        setNotifState(p);
        if (p === "granted") {
          new Notification("Notifications enabled!", {
            body: "You'll get alerts for new messages when this tab is in the background.",
            icon: "/favicon.ico",
          });
        }
      });
    } else if (Notification.permission === "denied") {
      alert("Notifications are blocked. Enable them in browser settings.");
    }
  };

  return (
    <>
      <div className="background-decor">
        <div className="bubble bubble-1" /><div className="bubble bubble-2" /><div className="bubble bubble-3" />
      </div>

      <div className="dashboard-wrapper fade-in">
        {/* ── Header ── */}
        <header className="dashboard-header">
          <div className="dashboard-logo">
            <span className="logo-icon-sm">💬</span>
            <span className="dashboard-brand">ChitrChatr</span>
          </div>
          <div className="dashboard-header-right">
            {notifState !== "granted" && notifState !== "unsupported" && (
              <button className="btn btn-outline btn-sm notif-invite-btn" onClick={requestNotif}
                id="enable-notif-btn" title="Enable notifications">
                🔔 Enable Alerts
              </button>
            )}
            <div className="user-profile">
              <span className="avatar">{username[0].toUpperCase()}</span>
              <span className="profile-name">@{username}</span>
            </div>
            <button onClick={onLogout} className="btn btn-outline btn-sm" id="dashboard-logout-btn" title="Logout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: "1rem", height: "1rem" }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="leave-text">Leave</span>
            </button>
          </div>
        </header>

        {/* ── Main Content ── */}
        <main className="dashboard-content">
          {/* Hero */}
          <section className="dashboard-hero">
            <div className="hero-text">
              <h2 className="hero-greeting">Hey, <span className="hero-username">@{username}</span> 👋</h2>
              <p className="hero-subtitle">Pick a room or start a fresh conversation</p>
            </div>
            <div className="hero-actions">
              <button className="btn btn-primary" id="new-chat-btn" onClick={() => setShowModal(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ width: "1rem", height: "1rem" }}>
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Chat
              </button>
              <button className="btn btn-outline btn-sm" onClick={onRefresh} id="refresh-btn" title="Refresh">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ width: "1rem", height: "1rem" }}>
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          </section>

          {/* Search */}
          <div className="search-wrapper">
            <div className="input-wrapper search-input-wrapper">
              <span className="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ width: "0.95rem", height: "0.95rem" }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input type="text" id="chat-search" placeholder="Search chats…"
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input" autoComplete="off" />
            </div>
          </div>

          {/* Pinned */}
          {pinned.length > 0 && (
            <section className="chat-section">
              <div className="section-header">
                <span className="section-icon">📌</span>
                <h3 className="section-title">Pinned</h3>
                <span className="section-count">{pinned.length}</span>
              </div>
              <div className="cards-grid">
                {pinned.map((r) => (
                  <ChatCard key={r.id} room={r} isPinned onPin={onTogglePin} onClick={() => onOpenChat(r)} />
                ))}
              </div>
            </section>
          )}

          {/* Recent */}
          <section className="chat-section">
            <div className="section-header">
              <span className="section-icon">🕐</span>
              <h3 className="section-title">Recent Chats</h3>
              <span className="section-count">{recent.length}</span>
            </div>

            {loading ? (
              <div className="loading-messages" style={{ minHeight: "120px" }}>
                <div className="spinner" /><p>Loading chats…</p>
              </div>
            ) : recent.length === 0 ? (
              <div className="empty-state">
                {searchQuery ? (
                  <p>No chats matching "<strong>{searchQuery}</strong>"</p>
                ) : (
                  <>
                    <span className="empty-icon">💬</span>
                    <p>No chats yet — start your first one!</p>
                    <button className="btn btn-primary btn-sm" id="empty-create-btn" onClick={() => setShowModal(true)}>
                      Create Chat
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="cards-grid">
                {recent.map((r) => (
                  <ChatCard key={r.id} room={r} isPinned={false} onPin={onTogglePin} onClick={() => onOpenChat(r)} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {showModal && (
        <CreateChatModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHAT ROOM
// ═══════════════════════════════════════════════════════════════════════════════

function ChatRoom({ username, room, socket, onBack }) {
  const [messages, setMessages]     = useState([]);
  const [inputText, setInputText]   = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dbStatus, setDbStatus]     = useState("connecting");
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [notifPerm, setNotifPerm]   = useState(
    "Notification" in window ? Notification.permission : "denied"
  );
  const [lightbox, setLightbox]     = useState(null);

  const chatWindowRef  = useRef(null);
  const fileInputRef   = useRef(null);
  const msgInputRef    = useRef(null);
  const renderedIds    = useRef(new Set());
  const nearBottomRef  = useRef(true);

  const scrollToBottom = () => {
    if (chatWindowRef.current)
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  };

  const handleScroll = () => {
    if (!chatWindowRef.current) return;
    const { scrollHeight, scrollTop, clientHeight } = chatWindowRef.current;
    nearBottomRef.current = scrollHeight - scrollTop - clientHeight <= 150;
  };

  // ── Load initial messages ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const res  = await fetch(`${BACKEND_URL}/api/chatrooms/${room.id}/messages`);
        const data = await res.json();
        if (data.success) {
          setMessages(data.messages);
          data.messages.forEach((m) => renderedIds.current.add(m.id));
          setDbStatus("online");
        } else {
          setDbStatus("offline");
        }
      } catch {
        setDbStatus("offline");
      } finally {
        setIsInitialLoad(false);
      }
    };
    load();
  }, [room.id]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!isInitialLoad) setTimeout(scrollToBottom, 80);
  }, [isInitialLoad]);

  // ── Socket.IO ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.emit("join_room", { roomId: room.id, username });

    const onNewMessage = (msg) => {
      if (renderedIds.current.has(msg.id)) return;
      renderedIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      setDbStatus("online");

      if (msg.username !== username) {
        const body = msg.message || (msg.file ? `Sent: ${msg.file.name}` : "Sent a message");
        fireNotification(msg.username, body, room.id, room.chatName);
      }

      if (nearBottomRef.current) setTimeout(scrollToBottom, 50);
    };

    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("new_message", onNewMessage);
      socket.emit("leave_room", { roomId: room.id, username });
    };
  }, [socket, room.id, room.chatName, username]);

  // Listen for SW notification click → navigate to room
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (e) => {
      if (e.data?.type === "OPEN_ROOM" && e.data.roomId !== room.id) onBack();
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [room.id, onBack]);


  // ── File handling ──────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { alert("Max file size is 4 MB."); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = (evt) =>
      setSelectedFile({ data: evt.target.result, name: file.name, type: file.type || "application/octet-stream", size: file.size });
    reader.readAsDataURL(file);
  };

  const clearFile = () => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; };

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = (e) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text && !selectedFile) return;
    if (!socket || !socket.connected) return;

    socket.emit("send_message", {
      roomId: room.id, username, message: text,
      ...(selectedFile ? { file: selectedFile } : {}),
    });

    setInputText(""); clearFile();
    msgInputRef.current?.focus();
  };

  // ── Notifications ──────────────────────────────────────────────────────────
  const requestNotif = () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        setNotifPerm(p);
        if (p === "granted")
          new Notification("Notifications enabled!", {
            body: "You'll get alerts when new messages arrive while this tab is in the background.",
            icon: "/favicon.ico",
          });
      });
    } else if (Notification.permission === "denied") {
      alert("Notifications are blocked. Enable them in browser settings.");
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && lightbox) setLightbox(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lightbox]);

  return (
    <>
      <div className="background-decor">
        <div className="bubble bubble-1" /><div className="bubble bubble-2" />
      </div>

      <main className="chat-container fade-in">
        {/* ── Header ── */}
        <header className="chat-header">
          <div className="header-left">
            <button className="back-btn" onClick={onBack} id="back-to-dashboard-btn" title="Back to Dashboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" style={{ width: "1.1rem", height: "1.1rem" }}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="chat-logo">{room.type === "daily" ? "📅" : "💬"}</span>
            <div className="header-room-info">
              <h2>{room.chatName}</h2>
              <span className="header-room-date">{getDayName(room.createdAt)} · {formatDate(room.createdAt)}</span>
            </div>
            <div className={`status-badge ${dbStatus === "online" ? "status-connected" : dbStatus === "offline" ? "status-error" : "status-loading"}`}>
              <span className="status-dot" />
              <span className="status-text">
                {dbStatus === "online" ? "Online" : dbStatus === "offline" ? "Offline" : "Connecting…"}
              </span>
            </div>
          </div>

          <div className="header-right">
            <div className="user-profile">
              <span className="avatar">{username[0].toUpperCase()}</span>
              <span className="profile-name">@{username}</span>
            </div>
            {"Notification" in window && (
              <button id="notification-btn"
                className={`btn btn-outline btn-sm btn-icon-only ${notifPerm === "granted" ? "btn-active-notification" : ""}`}
                title={notifPerm === "granted" ? "Notifications On" : "Enable Notifications"}
                style={{ width: "2.2rem", height: "2.2rem", display: "inline-flex", opacity: notifPerm === "denied" ? 0.5 : 1 }}
                onClick={requestNotif}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" style={{ width: "1rem", height: "1rem" }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>
            )}
            <button onClick={onBack} className="btn btn-outline btn-sm" id="leave-btn" title="Dashboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="leave-icon" style={{ width: "1rem", height: "1rem" }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="leave-text">Dashboard</span>
            </button>
          </div>
        </header>

        {/* ── Offline Bar ── */}
        <div id="db-offline-alert" className={`alert-bar ${dbStatus !== "offline" ? "alert-hidden" : ""}`}>
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Connection lost. Attempting to reconnect…</span>
        </div>

        {/* ── Messages ── */}
        <section className="chat-window" id="chat-window" ref={chatWindowRef} onScroll={handleScroll}>
          {isInitialLoad ? (
            <div className="loading-messages"><div className="spinner" /><p>Loading messages…</p></div>
          ) : messages.length === 0 ? (
            <div className="empty-chat-state">
              <span style={{ fontSize: "2.5rem" }}>💬</span>
              <p>No messages yet — start the conversation!</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMe = msg.username === username;
              const { cls, icon } = msg.file ? getFileStyle(msg.file.name, msg.file.type) : {};
              return (
                <div key={msg.id || idx} className={`msg-wrapper ${isMe ? "msg-sent" : "msg-received"}`}>
                  <div className="msg-header">
                    {!isMe && <span className="msg-sender">@{msg.username}</span>}
                    <span className="msg-time">{formatTime(msg.createdAt)}</span>
                  </div>
                  <div className="msg-bubble">
                    {msg.message && <span className="msg-text">{msg.message}</span>}
                    {msg.file && (
                      msg.file.type?.startsWith("image/") ? (
                        <div className="chat-img-wrapper"
                          onClick={() => setLightbox({ src: msg.file.data, name: msg.file.name, sender: msg.username })}>
                          <img className="chat-img" src={msg.file.data} alt={msg.file.name} loading="lazy" />
                        </div>
                      ) : (
                        <a href={msg.file.data} download={msg.file.name} target="_blank" rel="noreferrer"
                          className={`file-attachment-card ${cls}`}>
                          <div className="file-attachment-icon-wrapper">{icon}</div>
                          <div className="file-attachment-details">
                            <span className="file-attachment-name">{msg.file.name}</span>
                            <span className="file-attachment-meta">{formatBytes(msg.file.size)}</span>
                          </div>
                          <div className="file-attachment-download-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round" style={{ width: "1.1rem", height: "1.1rem" }}>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </div>
                        </a>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* ── Footer ── */}
        <footer className="chat-footer">
          {selectedFile && (
            <div className="file-preview-container">
              <div className="file-preview-content">
                <span className="file-preview-icon">📎</span>
                <div className="file-preview-details">
                  <span className="preview-filename">{selectedFile.name}</span>
                  <span className="preview-filesize">{formatBytes(selectedFile.size)}</span>
                </div>
                <button type="button" onClick={clearFile} className="cancel-file-btn" title="Remove">✕</button>
              </div>
            </div>
          )}
          <form id="chat-form" className="chat-form" onSubmit={handleSend}>
            <input type="file" id="file-input" ref={fileInputRef} style={{ display: "none" }}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={handleFileChange} />
            <button type="button" id="attach-btn" onClick={() => fileInputRef.current?.click()}
              className="btn btn-outline btn-icon-only attach-btn" title="Attach file" disabled={dbStatus === "offline"}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" style={{ width: "1.1rem", height: "1.1rem" }}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <div className="input-container">
              <input ref={msgInputRef} type="text" id="message-input"
                placeholder={dbStatus === "offline" ? "Reconnecting…" : "Type a message…"}
                value={inputText} onChange={(e) => setInputText(e.target.value)}
                autoComplete="off" maxLength={1000} disabled={dbStatus === "offline"} />
            </div>
            <button type="submit" id="send-btn" className="btn btn-primary btn-icon-only" disabled={dbStatus === "offline"}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </footer>
      </main>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div id="image-modal" className="modal" style={{ display: "block" }}
          onClick={(e) => e.target.id === "image-modal" && setLightbox(null)}>
          <span className="modal-close" onClick={() => setLightbox(null)}>×</span>
          <img className="modal-content" src={lightbox.src} alt={lightbox.name} />
          <div id="modal-caption">{lightbox.name} (sent by @{lightbox.sender})</div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [view, setView]         = useState(localStorage.getItem("username") ? "dashboard" : "landing");
  const [chatRooms, setChatRooms]       = useState([]);
  const [activeChatRoom, setActiveChatRoom] = useState(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [socket, setSocket]     = useState(null);
  const [pinnedChats, setPinnedChats] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pinnedChats") || "[]")); }
    catch { return new Set(); }
  });

  // ── Init Socket.IO + SW when user is known ─────────────────────────────────
  useEffect(() => {
    if (!username) return;

    registerServiceWorker();

    // Register user in DB
    fetch(`${BACKEND_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }).catch(() => {});

    // Dynamically import socket.io-client
    import("socket.io-client")
      .then(({ io }) => {
        const s = io(BACKEND_URL || window.location.origin, { path: "/socket.io", transports: ["websocket", "polling"] });
        setSocket(s);
        return () => s.disconnect();
      })
      .catch(() => console.warn("Socket.IO unavailable – real-time disabled"));
  }, [username]);

  // Cleanup socket on unmount
  useEffect(() => () => { if (socket) socket.disconnect(); }, [socket]);

  // ── Listen for SW → open room message ─────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (e) => {
      if (e.data?.type === "OPEN_ROOM") {
        const room = chatRooms.find((r) => r.id === e.data.roomId);
        if (room) { setActiveChatRoom(room); setView("chat"); }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [chatRooms]);

  // ── Load chat rooms ────────────────────────────────────────────────────────
  const loadChatRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const res  = await fetch(`${BACKEND_URL}/api/chatrooms`);
      const data = await res.json();
      if (data.success) setChatRooms(data.chatrooms);
    } catch (e) { console.error("Failed to load rooms:", e); }
    finally { setRoomsLoading(false); }
  }, []);

  useEffect(() => {
    if (username && view === "dashboard") {
      Promise.resolve().then(() => {
        loadChatRooms();
      });
      const id = setInterval(loadChatRooms, 60_000); // refresh every minute
      return () => clearInterval(id);
    }
  }, [username, view, loadChatRooms]);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const handleLogin = (name) => {
    localStorage.setItem("username", name);
    setUsername(name);
    setView("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("username");
    if (socket) { socket.disconnect(); setSocket(null); }
    setUsername(""); setView("landing"); setChatRooms([]); setActiveChatRoom(null);
  };

  // ── Chat Room actions ──────────────────────────────────────────────────────
  const handleCreateChat = async (chatName) => {
    const res  = await fetch(`${BACKEND_URL}/api/chatrooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatName }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Failed to create chat");
    await loadChatRooms();
    handleOpenChat(data.chatroom);
  };

  const handleOpenChat = (room) => { setActiveChatRoom(room); setView("chat"); };

  const handleBackToDashboard = () => {
    setActiveChatRoom(null);
    setView("dashboard");
    loadChatRooms();
  };

  const handleTogglePin = (roomId) => {
    setPinnedChats((prev) => {
      const next = new Set(prev);
      next.has(roomId) ? next.delete(roomId) : next.add(roomId);
      localStorage.setItem("pinnedChats", JSON.stringify([...next]));
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (view === "landing")
    return <LandingPage onLogin={handleLogin} />;

  if (view === "chat" && activeChatRoom)
    return <ChatRoom username={username} room={activeChatRoom} socket={socket} onBack={handleBackToDashboard} />;

  return (
    <Dashboard
      username={username} chatRooms={chatRooms} pinnedChats={pinnedChats}
      loading={roomsLoading} onCreateChat={handleCreateChat} onOpenChat={handleOpenChat}
      onTogglePin={handleTogglePin} onLogout={handleLogout} onRefresh={loadChatRooms}
    />
  );
}
