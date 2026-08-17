# Bucks Core

This workspace contains the Bucks Browser, its Soul Engine agent, IPFS tooling,
and supporting architecture notes.

## Start the browser

```bash
cd "bucks browser"
npm install
cd electron && npm install && cd ..
npm start
```

The browser starts the Soul Engine automatically on `127.0.0.1:8765`.

## Agent status

The current agent process is running, but NIM is not active because
`agent/.env` still contains the sample NGC API key. A NIM endpoint cannot
authenticate with that value.

Add a real NVIDIA API/NGC key to `bucks browser/agent/.env`:

```dotenv
MODEL_PROVIDER=nim
NGC_API_KEY=nvapi-your-real-key
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NIM_MODEL=meta/llama-3.1-8b-instruct
```

Restart Bucks after saving the file.

Check status at any time:

```bash
curl http://127.0.0.1:8765/health
```

Expected result when NIM is ready:

```json
{"mode":"cloud_llm","online":true,"provider":"nim"}
```

## Switching to Qwen

NIM is the default. The model selector also lists downloaded local Qwen
models. Selecting Qwen switches the agent to the on-device engine; selecting
NVIDIA NIM in the provider selector switches it back.

The browser keeps IPFS soul-manifest pinning to one attempt per agent identity
per session and suppresses repeat pin alerts.

## Project guides

- [Bucks Browser README](bucks%20browser/README.md)
- [App Store summary](app-store-summary.md)
- [Distribution guide](DISTRIBUTION.md)
