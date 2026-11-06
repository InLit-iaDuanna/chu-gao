import asyncio
import os
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
MODEL_ID = "intfloat/multilingual-e5-small"
REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
model = None
lock = asyncio.Lock()


@app.get("/health")
async def health():
    return {"ok": True, "engine": "local-embedding", "model": MODEL_ID, "loaded": model is not None}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]}


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    global model
    body = await request.json()
    inputs = body.get("input", [])
    inputs = [inputs] if isinstance(inputs, str) else inputs
    if not isinstance(inputs, list) or len(inputs) > 256 or any(not isinstance(value, str) or len(value) > 50000 for value in inputs):
        raise HTTPException(400, "Invalid embedding inputs")
    async with lock:
        if model is None:
            from sentence_transformers import SentenceTransformer
            model = await asyncio.to_thread(SentenceTransformer, os.environ.get("EMBEDDING_MODEL_PATH", "/models/e5"), device="cpu", local_files_only=True)
            model.max_seq_length = 512
        texts = [value if value.startswith(("query: ", "passage: ")) else "passage: " + value for value in inputs]
        vectors = await asyncio.to_thread(model.encode, texts, normalize_embeddings=True, batch_size=16)
    return {"object": "list", "model": MODEL_ID, "data": [{"object": "embedding", "index": index, "embedding": vector.tolist()} for index, vector in enumerate(vectors)], "usage": {"prompt_tokens": sum(len(value) // 3 + 1 for value in inputs), "total_tokens": sum(len(value) // 3 + 1 for value in inputs)}, "usage_estimated": True}
