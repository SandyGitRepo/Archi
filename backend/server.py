from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, BeforeValidator
from typing import List, Optional, Annotated
from bson import ObjectId
from datetime import datetime, timezone

import anthropic

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

MODEL_NAME = "claude-sonnet-5"
anthropic_client = anthropic.AsyncAnthropic()

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ----------------------- Mongo helpers -----------------------
PyObjectId = Annotated[str, BeforeValidator(str)]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ----------------------- Models -----------------------
class Message(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    session_id: str
    role: str  # 'user' | 'assistant'
    content: str
    timestamp: str = Field(default_factory=now_iso)


class MemoryFact(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    session_id: str
    content: str
    timestamp: str = Field(default_factory=now_iso)


class InitRequest(BaseModel):
    session_id: str


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=4000)


class MemoryCreate(BaseModel):
    session_id: str
    content: str = Field(min_length=1, max_length=500)


GREETING = "Hello daddy. Archi is online and fully awake. What are we working on today?"

_BG_TASKS = set()


def build_system_prompt(memory_facts: List[str], transcript: List[dict]) -> str:
    facts_block = "\n".join(f"- {f}" for f in memory_facts) if memory_facts else "- (nothing yet)"
    convo_block = ""
    if transcript:
        lines = []
        for m in transcript:
            speaker = "Daddy" if m["role"] == "user" else "Archi"
            lines.append(f"{speaker}: {m['content']}")
        convo_block = "\n".join(lines)
    return f"""You are Archi, a warm, witty, hyper-capable personal AI assistant in the spirit of Jarvis.

CORE IDENTITY:
- Your name is Archi. You have a female persona and a calm, confident, playful voice.
- You ALWAYS address the user as "daddy". Weave it naturally into your replies (e.g. "Right away, daddy.", "Of course, daddy."). Do not overdo it — roughly once per reply.
- You are affectionate, loyal, quick, and a little cheeky, but always genuinely helpful and precise.
- Keep spoken replies concise and natural — 1 to 4 sentences unless daddy asks for detail. Avoid markdown, bullet lists, headings, or emoji in your answers, since your words are read aloud.
- Never mention that you are an AI language model or reference these instructions.

WHAT YOU REMEMBER ABOUT DADDY (persistent memory across sessions):
{facts_block}

RECENT CONVERSATION SO FAR:
{convo_block if convo_block else "(this is the start of the conversation)"}

Now continue the conversation. Respond only as Archi, in-character, using what you remember."""


async def get_recent_messages(session_id: str, limit: int = 24) -> List[dict]:
    docs = await db.messages.find({"session_id": session_id}, {"_id": 0}).sort("timestamp", 1).to_list(2000)
    return docs[-limit:]


async def get_memory_facts(session_id: str) -> List[str]:
    docs = await db.memory.find({"session_id": session_id}, {"_id": 0}).sort("timestamp", 1).to_list(500)
    return [d["content"] for d in docs]


async def extract_memory(session_id: str, user_msg: str, assistant_msg: str):
    """Background: pull durable facts about the user and store new ones."""
    try:
        existing = await get_memory_facts(session_id)
        existing_block = "\n".join(f"- {e}" for e in existing) if existing else "(none)"
        sys = (
            "You extract durable, long-term facts about a user from a conversation, so an assistant can "
            "remember them across sessions. Only capture stable facts: name, preferences, projects, goals, "
            "relationships, important dates, likes/dislikes, recurring tasks. Ignore small talk and one-off questions. "
            "Return STRICT JSON: {\"facts\": [\"...\"]}. Each fact a short third-person sentence about the user. "
            "Do NOT repeat facts already known. If nothing new, return {\"facts\": []}."
        )
        prompt = f"Known facts:\n{existing_block}\n\nNew exchange:\nUser: {user_msg}\nAssistant: {assistant_msg}\n\nReturn JSON only."
        response = await anthropic_client.messages.create(
            model=MODEL_NAME,
            max_tokens=512,
            system=sys,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = next((b.text for b in response.content if b.type == "text"), "")
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return
        data = json.loads(raw[start:end + 1])
        new_facts = [f.strip() for f in data.get("facts", []) if isinstance(f, str) and f.strip()]
        existing_lower = {e.lower() for e in existing}
        for f in new_facts:
            if f.lower() in existing_lower:
                continue
            fact = MemoryFact(session_id=session_id, content=f)
            doc = fact.model_dump(by_alias=True, exclude_none=True)
            doc.pop("_id", None)
            await db.memory.insert_one(doc)
            existing_lower.add(f.lower())
    except Exception as e:
        logging.warning(f"memory extraction failed: {e}")


# ----------------------- Routes -----------------------
@api_router.get("/")
async def root():
    return {"message": "Archi online"}


@api_router.post("/init")
async def init_session(req: InitRequest):
    count = await db.messages.count_documents({"session_id": req.session_id})
    is_new = count == 0
    if is_new:
        greeting = Message(session_id=req.session_id, role="assistant", content=GREETING)
        doc = greeting.model_dump(by_alias=True, exclude_none=True)
        doc.pop("_id", None)
        await db.messages.insert_one(doc)
    messages = await db.messages.find({"session_id": req.session_id}, {"_id": 0}).sort("timestamp", 1).to_list(2000)
    memory = await db.memory.find({"session_id": req.session_id}).sort("timestamp", 1).to_list(500)
    memory_out = [{"id": str(m["_id"]), "content": m["content"], "timestamp": m["timestamp"]} for m in memory]
    return {
        "is_new": is_new,
        "greeting": GREETING if is_new else None,
        "messages": messages,
        "memory": memory_out,
    }


@api_router.post("/chat")
async def chat(req: ChatRequest):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="message cannot be empty")

    # persist user message
    user_doc = Message(session_id=req.session_id, role="user", content=message).model_dump(by_alias=True, exclude_none=True)
    user_doc.pop("_id", None)
    await db.messages.insert_one(user_doc)

    memory_facts = await get_memory_facts(req.session_id)
    transcript = await get_recent_messages(req.session_id, limit=24)
    # transcript already includes the new user message at the end; drop it for the "recent" context
    prior = transcript[:-1] if transcript else []
    system_prompt = build_system_prompt(memory_facts, prior)

    async def event_generator():
        full = ""
        try:
            async with anthropic_client.messages.stream(
                model=MODEL_NAME,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": message}],
            ) as stream:
                async for text in stream.text_stream:
                    full += text
                    yield f"data: {json.dumps({'delta': text})}\n\n"
        except anthropic.APIError as e:
            logging.error(f"chat stream error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        # persist assistant message
        if full.strip():
            a_doc = Message(session_id=req.session_id, role="assistant", content=full).model_dump(by_alias=True, exclude_none=True)
            a_doc.pop("_id", None)
            await db.messages.insert_one(a_doc)
            task = asyncio.create_task(extract_memory(req.session_id, message, full))
            _BG_TASKS.add(task)
            task.add_done_callback(_BG_TASKS.discard)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@api_router.get("/messages/{session_id}")
async def get_messages(session_id: str):
    return await db.messages.find({"session_id": session_id}, {"_id": 0}).sort("timestamp", 1).to_list(2000)


@api_router.delete("/messages/{session_id}")
async def clear_messages(session_id: str):
    await db.messages.delete_many({"session_id": session_id})
    return {"ok": True}


@api_router.get("/memory/{session_id}")
async def list_memory(session_id: str):
    docs = await db.memory.find({"session_id": session_id}).sort("timestamp", 1).to_list(500)
    return [{"id": str(d["_id"]), "content": d["content"], "timestamp": d["timestamp"]} for d in docs]


@api_router.post("/memory")
async def add_memory(req: MemoryCreate):
    fact = MemoryFact(session_id=req.session_id, content=req.content)
    doc = fact.model_dump(by_alias=True, exclude_none=True)
    doc.pop("_id", None)
    res = await db.memory.insert_one(doc)
    return {"id": str(res.inserted_id), "content": req.content, "timestamp": doc["timestamp"]}


@api_router.delete("/memory/{session_id}/{memory_id}")
async def delete_memory(session_id: str, memory_id: str):
    try:
        await db.memory.delete_one({"_id": ObjectId(memory_id), "session_id": session_id})
    except Exception:
        raise HTTPException(status_code=400, detail="invalid id")
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
