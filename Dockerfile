# Use a lightweight python base image
FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install gevent and gevent-websocket for production performance and stability with Socket.IO
RUN pip install --no-cache-dir gevent gevent-websocket

# Copy the backend code
COPY api/ ./api/

# Hugging Face Spaces runs on port 7860 by default
ENV PORT=7860
EXPOSE 7860

# Run the Flask backend
CMD ["python", "api/app.py"]
