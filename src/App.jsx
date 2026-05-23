import { useState, useEffect, useRef } from "react";
import "./App.css";

export default function App() {
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dbStatus, setDbStatus] = useState("connecting"); // connecting, online, offline
  const [dbError, setDbError] = useState("");
  const [lightbox, setLightbox] = useState(null); // { src, name, sender } or null
  const [notifPermission, setNotifPermission] = useState(() => 
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );
  
  const chatWindowRef = useRef(null);
  const fileInputRef = useRef(null);
  const renderedMessagesRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);

  // Persistence of Username
  const handleLogin = (enteredName) => {
    const trimmed = enteredName.trim();
    if (!trimmed) return;
    localStorage.setItem("username", trimmed);
    setUsername(trimmed);
    isInitialLoadRef.current = true;
    renderedMessagesRef.current.clear();
    setMessages([]);
  };

  const handleLogout = () => {
    localStorage.removeItem("username");
    setUsername("");
    setMessages([]);
  };

  // Poll Messages when logged in
  useEffect(() => {
    if (!username) return;

    // Check Notification API support and init
    if ("Notification" in window) {
      setNotifPermission(Notification.permission);
    }

    const fetchMessages = async () => {
      try {
        const response = await fetch("/api/get_messages");
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Service unavailable");
        }
        const data = await response.json();
        if (data.success) {
          setDbStatus("online");
          setDbError("");

          const isNearBottomBeforeUpdate = checkIsNearBottom();
          
          // Identify new messages to trigger notifications
          data.messages.forEach(msg => {
            const signature = `${msg.username}|${msg.message}|${msg.timestamp}`;
            if (!renderedMessagesRef.current.has(signature)) {
              renderedMessagesRef.current.add(signature);
              
              // Trigger notification for other users' messages in background
              if (!isInitialLoadRef.current && msg.username !== username) {
                const notifBody = msg.message || (msg.file ? `Sent an attachment: ${msg.file.name}` : "Sent a message");
                sendDesktopNotification(msg.username, notifBody);
              }
            }
          });

          setMessages(data.messages);

          // Handle scrolling
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
            setTimeout(scrollToBottom, 100);
          } else if (isNearBottomBeforeUpdate) {
            setTimeout(scrollToBottom, 50);
          }
        }
      } catch (err) {
        console.error("Error fetching messages:", err);
        setDbStatus("offline");
        setDbError(err.message);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 1500);

    return () => clearInterval(interval);
  }, [username]);

  // Request desktop notification permissions
  const requestNotificationPermission = () => {
    if (!("Notification" in window)) {
      alert("This browser does not support desktop notifications.");
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        setNotifPermission(permission);
        if (permission === "granted") {
          new Notification("Notifications Enabled", {
            body: "You will now receive alerts for new messages when this tab is in the background.",
            icon: "https://cdn-icons-png.flaticon.com/512/5962/5962463.png"
          });
        }
      });
    } else if (Notification.permission === "denied") {
      alert("Notifications are blocked in your browser settings. Please enable them in site settings to receive notifications.");
    } else {
      alert("Notifications are already enabled!");
    }
  };

  const sendDesktopNotification = (sender, text) => {
    if (Notification.permission === "granted" && document.hidden) {
      const displayBody = text.length > 80 ? text.substring(0, 77) + "..." : text;
      try {
        new Notification(`@${sender}`, {
          body: displayBody,
          icon: "https://cdn-icons-png.flaticon.com/512/5962/5962463.png",
          tag: "chat-msg"
        });
      } catch (e) {
        console.error("Failed to trigger notification:", e);
      }
    }
  };

  // Scroll helpers
  const checkIsNearBottom = () => {
    if (!chatWindowRef.current) return false;
    const { scrollHeight, scrollTop, clientHeight } = chatWindowRef.current;
    return (scrollHeight - scrollTop - clientHeight) <= 100;
  };

  const scrollToBottom = () => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  };

  // File Upload Handlers
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const maxSizeBytes = 4 * 1024 * 1024; // 4MB
    if (file.size > maxSizeBytes) {
      alert(`File is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Maximum size is 4MB.`);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      setSelectedFile({
        data: evt.target.result,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() && !selectedFile) return;

    const textToSend = inputText.trim();
    const fileToSend = selectedFile;

    // Clear inputs immediately for responsiveness
    setInputText("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const payload = {
        username,
        message: textToSend
      };
      if (fileToSend) {
        payload.file = fileToSend;
      }

      const response = await fetch("/api/send_message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to send message");
      }

      // Trigger instant refetch
      const updatedResponse = await fetch("/api/get_messages");
      if (updatedResponse.ok) {
        const updatedData = await updatedResponse.json();
        if (updatedData.success) {
          setMessages(updatedData.messages);
          setTimeout(scrollToBottom, 50);
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      // Restore inputs on failure
      setInputText(textToSend);
      setSelectedFile(fileToSend);
      alert(err.message || "Failed to send message. Please try again.");
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileClassAndIcon = (name, mime) => {
    const filename = (name || "").toLowerCase();
    const type = (mime || "").toLowerCase();
    if (type === "application/pdf" || filename.endsWith(".pdf")) {
      return { className: "file-pdf", icon: "📕" };
    }
    if (type.includes("spreadsheet") || type.includes("excel") || filename.endsWith(".xls") || filename.endsWith(".xlsx")) {
      return { className: "file-excel", icon: "📊" };
    }
    if (type.includes("word") || type.includes("document") || filename.endsWith(".doc") || filename.endsWith(".docx")) {
      return { className: "file-word", icon: "📄" };
    }
    return { className: "file-general", icon: "📁" };
  };

  const formatTime = (isoStr) => {
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return "";
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return "";
    }
  };

  // --- View: Login Form ---
  if (!username) {
    return (
      <>
        <div className="background-decor">
          <div className="bubble bubble-1"></div>
          <div className="bubble bubble-2"></div>
        </div>
        
        <main className="login-container">
          <div className="glass-card fade-in">
            <header className="app-header">
              <div className="logo">
                <span className="logo-icon">💬</span>
                <h1>ChitrChatr</h1>
              </div>
              <p className="subtitle">Connect instantly, chat securely.</p>
            </header>
            
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const nameInput = e.target.elements.username.value.trim();
                if (nameInput.length > 30) {
                  alert("Username must be under 30 characters.");
                } else if (nameInput) {
                  handleLogin(nameInput);
                }
              }} 
              className="login-form"
            >
              <div className="form-group">
                <label htmlFor="username">Choose your username</label>
                <div className="input-wrapper">
                  <span className="input-icon">@</span>
                  <input 
                    type="text" 
                    id="username" 
                    name="username" 
                    placeholder="e.g. wanderer" 
                    required 
                    autoComplete="off"
                    maxLength={30}
                  />
                </div>
              </div>
              
              <button type="submit" className="btn btn-primary">
                <span>Enter Chat Room</span>
                <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </form>
          </div>
        </main>
      </>
    );
  }

  // --- View: Chat Room ---
  return (
    <>
      <div className="background-decor">
        <div className="bubble bubble-1"></div>
        <div className="bubble bubble-2"></div>
      </div>

      <main className="chat-container fade-in">
        {/* Chat Header */}
        <header className="chat-header">
          <div className="header-left">
            <span className="chat-logo">💬</span>
            <h2>Chit Chat Room</h2>
            <div className={`status-badge ${dbStatus === "online" ? "status-connected" : dbStatus === "offline" ? "status-error" : "status-loading"}`}>
              <span className="status-dot"></span>
              <span className="status-text">
                {dbStatus === "online" ? "Online" : dbStatus === "offline" ? "Offline" : "Connecting..."}
              </span>
            </div>
          </div>
          
          <div className="header-right">
            <div className="user-profile">
              <span className="avatar">{username[0].toUpperCase()}</span>
              <span className="profile-name">@{username}</span>
            </div>
            
            {"Notification" in window && (
              <button 
                id="notification-btn" 
                className={`btn btn-outline btn-sm btn-icon-only ${notifPermission === "granted" ? "btn-active-notification" : ""}`}
                title={notifPermission === "granted" ? "Notifications Enabled" : notifPermission === "denied" ? "Notifications Blocked" : "Enable Notifications"} 
                style={{ width: "2.2rem", height: "2.2rem", display: "inline-flex", opacity: notifPermission === "denied" ? 0.5 : 1 }}
                onClick={requestNotificationPermission}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1rem", height: "1rem" }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </button>
            )}

            <button 
              onClick={handleLogout} 
              className="btn btn-outline btn-sm" 
              id="leave-btn" 
              title="Leave Chat"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="leave-icon" style={{ width: "1rem", height: "1rem", display: "none" }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span className="leave-text">Leave</span>
            </button>
          </div>
        </header>

        {/* Database Offline Warning Bar */}
        <div id="db-offline-alert" className={`alert-bar ${dbStatus !== "offline" ? "alert-hidden" : ""}`}>
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>Database is offline. {dbError || "Connection timed out."}</span>
        </div>

        {/* Chat Feed */}
        <section className="chat-window" id="chat-window" ref={chatWindowRef}>
          {messages.length === 0 && dbStatus === "connecting" ? (
            <div className="loading-messages">
              <div className="spinner"></div>
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="system-msg">No messages yet. Start the conversation!</div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.username === username;
              const { className: fileClass, icon: fileIcon } = msg.file ? getFileClassAndIcon(msg.file.name, msg.file.type) : {};
              
              return (
                <div key={index} className={`msg-wrapper ${isMe ? "msg-sent" : "msg-received"}`}>
                  <div className="msg-header">
                    {!isMe && <span className="msg-sender">@{msg.username}</span>}
                    <span className="msg-time">{formatTime(msg.timestamp)}</span>
                  </div>
                  
                  <div className="msg-bubble">
                    {msg.message && <span className="msg-text">{msg.message}</span>}
                    
                    {msg.file && (
                      msg.file.type && msg.file.type.startsWith("image/") ? (
                        <div 
                          className="chat-img-wrapper" 
                          onClick={() => setLightbox({ src: msg.file.data, name: msg.file.name, sender: msg.username })}
                        >
                          <img 
                            className="chat-img" 
                            src={msg.file.data} 
                            alt={msg.file.name} 
                            loading="lazy" 
                          />
                        </div>
                      ) : (
                        <a 
                          href={msg.file.data} 
                          download={msg.file.name} 
                          target="_blank" 
                          rel="noreferrer" 
                          className={`file-attachment-card ${fileClass}`}
                        >
                          <div className="file-attachment-icon-wrapper">{fileIcon}</div>
                          <div className="file-attachment-details">
                            <span className="file-attachment-name">{msg.file.name}</span>
                            <span className="file-attachment-meta">{formatBytes(msg.file.size)}</span>
                          </div>
                          <div className="file-attachment-download-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1.1rem", height: "1.1rem" }}>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <polyline points="7 10 12 15 17 10"></polyline>
                              <line x1="12" y1="15" x2="12" y2="3"></line>
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

        {/* Message Input Bar */}
        <footer className="chat-footer">
          {/* File Preview */}
          <div id="file-preview-container" className={`file-preview-container ${!selectedFile ? "preview-hidden" : ""}`}>
            {selectedFile && (
              <div className="file-preview-content">
                <span className="file-preview-icon">📎</span>
                <div className="file-preview-details">
                  <span id="preview-filename" className="preview-filename">{selectedFile.name}</span>
                  <span id="preview-filesize" className="preview-filesize">{formatBytes(selectedFile.size)}</span>
                </div>
                <button 
                  type="button" 
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }} 
                  className="cancel-file-btn" 
                  title="Remove attachment"
                >
                  &times;
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleSendMessage} id="chat-form" className="chat-form">
            <input 
              type="file" 
              id="file-input" 
              ref={fileInputRef}
              style={{ display: "none" }} 
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={handleFileChange}
            />
            
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              id="attach-btn" 
              className="btn btn-outline btn-icon-only attach-btn" 
              title="Attach file"
              disabled={dbStatus === "offline"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1.1rem", height: "1.1rem" }}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
              </svg>
            </button>
            
            <div className="input-container">
              <input 
                type="text" 
                id="message-input" 
                placeholder={dbStatus === "offline" ? "Database connection offline." : "Type a message..."}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                autoComplete="off" 
                maxLength={1000}
                disabled={dbStatus === "offline"}
              />
            </div>
            
            <button 
              type="submit" 
              id="send-btn" 
              className="btn btn-primary btn-icon-only"
              disabled={dbStatus === "offline"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </footer>
      </main>

      {/* Lightbox Zoom Modal */}
      {lightbox && (
        <div 
          id="image-modal" 
          className="modal" 
          style={{ display: "block" }}
          onClick={(e) => {
            if (e.target.id === "image-modal" || e.target.className === "modal-close") {
              setLightbox(null);
            }
          }}
        >
          <span className="modal-close">&times;</span>
          <img className="modal-content" src={lightbox.src} alt={lightbox.name} />
          <div id="modal-caption">{lightbox.name} (sent by @{lightbox.sender})</div>
        </div>
      )}
    </>
  );
}
