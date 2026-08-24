"""Tests for the FIXED shared session id 'archi-daddy-main' memory persistence.

NOTE: This suite does NOT delete anything from the fixed session (it is the
real user vault). It only adds a TEST_ prefixed fact and removes that one.
"""
import os
import time

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
FIXED = "archi-daddy-main"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- GET /api/memory/archi-daddy-main ---
def test_get_memory_fixed_session(api):
    r = api.get(f"{BASE_URL}/api/memory/{FIXED}", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for item in data:
        assert set(["id", "content", "timestamp"]).issubset(item.keys())
        assert "_id" not in item
        assert isinstance(item["id"], str)


# --- memory survives repeated /api/init calls ---
def test_memory_persists_across_repeated_init(api):
    created = api.post(f"{BASE_URL}/api/memory", json={"session_id": FIXED, "content": "TEST_persistence probe fact"}, timeout=30)
    assert created.status_code == 200
    fact_id = created.json()["id"]
    try:
        counts = []
        for _ in range(3):
            r = api.post(f"{BASE_URL}/api/init", json={"session_id": FIXED}, timeout=60)
            assert r.status_code == 200
            body = r.json()
            assert body["is_new"] is False, "fixed session should never be treated as new after first use"
            ids = [m["id"] for m in body["memory"]]
            assert fact_id in ids
            counts.append(len(ids))
        assert len(set(counts)) == 1, f"memory count changed across init calls: {counts}"

        # GET endpoint agrees with init payload
        g = api.get(f"{BASE_URL}/api/memory/{FIXED}", timeout=30)
        assert g.status_code == 200
        assert len(g.json()) == counts[0]
    finally:
        d = api.delete(f"{BASE_URL}/api/memory/{FIXED}/{fact_id}", timeout=30)
        assert d.status_code == 200


# --- chat on fixed session -> async extraction lands in memory ---
def test_chat_extracts_memory_into_fixed_session(api):
    before = api.get(f"{BASE_URL}/api/memory/{FIXED}", timeout=30).json()
    before_contents = {m["content"] for m in before}

    msg = "Remember this daddy fact: my name is Orion and I play the violin every morning."
    r = api.post(f"{BASE_URL}/api/chat", json={"session_id": FIXED, "message": msg}, timeout=180, stream=True)
    assert r.status_code == 200
    body = r.text
    assert "[DONE]" in body
    assert '"error"' not in body

    found = []
    deadline = time.time() + 40
    while time.time() < deadline:
        time.sleep(4)
        now = api.get(f"{BASE_URL}/api/memory/{FIXED}", timeout=30).json()
        found = [m for m in now if m["content"] not in before_contents]
        if found:
            break
    assert found, "no new memory facts extracted within 40s"
    joined = " ".join(f["content"].lower() for f in found)
    assert "orion" in joined or "violin" in joined, f"extracted facts unrelated: {joined}"


# --- messages persist for the fixed session ---
def test_messages_persist_fixed_session(api):
    r = api.get(f"{BASE_URL}/api/messages/{FIXED}", timeout=30)
    assert r.status_code == 200
    msgs = r.json()
    assert len(msgs) > 0
    assert all("_id" not in m for m in msgs)
    assert all(m["session_id"] == FIXED for m in msgs)
    assert any(m["role"] == "assistant" for m in msgs)
