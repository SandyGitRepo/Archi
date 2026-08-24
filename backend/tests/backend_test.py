"""Backend API tests for Archi (init / chat SSE / memory CRUD / messages)."""
import json
import os
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

GREETING = "Hello daddy. Archi is online and fully awake. What are we working on today?"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


@pytest.fixture(scope="module")
def sessions():
    """Track sessions created by tests; cleanup messages at teardown."""
    ids = []
    yield ids
    with requests.Session() as s:
        for sid in ids:
            s.delete(f"{API}/messages/{sid}", timeout=30)
            try:
                for m in s.get(f"{API}/memory/{sid}", timeout=30).json():
                    s.delete(f"{API}/memory/{sid}/{m['id']}", timeout=30)
            except Exception:
                pass


def new_session(sessions):
    sid = f"TEST_{uuid.uuid4().hex[:10]}"
    sessions.append(sid)
    return sid


def sse_chat(sid, message, timeout=120):
    """Consume the /api/chat SSE stream, return (deltas, full_text, saw_done, errors)."""
    deltas, errors = [], []
    saw_done = False
    with requests.post(
        f"{API}/chat", json={"session_id": sid, "message": message},
        stream=True, timeout=timeout,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    ) as r:
        assert r.status_code == 200, f"chat status {r.status_code}: {r.text[:300]}"
        assert "text/event-stream" in r.headers.get("content-type", "")
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            if payload == "[DONE]":
                saw_done = True
                break
            obj = json.loads(payload)
            if "delta" in obj:
                deltas.append(obj["delta"])
            elif "error" in obj:
                errors.append(obj["error"])
    return deltas, "".join(deltas), saw_done, errors


# ----------------------- health -----------------------
class TestHealth:
    def test_root(self, client):
        r = client.get(f"{API}/", timeout=30)
        assert r.status_code == 200
        assert r.json()["message"] == "Archi online"


# ----------------------- /api/init -----------------------
class TestInit:
    def test_init_new_session_creates_greeting(self, client, sessions):
        sid = new_session(sessions)
        r = client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["is_new"] is True
        assert d["greeting"] == GREETING
        assert len(d["messages"]) == 1
        msg = d["messages"][0]
        assert msg["role"] == "assistant"
        assert msg["content"] == GREETING
        assert msg["session_id"] == sid
        assert "_id" not in msg
        assert d["memory"] == []

    def test_init_idempotent_existing_session(self, client, sessions):
        sid = new_session(sessions)
        client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        r = client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        d = r.json()
        assert d["is_new"] is False
        assert d["greeting"] is None
        assert len(d["messages"]) == 1, "greeting duplicated on re-init"

    def test_init_validation_error(self, client):
        r = client.post(f"{API}/init", json={}, timeout=30)
        assert r.status_code == 422


# ----------------------- /api/chat (SSE) -----------------------
class TestChat:
    def test_chat_streams_and_persists(self, client, sessions):
        sid = new_session(sessions)
        client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        deltas, full, done, errors = sse_chat(sid, "Hi there, who are you?")
        assert not errors, f"stream errors: {errors}"
        assert done, "no [DONE] sentinel"
        assert len(deltas) > 1, "reply was not streamed token-by-token"
        assert len(full.strip()) > 0
        assert "daddy" in full.lower(), f"persona missing 'daddy': {full[:200]}"

        msgs = client.get(f"{API}/messages/{sid}", timeout=30).json()
        roles = [m["role"] for m in msgs]
        assert roles == ["assistant", "user", "assistant"], roles
        assert msgs[1]["content"] == "Hi there, who are you?"
        assert msgs[2]["content"] == full
        assert all("_id" not in m for m in msgs)

    def test_chat_uses_memory_context(self, client, sessions):
        sid = new_session(sessions)
        client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        client.post(f"{API}/memory", json={"session_id": sid, "content": "TEST_ The user's dog is named Bingo."}, timeout=30)
        _, full, done, errors = sse_chat(sid, "What is my dog's name? Answer with just the name.")
        assert not errors and done
        assert "bingo" in full.lower(), f"memory not used in context: {full[:200]}"

    def test_chat_memory_auto_extraction(self, client, sessions):
        sid = new_session(sessions)
        client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        _, full, done, errors = sse_chat(sid, "My name is Mark and I love chess. Remember that.")
        assert not errors and done
        facts = []
        for _ in range(20):
            time.sleep(1.5)
            facts = client.get(f"{API}/memory/{sid}", timeout=30).json()
            if facts:
                break
        assert facts, "background extract_memory() stored no facts within 30s"
        blob = " ".join(f["content"].lower() for f in facts)
        assert "mark" in blob or "chess" in blob, f"extracted facts irrelevant: {blob}"

    def test_chat_validation_error(self, client):
        r = client.post(f"{API}/chat", json={"session_id": "TEST_x"}, timeout=30)
        assert r.status_code == 422


# ----------------------- /api/memory CRUD -----------------------
class TestMemory:
    def test_add_list_delete_memory(self, client, sessions):
        sid = new_session(sessions)
        content = "TEST_ The user prefers dark mode."
        r = client.post(f"{API}/memory", json={"session_id": sid, "content": content}, timeout=30)
        assert r.status_code == 200
        created = r.json()
        assert created["content"] == content
        assert isinstance(created["id"], str) and len(created["id"]) == 24
        assert "timestamp" in created

        listed = client.get(f"{API}/memory/{sid}", timeout=30).json()
        assert len(listed) == 1
        assert listed[0]["id"] == created["id"]
        assert listed[0]["content"] == content
        assert "_id" not in listed[0]

        d = client.delete(f"{API}/memory/{sid}/{created['id']}", timeout=30)
        assert d.status_code == 200 and d.json()["ok"] is True
        assert client.get(f"{API}/memory/{sid}", timeout=30).json() == []

    def test_memory_isolated_per_session(self, client, sessions):
        a, b = new_session(sessions), new_session(sessions)
        client.post(f"{API}/memory", json={"session_id": a, "content": "TEST_ fact A"}, timeout=30)
        assert client.get(f"{API}/memory/{b}", timeout=30).json() == []

    def test_delete_memory_invalid_id(self, client, sessions):
        sid = new_session(sessions)
        r = client.delete(f"{API}/memory/{sid}/not-an-objectid", timeout=30)
        assert r.status_code == 400, f"expected 400 for malformed id, got {r.status_code}"

    def test_delete_memory_wrong_session_does_not_delete(self, client, sessions):
        a, b = new_session(sessions), new_session(sessions)
        mid = client.post(f"{API}/memory", json={"session_id": a, "content": "TEST_ scoped"}, timeout=30).json()["id"]
        client.delete(f"{API}/memory/{b}/{mid}", timeout=30)
        assert len(client.get(f"{API}/memory/{a}", timeout=30).json()) == 1

    def test_memory_validation_error(self, client):
        r = client.post(f"{API}/memory", json={"session_id": "TEST_x"}, timeout=30)
        assert r.status_code == 422


# ----------------------- /api/messages -----------------------
class TestMessages:
    def test_clear_messages_and_regreet(self, client, sessions):
        sid = new_session(sessions)
        client.post(f"{API}/init", json={"session_id": sid}, timeout=30)
        client.post(f"{API}/memory", json={"session_id": sid, "content": "TEST_ survives clear"}, timeout=30)

        r = client.delete(f"{API}/messages/{sid}", timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True
        assert client.get(f"{API}/messages/{sid}", timeout=30).json() == []

        again = client.post(f"{API}/init", json={"session_id": sid}, timeout=30).json()
        assert again["is_new"] is True
        assert again["greeting"] == GREETING
        assert len(again["memory"]) == 1, "memory should survive a conversation reset"

    def test_get_messages_unknown_session(self, client):
        assert client.get(f"{API}/messages/TEST_nope_{uuid.uuid4().hex}", timeout=30).json() == []
