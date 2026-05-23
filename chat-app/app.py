import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Secret key for signing session cookies
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key-12345-chat-app")

# MongoDB connection configuration
mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/chat_db")

db_client = None
db_connected = False
messages_col = None

def get_db_collection():
    """Helper to retrieve the messages collection, attempting reconnect if offline."""
    global db_client, db_connected, messages_col
    try:
        # Check if client exists and is responsive
        if db_client is not None:
            # Simple check to see if connection is alive
            db_client.admin.command('ping')
            db_connected = True
        else:
            # Initialize client
            db_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=2000)
            db_client.admin.command('ping')
            
            # Safe database selection
            db = None
            try:
                db = db_client.get_default_database()
            except Exception:
                pass
            
            if db is None:
                db = db_client['chat_db']
                
            messages_col = db['messages']
            db_connected = True
    except Exception as e:
        print(f"MongoDB connection/reconnection error: {e}")
        db_client = None
        messages_col = None
        db_connected = False
        
    return messages_col

# Initialize DB connection on startup
get_db_collection()

@app.route("/", methods=["GET", "POST"])
def index():
    """Username entry page."""
    # If user is already logged in, redirect to chat
    if "username" in session:
        return redirect(url_for("chat"))

    error_msg = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        if not username:
            error_msg = "Username cannot be empty."
        elif len(username) > 30:
            error_msg = "Username must be under 30 characters."
        else:
            session["username"] = username
            return redirect(url_for("chat"))

    return render_template("index.html", error_msg=error_msg)

@app.route("/chat")
def chat():
    """Main chat page."""
    if "username" not in session:
        return redirect(url_for("index"))
    
    return render_template("chat.html", username=session["username"])

@app.route("/send_message", methods=["POST"])
def send_message():
    """Saves a message (with optional file attachment) to MongoDB."""
    if "username" not in session:
        return jsonify({"success": False, "error": "Unauthorized. Please choose a username."}), 401
    
    col = get_db_collection()
    if col is None:
        return jsonify({
            "success": False, 
            "error": "Database is currently offline. Message could not be saved."
        }), 503

    message = ""
    file_attachment = None

    # Check for JSON data or form-urlencoded
    if request.is_json:
        data = request.get_json()
        message = data.get("message", "").strip()
        file_attachment = data.get("file")
    else:
        message = request.form.get("message", "").strip()

    # Enforce validation: must have either text message or file attachment
    if not message and not file_attachment:
        return jsonify({"success": False, "error": "Message or file attachment cannot be empty."}), 400
    
    if len(message) > 1000:
        return jsonify({"success": False, "error": "Message is too long (max 1000 characters)."}), 400

    # Validate file size if attached (max 4.5MB = 4718592 bytes)
    if file_attachment:
        file_size = file_attachment.get("size", 0)
        if file_size > 4718592:
            return jsonify({"success": False, "error": "Attached file is too large (max 4.5MB)."}), 400
        
        # Verify it has data and name
        if not file_attachment.get("data") or not file_attachment.get("name"):
            return jsonify({"success": False, "error": "Invalid file attachment format."}), 400

    try:
        msg_doc = {
            "username": session["username"],
            "message": message,
            "timestamp": datetime.utcnow()  # Store as native datetime object
        }
        if file_attachment:
            msg_doc["file"] = {
                "data": file_attachment.get("data"),
                "name": file_attachment.get("name"),
                "type": file_attachment.get("type", "application/octet-stream"),
                "size": file_attachment.get("size", 0)
            }
        col.insert_one(msg_doc)
        return jsonify({"success": True})
    except PyMongoError as e:
        print(f"Error saving message to MongoDB: {e}")
        return jsonify({"success": False, "error": "Failed to save message due to a database error."}), 500

@app.route("/get_messages")
def get_messages():
    """Retrieves the latest messages as JSON."""
    if "username" not in session:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    col = get_db_collection()
    if col is None:
        return jsonify({
            "success": False, 
            "error": "Database is currently offline.",
            "db_status": "offline",
            "messages": []
        }), 503

    try:
        # Fetch the last 100 messages to avoid overloading the client
        cursor = col.find().sort("timestamp", -1).limit(100)
        messages = []
        for doc in cursor:
            # Format timestamp for display (ISO format string)
            # We'll parse it on client or display directly
            # doc['timestamp'] is a datetime object
            timestamp_str = doc.get("timestamp").isoformat() + "Z" if doc.get("timestamp") else datetime.utcnow().isoformat() + "Z"
            msg_item = {
                "username": doc.get("username"),
                "message": doc.get("message"),
                "timestamp": timestamp_str
            }
            if "file" in doc:
                msg_item["file"] = doc.get("file")
            messages.append(msg_item)
        
        # Reverse the list so it is in ascending order (oldest first)
        messages.reverse()
        return jsonify({"success": True, "messages": messages, "db_status": "online"})
    except PyMongoError as e:
        print(f"Error fetching messages from MongoDB: {e}")
        return jsonify({
            "success": False, 
            "error": "Failed to fetch messages due to a database error.",
            "db_status": "offline",
            "messages": []
        }), 500

@app.route("/logout")
def logout():
    """Clears session and logs user out."""
    session.pop("username", None)
    return redirect(url_for("index"))

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
