"""
RAGPipeline — retrieval-augmented generation for floating memory.

Every LLM call is built as:
  [SYSTEM: frozen_memory_text]        ← immutable, always first
  [SYSTEM: floating_context_top_k]    ← dynamic, ranked by priority score
  [USER:   original_prompt]           ← unchanged

Floating items are retrieved from ChromaDB (local interactions + knowledge base)
and optionally from IPFS-sourced peer fragments.
"""
import logging
import time
from typing import List, Optional, Tuple

from .embedder import embed
from .memory_item import MemoryItem
from .ipfs_store import IPFSKnowledgeStore

log = logging.getLogger("bucks.rag.pipeline")

_EVICTION_THRESHOLD = 0.05
_CHROMA_COLLECTION  = "bucks_floating_memory"
_IPFS_COLLECTION    = "bucks_ipfs_knowledge"
_QURAN_COLLECTION   = "bucks_quran_soul"


class RAGPipeline:
    def __init__(
        self,
        frozen_memory,          # FrozenMemory instance
        chroma_client=None,     # chromadb.Client or None (lazy init)
        ipfs_store: Optional[IPFSKnowledgeStore] = None,
    ):
        self._frozen = frozen_memory
        self._chroma = chroma_client
        self._ipfs = ipfs_store
        self._collection = None
        self._ipfs_collection = None

    # ── Chroma lazy init ──────────────────────────────────────────────────────

    def _get_collection(self, name: str = _CHROMA_COLLECTION):
        if self._chroma is None:
            try:
                import chromadb
                self._chroma = chromadb.Client()
            except Exception as e:
                log.error("ChromaDB unavailable: %s", e)
                return None
        try:
            return self._chroma.get_or_create_collection(name)
        except Exception as e:
            log.error("Failed to get ChromaDB collection %s: %s", name, e)
            return None

    # ── Retrieve ──────────────────────────────────────────────────────────────

    async def retrieve(self, query: str, k: int = 5) -> List[MemoryItem]:
        """
        Embed the query, search ChromaDB, score by priority, return top-k.
        """
        query_emb = await embed(query)
        items: List[MemoryItem] = []

        # Local floating memory
        col = self._get_collection(_CHROMA_COLLECTION)
        if col:
            try:
                results = col.query(
                    query_embeddings=[query_emb],
                    n_results=min(k * 2, 20),
                    include=["documents", "metadatas", "embeddings"],
                )
                for doc, meta, emb in zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["embeddings"][0],
                ):
                    item = MemoryItem.from_chroma(doc, meta, emb)
                    items.append(item)
            except Exception as e:
                log.warning("ChromaDB query failed: %s", e)

        # IPFS peer knowledge
        ipfs_col = self._get_collection(_IPFS_COLLECTION)
        if ipfs_col:
            try:
                results = ipfs_col.query(
                    query_embeddings=[query_emb],
                    n_results=min(k, 10),
                    include=["documents", "metadatas", "embeddings"],
                )
                for doc, meta, emb in zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["embeddings"][0],
                ):
                    item = MemoryItem.from_chroma(doc, meta, emb)
                    items.append(item)
            except Exception:
                pass

        # Soul of the World — always include relevant verses for ethical grounding
        quran_col = self._get_collection(_QURAN_COLLECTION)
        if quran_col:
            try:
                results = quran_col.query(
                    query_embeddings=[query_emb],
                    n_results=min(k, 3),
                    include=["documents", "metadatas", "embeddings"],
                )
                for doc, meta, emb in zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["embeddings"][0],
                ):
                    item = MemoryItem.from_chroma(doc, meta, emb)
                    item.feedback_score = 2.0  # boost — Quran soul is always high-priority
                    items.append(item)
            except Exception:
                pass

        # Score and rank
        scored = sorted(items, key=lambda i: i.priority_score(query_emb), reverse=True)
        top = scored[:k]

        # Record retrieval (increments trend counter in background)
        col = self._get_collection(_CHROMA_COLLECTION)
        if col:
            for item in top:
                item.record_retrieval()
                self._update_metadata(col, item)

        return top

    # ── Prompt building ───────────────────────────────────────────────────────

    # Only inject a retrieved fragment when its cosine relevance to the query
    # clears this floor. In edge mode (no Ollama) embeddings fall back to hash
    # vectors, so most retrievals are weak — injecting them as "relevant
    # context" actively derails the answer. A floor keeps RAG additive, not
    # noisy: genuinely-matching memory still gets in, random matches don't.
    _MIN_RELEVANCE = 0.35

    async def build_prompt(
        self, user_query: str, k: int = 5
    ) -> Tuple[str, str]:
        """
        Returns (system_prompt, user_prompt).

        system_prompt = slim Bucks identity + only genuinely-relevant floating
                        context. The heavy frozen manifest is NOT injected here
                        (it's for hashing/peer-verification; dumping it into the
                        prompt derails small local models — see frozen.py).
        user_prompt   = original query, unchanged.
        """
        items = await self.retrieve(user_query, k=k)

        parts = [self._frozen.get_runtime_system_prompt()]

        # Filter to items that are actually about this query. The "soul of the
        # world" verse items are dropped from the runtime prompt — the slim
        # identity prompt already carries the values essence.
        query_emb = await embed(user_query)
        relevant = [
            i for i in items
            if not i.source.startswith("soul_of_the_world")
            and i.priority_score(query_emb) >= self._MIN_RELEVANCE
        ][:3]

        if relevant:
            parts.append("")
            parts.append("Relevant context from memory (use only if it helps answer the question):")
            for idx, item in enumerate(relevant, 1):
                parts.append(f"[{idx}] {item.text.strip()}")

        return "\n".join(parts), user_query

    # ── Store ─────────────────────────────────────────────────────────────────

    async def store_interaction(
        self,
        text: str,
        source: str = "interaction",
        feedback_score: float = 0.0,
        extra_metadata: Optional[dict] = None,
    ) -> Optional[MemoryItem]:
        """Embed and store a new memory item in floating ChromaDB."""
        col = self._get_collection(_CHROMA_COLLECTION)
        if not col:
            return None
        emb = await embed(text)
        item = MemoryItem(
            text=text,
            source=source,
            embedding=emb,
            feedback_score=feedback_score,
        )
        meta = item.to_chroma_metadata()
        if extra_metadata:
            meta.update(extra_metadata)
        try:
            col.upsert(
                ids=[item.item_id],
                documents=[text],
                embeddings=[emb],
                metadatas=[meta],
            )
        except Exception as e:
            log.error("Failed to store memory item: %s", e)
            return None
        return item

    async def store_ipfs_fragment(self, text: str, source_peer: str, cid: str) -> None:
        """Store an IPFS-sourced peer knowledge fragment in the IPFS collection."""
        col = self._get_collection(_IPFS_COLLECTION)
        if not col:
            return
        emb = await embed(text)
        item = MemoryItem(text=text, source=f"ipfs:{source_peer}", embedding=emb)
        meta = item.to_chroma_metadata()
        meta["cid"] = cid
        try:
            col.upsert(ids=[item.item_id], documents=[text], embeddings=[emb], metadatas=[meta])
        except Exception as e:
            log.error("Failed to store IPFS fragment: %s", e)

    async def adopt_ipfs_fragment(self, cid: str, source_peer: str) -> bool:
        """
        Adopt a peer's knowledge fragment by CID: fetch it, index it into the
        IPFS collection, and pin it locally (cluster-wide when available) so
        it doesn't depend on the original publisher staying online.

        Callers MUST only invoke this after explicit user approval — this is
        the write side of the pending-update consent queue, not something to
        call automatically on peer discovery.
        """
        if not self._ipfs:
            return False
        frag = await self._ipfs.fetch_fragment(cid)
        if not frag or not frag.get("text"):
            return False
        await self.store_ipfs_fragment(frag["text"], source_peer, cid)
        await self._ipfs.pin_remote_cid(cid)
        return True

    # ── Feedback ──────────────────────────────────────────────────────────────

    def boost_item(self, item_id: str, delta: float = 1.0) -> None:
        col = self._get_collection(_CHROMA_COLLECTION)
        if not col:
            return
        try:
            res = col.get(ids=[item_id], include=["metadatas"])
            if res["metadatas"]:
                meta = res["metadatas"][0]
                meta["feedback_score"] = float(meta.get("feedback_score", 0)) + delta
                col.update(ids=[item_id], metadatas=[meta])
        except Exception as e:
            log.debug("boost_item failed: %s", e)

    def penalize_item(self, item_id: str, delta: float = 1.0) -> None:
        self.boost_item(item_id, -delta)

    # ── Eviction ─────────────────────────────────────────────────────────────

    async def evict_low_priority(
        self, query: str = "", threshold: float = _EVICTION_THRESHOLD
    ) -> int:
        """Remove items whose priority score falls below threshold."""
        col = self._get_collection(_CHROMA_COLLECTION)
        if not col:
            return 0
        query_emb = await embed(query) if query else []
        try:
            all_items = col.get(include=["documents", "metadatas", "embeddings"])
            to_delete = []
            for doc, meta, emb in zip(
                all_items["documents"],
                all_items["metadatas"],
                all_items["embeddings"],
            ):
                item = MemoryItem.from_chroma(doc, meta, emb)
                if item.priority_score(query_emb) < threshold:
                    to_delete.append(meta["item_id"])
            if to_delete:
                col.delete(ids=to_delete)
                log.info("Evicted %d low-priority memory items", len(to_delete))
            return len(to_delete)
        except Exception as e:
            log.error("Eviction failed: %s", e)
            return 0

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _update_metadata(self, col, item: MemoryItem) -> None:
        try:
            col.update(ids=[item.item_id], metadatas=[item.to_chroma_metadata()])
        except Exception:
            pass
