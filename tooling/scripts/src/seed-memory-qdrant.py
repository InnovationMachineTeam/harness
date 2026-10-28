#!/usr/bin/env python3
"""Векторный индекс документации в Qdrant (формат mcp-server-qdrant).

argv: URL Qdrant (http://127.0.0.1:6333), путь к JSON
[{"path": "docs/x.md", "text": "..."}, ...]; без пути - stdin.

Коллекция harness-memory; вектор fastembed all-MiniLM-L6-v2
(passage_embed, имя вектора fast-all-minilm-l6-v2 - как у
FastEmbedProvider.get_vector_name()); payload {document, metadata}.
Точки сеятеля несут metadata.seed="repo-docs" - перед записью они
удаляются, память агентов (другие точки) не затрагивается.
"""
import hashlib
import json
import sys
from uuid import NAMESPACE_URL, uuid5

from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from qdrant_client import models

COLLECTION = "harness-memory"
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
VECTOR_NAME = "fast-all-minilm-l6-v2"
SEED = "repo-docs"


def chunk_markdown(text: str, max_chars: int = 1200):
    lines = text.split("\n")
    sections = [(None, [])]
    for line in lines:
        if line.startswith("#") and len(line) - len(line.lstrip("#")) in (1, 2, 3):
            sections.append((line.lstrip("#").strip(), []))
        else:
            sections[-1][1].append(line)
    chunks = []
    for title, body_lines in sections:
        body = "\n".join(body_lines).strip()
        if not body:
            continue
        while len(body) > max_chars:
            cut = body.rfind("\n\n", 0, max_chars)
            if cut < max_chars // 2:
                cut = body.find("\n\n", max_chars // 2)
            if cut <= 0:
                cut = max_chars
            chunks.append((title, body[:cut].strip()))
            body = body[cut:].strip()
        if body:
            chunks.append((title, body))
    return chunks


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:6333"
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as fh:
            docs = json.load(fh)
    else:
        docs = json.load(sys.stdin)

    points = []
    for doc in docs:
        for i, (title, body) in enumerate(chunk_markdown(doc["text"])):
            stable = f"{doc['path']}#{i}"
            point_id = uuid5(NAMESPACE_URL, f"harness-memory:{hashlib.sha1(stable.encode()).hexdigest()}").hex
            metadata = {"source": doc["path"], "chunk": i, "seed": SEED}
            if title:
                metadata["title"] = title
            points.append({"id": point_id, "text": body, "metadata": metadata})

    client = QdrantClient(url=url, timeout=10)
    client.delete(
        collection_name=COLLECTION,
        points_selector=models.FilterSelector(
            filter=models.Filter(must=[models.FieldCondition(key="metadata.seed", match=models.MatchValue(value=SEED))])
        ),
    )

    embedder = TextEmbedding(model_name=MODEL)
    texts = [p["text"] for p in points]
    vectors = list(embedder.embed(texts)) if texts else []
    client.upsert(
        collection_name=COLLECTION,
        points=[
            models.PointStruct(
                id=p["id"],
                vector={VECTOR_NAME: [float(x) for x in vec]},
                payload={"document": p["text"], "metadata": p["metadata"]},
            )
            for p, vec in zip(points, vectors)
        ],
    )
    print(f"{len(points)} чанков из {len(docs)} документов записано в {COLLECTION}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
