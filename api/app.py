import os
from datetime import datetime
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, join_room as sio_join_room, leave_room as sio_leave_room, emit
from flask_cors import CORS
from pymongo import MongoClient, DESCENDING
from pymongo.errors import DuplicateKeyError
from bson import ObjectId
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

load_dotenv()

# ── App Setup ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "multi-chat-secret-key-v2")

CORS(app, resources={r"/*": {"origins": "*"}})

# Use threading mode — works without eventlet/gevent, safe with pymongo
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25
)

# ── MongoDB Setup ─────────────────────────────────────────────────────────────
mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/chat_db")

db_client      = None
db             = None
chatrooms_col  = None
messages_col   = None
users_col      = None


def get_db():
    """Connect (or reconnect) to MongoDB and return the db reference."""
    global db_client, db, chatrooms_col, messages_col, users_col
    try:
        if db_client is not None:
            db_client.admin.command("ping")
        else:
            db_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            db_client.admin.command("ping")

            try:
                db = db_client.get_default_database()
            except Exception:
                db = db_client["chat_db"]

            chatrooms_col = db["chatrooms"]
            messages_col  = db["messages"]
            users_col     = db["users"]

            # Indexes
            try:
                chatrooms_col.create_index("chatName", unique=True)
                chatrooms_col.create_index([("lastActivityAt", DESCENDING)])
                chatrooms_col.create_index("dateKey", sparse=True)
                messages_col.create_index([("chatRoomId", 1), ("createdAt", 1)])
                users_col.create_index("username", unique=True)
            except Exception:
                pass

    except Exception as e:
        print(f"[DB] Connection error: {e}")
        db_client = chatrooms_col = messages_col = users_col = db = None

    return db


def serialize(doc):
    """Convert a MongoDB document to a JSON-serialisable dict."""
    if doc is None:
        return None
    result = {}
    for k, v in doc.items():
        if k == "_id":
            result["id"] = str(v)
        elif isinstance(v, ObjectId):
            result[k] = str(v)
        elif isinstance(v, datetime):
            result[k] = v.isoformat() + "Z"
        else:
            result[k] = v
    return result


# ── Daily Chat Creation ───────────────────────────────────────────────────────
def create_daily_chat():
    """Create today's daily chat room if it does not already exist."""
    get_db()
    if chatrooms_col is None:
        print("[Cron] DB offline – skipping daily chat creation")
        return

    now      = datetime.utcnow()
    # Use UTC date as key; display name in IST-friendly format
    date_key  = now.strftime("%Y-%m-%d")
    chat_name = now.strftime("Daily Chat - %d %b %Y")

    if chatrooms_col.find_one({"dateKey": date_key}):
        print(f"[Cron] Daily chat already exists for {date_key}")
        return

    try:
        chatrooms_col.insert_one({
            "chatName":       chat_name,
            "type":           "daily",
            "dateKey":        date_key,
            "createdAt":      now,
            "lastActivityAt": now,
        })
        print(f"[Cron] Created daily chat: {chat_name}")
    except DuplicateKeyError:
        pass
    except Exception as e:
        print(f"[Cron] Error creating daily chat: {e}")


# ── APScheduler: 4 AM UTC daily ───────────────────────────────────────────────
scheduler = BackgroundScheduler()
scheduler.add_job(create_daily_chat, "cron", hour=4, minute=0)

# Start scheduler
try:
    scheduler.start()
    print("[Cron] Scheduler started (daily chat at 04:00 UTC)")
except Exception as e:
    print(f"[Cron] Scheduler error: {e}")

# Try to connect to DB and create today's daily chat — non-blocking
try:
    get_db()
    create_daily_chat()
except Exception as e:
    print(f"[Startup] DB init warning: {e} — server will still start")

# ── REST API Routes ───────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "db": "online" if db is not None else "offline"})


@app.route("/api/users", methods=["POST"])
def upsert_user():
    if not request.is_json:
        return jsonify({"success": False, "error": "JSON required"}), 400

    username = request.get_json().get("username", "").strip()
    if not username or len(username) > 30:
        return jsonify({"success": False, "error": "Invalid username"}), 400

    get_db()
    if users_col is None:
        return jsonify({"success": False, "error": "DB offline"}), 503

    try:
        users_col.update_one(
            {"username": username},
            {"$setOnInsert": {"username": username, "createdAt": datetime.utcnow()}},
            upsert=True,
        )
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/chatrooms", methods=["GET"])
def list_chatrooms():
    get_db()
    if chatrooms_col is None:
        return jsonify({"success": False, "error": "DB offline", "chatrooms": []}), 503

    try:
        rooms = list(chatrooms_col.find().sort("lastActivityAt", DESCENDING))
        return jsonify({"success": True, "chatrooms": [serialize(r) for r in rooms]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "chatrooms": []}), 500


@app.route("/api/chatrooms", methods=["POST"])
def create_chatroom():
    if not request.is_json:
        return jsonify({"success": False, "error": "JSON required"}), 400

    chat_name = request.get_json().get("chatName", "").strip()
    if not chat_name or len(chat_name) > 60:
        return jsonify({"success": False, "error": "Chat name required (max 60 chars)"}), 400

    get_db()
    if chatrooms_col is None:
        return jsonify({"success": False, "error": "DB offline"}), 503

    try:
        now = datetime.utcnow()
        result = chatrooms_col.insert_one({
            "chatName":       chat_name,
            "type":           "custom",
            "dateKey":        None,
            "createdAt":      now,
            "lastActivityAt": now,
        })
        room = chatrooms_col.find_one({"_id": result.inserted_id})
        return jsonify({"success": True, "chatroom": serialize(room)}), 201

    except DuplicateKeyError:
        existing = chatrooms_col.find_one({"chatName": chat_name})
        return jsonify({"success": True, "chatroom": serialize(existing), "existed": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/chatrooms/<room_id>", methods=["GET"])
def get_chatroom(room_id):
    get_db()
    if chatrooms_col is None:
        return jsonify({"success": False, "error": "DB offline"}), 503
    try:
        room = chatrooms_col.find_one({"_id": ObjectId(room_id)})
        if not room:
            return jsonify({"success": False, "error": "Room not found"}), 404
        return jsonify({"success": True, "chatroom": serialize(room)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/chatrooms/<room_id>/messages", methods=["GET"])
def get_messages(room_id):
    get_db()
    if messages_col is None:
        return jsonify({"success": False, "error": "DB offline", "messages": []}), 503

    try:
        cursor = messages_col.find({"chatRoomId": room_id}).sort("createdAt", 1).limit(200)
        msgs = []
        for doc in cursor:
            msg = {
                "id":         str(doc["_id"]),
                "chatRoomId": doc.get("chatRoomId"),
                "username":   doc.get("username"),
                "message":    doc.get("message", ""),
                "createdAt":  doc["createdAt"].isoformat() + "Z" if doc.get("createdAt") else "",
            }
            if "file" in doc:
                msg["file"] = doc["file"]
            msgs.append(msg)
        return jsonify({"success": True, "messages": msgs, "db_status": "online"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "messages": []}), 500


# ── Socket.IO Events ──────────────────────────────────────────────────────────

@socketio.on("connect")
def handle_connect():
    print(f"[Socket] Client connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    print(f"[Socket] Client disconnected: {request.sid}")


@socketio.on("join_room")
def handle_join(data):
    room_id  = data.get("roomId")
    username = data.get("username", "Anonymous")
    if room_id:
        sio_join_room(room_id)
        print(f"[Socket] {username} joined room {room_id}")


@socketio.on("leave_room")
def handle_leave(data):
    room_id  = data.get("roomId")
    username = data.get("username", "")
    if room_id:
        sio_leave_room(room_id)
        print(f"[Socket] {username} left room {room_id}")


@socketio.on("send_message")
def handle_send_message(data):
    room_id         = data.get("roomId")
    username        = data.get("username", "").strip()
    message         = data.get("message", "").strip()
    file_attachment = data.get("file")

    if not room_id or not username:
        return
    if not message and not file_attachment:
        return
    if len(message) > 1000:
        emit("error", {"message": "Message too long (max 1000 chars)"})
        return

    get_db()
    if messages_col is None or chatrooms_col is None:
        emit("error", {"message": "Database offline"})
        return

    try:
        now = datetime.utcnow()
        doc = {"chatRoomId": room_id, "username": username, "message": message, "createdAt": now}
        if file_attachment:
            doc["file"] = {
                "data": file_attachment.get("data"),
                "name": file_attachment.get("name"),
                "type": file_attachment.get("type", "application/octet-stream"),
                "size": file_attachment.get("size", 0),
            }

        result = messages_col.insert_one(doc)

        # Update room's last activity
        try:
            chatrooms_col.update_one({"_id": ObjectId(room_id)}, {"$set": {"lastActivityAt": now}})
        except Exception:
            pass

        payload = {
            "id":         str(result.inserted_id),
            "chatRoomId": room_id,
            "username":   username,
            "message":    message,
            "createdAt":  now.isoformat() + "Z",
        }
        if file_attachment:
            payload["file"] = doc["file"]

        emit("new_message", payload, to=room_id)
        print(f"[Socket] Message from {username} in room {room_id}")

    except Exception as e:
        print(f"[Socket] Error in send_message: {e}")
        emit("error", {"message": "Failed to save message"})


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print(" ChitrChatr Backend — Flask + Socket.IO")
    print(f" Running on http://localhost:{port}")
    print("=" * 50)
    socketio.run(
        app,
        debug=True,
        host="0.0.0.0",
        port=port,
        use_reloader=False,   # disable reloader to prevent double scheduler start
        allow_unsafe_werkzeug=True,
    )
