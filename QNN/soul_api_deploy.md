# Soul Engine API — Deployment Guide

## What this is

`soul_api.py` is a FastAPI backend that exposes the Soul Engine swarm over HTTP.  
bucks.global's chat widget (`soul-chat.js`) calls it to answer visitor questions.

---

## Run locally (dev)

```bash
cd ~/Desktop/QNN

# Install deps (first time only)
pip install fastapi uvicorn python-dotenv --break-system-packages

# Start the server
uvicorn soul_api:app --host 0.0.0.0 --port 8000 --reload
```

Test it:
```bash
curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the meaning of patience?"}' | python3 -m json.tool
```

Health check:
```bash
curl http://localhost:8000/health
```

---

## Environment variables

| Variable         | Required | Description                              |
|------------------|----------|------------------------------------------|
| `NVIDIA_API_KEY` | Yes      | Your NVIDIA NIM API key (in `.env`)      |

The key is already in `~/Desktop/QNN/.env` and is **never** sent to the frontend.

---

## Deploy to Fly.io (recommended — always-on, free tier)

Fly.io keeps the server running 24/7, which matters because the swarm takes ~30s
to cold-start (loads the FAISS index and model).

### 1. Install flyctl
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Create a `Procfile` in ~/Desktop/QNN/
```
web: uvicorn soul_api:app --host 0.0.0.0 --port 8080
```

### 3. Create a `fly.toml` (fly launch generates this, but here's the key config)
```toml
app = "soul-engine-api"
primary_region = "ord"   # Chicago — change to your nearest region

[http_service]
  internal_port = 8080
  force_https   = true
  auto_stop_machines  = false   # keep warm (prevents cold-start latency)
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

### 4. Set the secret
```bash
fly secrets set NVIDIA_API_KEY="nvapi-..."
```

### 5. Deploy
```bash
fly launch   # first time: creates the app
fly deploy   # subsequent deploys
```

Your API will be live at: `https://soul-engine-api.fly.dev`

---

## Deploy to Railway (easiest — one click)

1. Push `~/Desktop/QNN/` to a GitHub repo (make sure `.gitignore` excludes `.env`)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variable: `NVIDIA_API_KEY=nvapi-...`
4. Railway auto-detects Python. Add a start command:
   ```
   uvicorn soul_api:app --host 0.0.0.0 --port $PORT
   ```
5. Note your Railway domain (e.g. `soul-engine-api.up.railway.app`)

---

## Update the frontend

Once deployed, update the URL in `buck-global-site/index.html`:

```html
<script>
  window.SOUL_API_URL = "https://soul-engine-api.fly.dev";
</script>
<script src="/soul-chat.js"></script>
```

Then redeploy bucks.global on Vercel (`vercel --prod` in the `buck-global-site/` folder).

---

## CORS

The API already allows `https://bucks.global` and `https://www.bucks.global`.  
To allow additional origins, edit the `allow_origins` list in `soul_api.py`.

---

## Rate limiting

Currently in-memory: 10 requests / 60 seconds per IP.  
For multi-instance deployments, replace with Redis:
```python
# TODO: swap _rate_buckets dict for redis-py or upstash-redis
import redis
r = redis.Redis(host=os.getenv("REDIS_URL", "localhost"))
```

---

## Files added

| File                                                       | Purpose                        |
|------------------------------------------------------------|--------------------------------|
| `~/Desktop/QNN/soul_api.py`                               | FastAPI backend                |
| `~/Desktop/Bucks Core/buck-global-site/soul-chat.js`      | Chat widget (embedded on site) |
| `~/Desktop/Bucks Core/buck-global-site/index.html`        | Updated with widget script tag |
| `~/Desktop/Bucks Core/buck-global-site/vercel.json`       | Updated with JS headers        |
