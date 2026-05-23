document.addEventListener("DOMContentLoaded", () => {
    const chatWindow = document.getElementById("chat-window");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");
    const dbStatusBadge = document.getElementById("db-status-badge");
    const dbOfflineAlert = document.getElementById("db-offline-alert");
    const currentUser = document.getElementById("current-user").getAttribute("data-username");

    // Track already rendered messages to avoid re-rendering existing ones
    // We store a signature: "username|message|timestamp"
    const renderedMessages = new Set();
    let isInitialLoad = true;
    let pollIntervalId = null;

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

    // Render a single message to the chat container
    function renderMessage(msg) {
        const signature = `${msg.username}|${msg.message}|${msg.timestamp}`;
        if (renderedMessages.has(signature)) return false; // Message already drawn

        renderedMessages.add(signature);

        const isMe = msg.username === currentUser;
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
        bubble.textContent = msg.message;

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
        if (!messageText) return;

        // Optimistically clear the input field for UI snappiness
        messageInput.value = "";
        messageInput.focus();

        try {
            const response = await fetch("/send_message", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message: messageText })
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
            // Restore text if send failed
            messageInput.value = messageText;
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
