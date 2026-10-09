FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source + data files
COPY . .

# Pre-download BGE-M3 model during build (avoids 30s cold-start delay)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3'); print('BGE-M3 cached.')" || true

EXPOSE 8080

CMD ["uvicorn", "soul_api:app", "--host", "0.0.0.0", "--port", "8080"]
