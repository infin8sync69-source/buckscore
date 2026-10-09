"""
ChromaDB-backed persistent memory for self-reinforcing agents.
Stored at ~/.bucks/agent-memory/ — persists across restarts.
"""
import os
import json
import time
import hashlib
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction


MEMORY_DIR = Path.home() / ".bucks" / "agent-memory"
COLLECTION_NAME = "bucks_interactions"
EMBED_MODEL = "nomic-embed-text"


class BucksMemory:
    def __init__(self):
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(MEMORY_DIR))

        # Use Ollama for embeddings; fall back to default if Ollama not ready
        try:
            embed_fn = OllamaEmbeddingFunction(
                url="http://localhost:11434/api/embeddings",
                model_name=EMBED_MODEL,
            )
            self.collection = self.client.get_or_create_collection(
                name=COLLECTION_NAME,
                embedding_function=embed_fn,
            )
        except Exception:
            self.collection = self.client.get_or_create_collection(
                name=COLLECTION_NAME,
            )

    def retrieve(self, query: str, k: int = 5) -> list[dict]:
        """Retrieve k most similar past interactions for RAG context."""
        try:
            if self.collection.count() == 0:
                return []
            results = self.collection.query(
                query_texts=[query],
                n_results=min(k, self.collection.count()),
            )
            items = []
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i]
                items.append({"memory": doc, "score": meta.get("score", 0), "agent": meta.get("agent", "?")})
            return items
        except Exception:
            return []

    def store(self, task_id: str, prompt: str, response: str, agent: str, score: int = 0):
        """Store a new interaction in ChromaDB."""
        doc = f"Query: {prompt}\nResponse: {response}"
        doc_id = hashlib.md5(f"{task_id}:{prompt}".encode()).hexdigest()
        try:
            self.collection.upsert(
                ids=[doc_id],
                documents=[doc],
                metadatas=[{
                    "task_id": task_id,
                    "agent": agent,
                    "score": score,
                    "ts": str(int(time.time())),
                }],
            )
        except Exception:
            pass

    def store_feedback(self, task_id: str, score: int, correction: Optional[str] = None):
        """Update an existing interaction's score, optionally adding a correction."""
        try:
            results = self.collection.get(where={"task_id": task_id})
            if not results["ids"]:
                return
            doc_id = results["ids"][0]
            doc = results["documents"][0]
            meta = results["metadatas"][0]
            meta["score"] = score
            if correction:
                doc += f"\nCorrection: {correction}"
            self.collection.upsert(ids=[doc_id], documents=[doc], metadatas=[meta])
        except Exception:
            pass

    def count(self) -> int:
        try:
            return self.collection.count()
        except Exception:
            return 0

    def clear(self):
        try:
            self.client.delete_collection(COLLECTION_NAME)
            self.collection = self.client.get_or_create_collection(COLLECTION_NAME)
        except Exception:
            pass
