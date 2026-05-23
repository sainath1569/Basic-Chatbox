document.addEventListener("DOMContentLoaded", () => {
    const chatWindow = document.getElementById("chat-window");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");
    const dbStatusBadge = document.getElementById("db-status-badge");
    const dbOfflineAlert = document.getElementById("db-offline-alert");
    const currentUser = document.getElementById("current-user").getAttribute("data-username");
    const notificationBtn = document.getElementById("notification-btn");
    
    // File upload elements
    const fileInput = document.getElementById("file-input");
    const attachBtn = document.getElementById("attach-btn");
    const filePreviewContainer = document.getElementById("file-preview-container");
    const previewFilename = document.getElementById("preview-filename");
    const previewFilesize = document.getElementById("preview-filesize");
    const cancelFileBtn = document.getElementById("cancel-file-btn");

    let selectedFileData = null; // Stores { data, name, type, size }

    // Track already rendered messages to avoid re-rendering existing ones
    // We store a signature: "username|message|timestamp"
    const renderedMessages = new Set();
    let isInitialLoad = true;
    let pollIntervalId = null;

    // Web Notification system configuration
    function initNotifications() {
        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notifications");
            return;
        }

        // Show the notification button
        notificationBtn.style.display = "inline-flex";
        updateNotificationBtnUI();

        notificationBtn.addEventListener("click", () => {
            if (Notification.permission === "default") {
                Notification.requestPermission().then(permission => {
                    updateNotificationBtnUI();
                    if (permission === "granted") {
                        // Play a brief test notification
                        new Notification("Notifications Enabled", {
                            body: "You will now receive notifications for new messages when this tab is in the background.",
                            icon: "https://cdn-icons-png.flaticon.com/512/5962/5962463.png"
                        });
                    }
                });
            } else if (Notification.permission === "denied") {
                alert("Notifications are currently blocked by your browser settings. Please enable them in your browser's site settings to receive alerts.");
            } else if (Notification.permission === "granted") {
                alert("Notifications are already enabled!");
            }
        });
    }

    function updateNotificationBtnUI() {
        if (Notification.permission === "granted") {
            notificationBtn.classList.add("btn-active-notification");
            notificationBtn.title = "Notifications Enabled";
        } else if (Notification.permission === "denied") {
            notificationBtn.classList.remove("btn-active-notification");
            notificationBtn.style.opacity = "0.5";
            notificationBtn.title = "Notifications Blocked";
        } else {
            notificationBtn.classList.remove("btn-active-notification");
            notificationBtn.title = "Enable Notifications";
        }
    }

    function sendNotification(sender, messageText) {
        if (Notification.permission === "granted" && document.hidden) {
            const bodyText = messageText.length > 80 ? messageText.substring(0, 77) + "..." : messageText;
            try {
                new Notification(`@${sender}`, {
                    body: bodyText,
                    icon: "https://cdn-icons-png.flaticon.com/512/5962/5962463.png",
                    tag: "chat-msg" // Overwrite previous notification to avoid spamming the screen
                });
            } catch (e) {
                console.error("Failed to trigger web notification:", e);
            }
        }
    }

    // Initialize notification checks
    initNotifications();

    // File attachment handler bindings
    attachBtn.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", handleFileSelect);
    cancelFileBtn.addEventListener("click", clearFileSelection);

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Limit file size to 4.0MB (4194304 bytes)
        const maxSizeBytes = 4 * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            alert(`File is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Maximum allowed size is 4MB.`);
            fileInput.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
            selectedFileData = {
                data: evt.target.result,
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size
            };

            // Update UI preview
            previewFilename.textContent = file.name;
            previewFilesize.textContent = formatBytes(file.size);
            filePreviewContainer.classList.remove("preview-hidden");
        };
        reader.readAsDataURL(file);
    }

    function clearFileSelection() {
        selectedFileData = null;
        fileInput.value = "";
        filePreviewContainer.classList.add("preview-hidden");
    }

    function formatBytes(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    // Helper: Formats ISO date string into readable local HH:MM format
    function formatTime(isoStr) {
        try {
            const date = new Date(isoStr);
            if (isNaN(date.getTime())) return "";
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        } catch (e) {
            return "";
        }
    }

    // Helper: Checks if the chat window is scrolled near the bottom (within 100px)
    function isNearBottom() {
        const threshold = 100;
        return (chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight) <= threshold;
    }

    // Helper: Scrolls the chat feed to the absolute bottom
    function scrollToBottom() {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Update the database connectivity status UI
    function updateStatusUI(isOnline, errorMessage = "") {
        const badgeText = dbStatusBadge.querySelector(".status-text");
        
        if (isOnline) {
            dbStatusBadge.className = "status-badge status-connected";
            badgeText.textContent = "Online";
            dbOfflineAlert.classList.add("alert-hidden");
            messageInput.removeAttribute("disabled");
            messageInput.placeholder = "Type a message...";
        } else {
            dbStatusBadge.className = "status-badge status-error";
            badgeText.textContent = "Offline";
            dbOfflineAlert.classList.remove("alert-hidden");
            messageInput.setAttribute("disabled", "true");
            messageInput.placeholder = errorMessage || "Database connection offline.";
        }
    }

    // Lightbox modal logic
    const imageModal = document.getElementById("image-modal");
    const modalImg = document.getElementById("modal-img");
    const modalCaption = document.getElementById("modal-caption");
    const modalClose = document.querySelector(".modal-close");

    function openImageModal(src, filename, senderName) {
        modalImg.src = src;
        modalCaption.textContent = `${filename} (sent by @${senderName})`;
        imageModal.style.display = "block";
    }

    modalClose.addEventListener("click", () => {
        imageModal.style.display = "none";
    });

    imageModal.addEventListener("click", (e) => {
        if (e.target === imageModal || e.target === modalClose) {
            imageModal.style.display = "none";
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && imageModal.style.display === "block") {
            imageModal.style.display = "none";
        }
    });

    // Render a single message to the chat container
    function renderMessage(msg) {
        const signature = `${msg.username}|${msg.message}|${msg.timestamp}`;
        if (renderedMessages.has(signature)) return false; // Message already drawn

        renderedMessages.add(signature);

        const isMe = msg.username === currentUser;
        if (!isInitialLoad && !isMe) {
            // Trigger desktop notification if the message has content or a file description
            const notifBody = msg.message || (msg.file ? `Sent an attachment: ${msg.file.name}` : "Sent a message");
            sendNotification(msg.username, notifBody);
        }

        const wrapper = document.createElement("div");
        wrapper.className = `msg-wrapper ${isMe ? 'msg-sent' : 'msg-received'}`;

        const header = document.createElement("div");
        header.className = "msg-header";

        const sender = document.createElement("span");
        sender.className = "msg-sender";
        sender.textContent = `@${msg.username}`;
        header.appendChild(sender);

        const time = document.createElement("span");
        time.className = "msg-time";
        time.textContent = formatTime(msg.timestamp);
        header.appendChild(time);

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";

        // Render text portion if present
        if (msg.message) {
            const textSpan = document.createElement("span");
            textSpan.className = "msg-text";
            textSpan.textContent = msg.message;
            bubble.appendChild(textSpan);
        }

        // Render file attachment portion if present
        if (msg.file) {
            if (msg.file.type && msg.file.type.startsWith("image/")) {
                // Image inline display
                const imgWrapper = document.createElement("div");
                imgWrapper.className = "chat-img-wrapper";
                
                const img = document.createElement("img");
                img.className = "chat-img";
                img.src = msg.file.data;
                img.alt = msg.file.name;
                img.loading = "lazy";
                
                imgWrapper.appendChild(img);
                bubble.appendChild(imgWrapper);

                // Fullscreen zoom on click
                imgWrapper.addEventListener("click", () => {
                    openImageModal(msg.file.data, msg.file.name, msg.username);
                });
            } else {
                // Document download card (PDF, Excel, Word, etc.)
                const fileCard = document.createElement("a");
                fileCard.href = msg.file.data;
                fileCard.download = msg.file.name;
                fileCard.target = "_blank";
                
                // Classify type for color-coding and icons
                let typeClass = "file-general";
                let icon = "📁";
                const mime = (msg.file.type || "").toLowerCase();
                const name = (msg.file.name || "").toLowerCase();

                if (mime === "application/pdf" || name.endsWith(".pdf")) {
                    typeClass = "file-pdf";
                    icon = "📕";
                } else if (mime.includes("spreadsheet") || mime.includes("excel") || name.endsWith(".xls") || name.endsWith(".xlsx")) {
                    typeClass = "file-excel";
                    icon = "📊";
                } else if (mime.includes("word") || mime.includes("document") || name.endsWith(".doc") || name.endsWith(".docx")) {
                    typeClass = "file-word";
                    icon = "📄";
                }

                fileCard.className = `file-attachment-card ${typeClass}`;
                
                const iconWrapper = document.createElement("div");
                iconWrapper.className = "file-attachment-icon-wrapper";
                iconWrapper.textContent = icon;
                fileCard.appendChild(iconWrapper);

                const details = document.createElement("div");
                details.className = "file-attachment-details";

                const filename = document.createElement("span");
                filename.className = "file-attachment-name";
                filename.textContent = msg.file.name;
                details.appendChild(filename);

                const size = document.createElement("span");
                size.className = "file-attachment-meta";
                size.textContent = formatBytes(msg.file.size);
                details.appendChild(size);

                fileCard.appendChild(details);

                const dlBtn = document.createElement("div");
                dlBtn.className = "file-attachment-download-btn";
                dlBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1.1rem; height: 1.1rem;">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                `;
                fileCard.appendChild(dlBtn);

                bubble.appendChild(fileCard);
            }
        }

        wrapper.appendChild(header);
        wrapper.appendChild(bubble);
        chatWindow.appendChild(wrapper);

        return true; // Successfully rendered
    }

    // Fetches the latest messages from the server
    async function fetchMessages() {
        try {
            const response = await fetch("/get_messages");
            if (!response.ok) {
                // Parse offline JSON details if available
                const errData = await response.json();
                throw new Error(errData.error || "Service unavailable");
            }
            
            const data = await response.json();
            if (data.success) {
                updateStatusUI(true);
                
                // Clear loading screen on first load
                if (isInitialLoad) {
                    chatWindow.innerHTML = "";
                }

                let newMessagesAdded = false;
                const wasNearBottom = isNearBottom() || isInitialLoad;

                data.messages.forEach(msg => {
                    const rendered = renderMessage(msg);
                    if (rendered) newMessagesAdded = true;
                });

                if (isInitialLoad) {
                    isInitialLoad = false;
                    scrollToBottom();
                } else if (newMessagesAdded && wasNearBottom) {
                    scrollToBottom();
                }
            }
        } catch (error) {
            console.error("Error fetching messages:", error);
            updateStatusUI(false, error.message);
            
            if (isInitialLoad) {
                chatWindow.innerHTML = `
                    <div class="loading-messages">
                        <p style="color: var(--status-offline); font-weight: bold;">Connection Error</p>
                        <p style="font-size: 0.8rem; text-align: center;">${error.message}</p>
                    </div>
                `;
            }
        }
    }

    // Handle sending a new message
    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const messageText = messageInput.value.trim();
        // Allow sending if there is text or an attached file
        if (!messageText && !selectedFileData) return;

        // Clear UI input and file previews immediately for snappy interface
        messageInput.value = "";
        const originalSelectedFile = selectedFileData; // Store ref in case we need to restore on error
        clearFileSelection();
        messageInput.focus();

        try {
            const payload = {};
            if (messageText) payload.message = messageText;
            if (originalSelectedFile) payload.file = originalSelectedFile;

            const response = await fetch("/send_message", {
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

            // Immediately poll to get the new message in the chat feed
            await fetchMessages();
            scrollToBottom();
        } catch (error) {
            console.error("Error sending message:", error);
            // Restore text and file if send failed
            messageInput.value = messageText;
            if (originalSelectedFile) {
                selectedFileData = originalSelectedFile;
                previewFilename.textContent = originalSelectedFile.name;
                previewFilesize.textContent = formatBytes(originalSelectedFile.size);
                filePreviewContainer.classList.remove("preview-hidden");
            }
            alert(error.message || "Could not send message. Please try again.");
        }
    });

    // Run first fetch
    fetchMessages();

    // Start periodic polling every 1.5 seconds
    pollIntervalId = setInterval(fetchMessages, 1500);

    // Clean up interval if page is unloaded
    window.addEventListener("beforeunload", () => {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
        }
    });
});
