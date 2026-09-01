"""Bounded, in-memory conversation context for ORCA chat sessions."""
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SESSION_TTL_SECONDS = max(60, int(__import__("os").getenv("SESSION_TTL_MINUTES", "30")) * 60)
MAX_TURNS = 6


@dataclass
class Session:
    turns: List[Dict[str, str]] = field(default_factory=list)
    entities: Dict[str, str] = field(default_factory=dict)
    touched_at: float = field(default_factory=time.monotonic)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, Session] = {}

    def _evict(self) -> None:
        now = time.monotonic()
        self._sessions = {key: value for key, value in self._sessions.items() if now - value.touched_at < SESSION_TTL_SECONDS}

    @staticmethod
    def _entities_from(text: str, origin_harbour: Optional[str], target_pfz: Optional[str]) -> Dict[str, str]:
        entities: Dict[str, str] = {}
        zone = re.search(r"\bPFZ-\d{2}\b", text or "", re.I)
        harbour = re.search(r"\bHBR-[A-Z]{3}\b", text or "", re.I)
        if zone:
            entities["target_pfz"] = zone.group(0).upper()
        elif target_pfz:
            entities["target_pfz"] = target_pfz
        if harbour:
            entities["origin_harbour"] = harbour.group(0).upper()
        elif origin_harbour:
            entities["origin_harbour"] = origin_harbour
        return entities

    def resolve(self, session_id: Optional[str], query: str, origin_harbour: str, target_pfz: str, client_history: List[Dict[str, str]]) -> Dict[str, Any]:
        self._evict()
        if not session_id:
            return {"origin_harbour": origin_harbour, "target_pfz": target_pfz, "history": client_history[-MAX_TURNS:], "carried_forward": False}
        session = self._sessions.setdefault(session_id, Session())
        session.touched_at = time.monotonic()
        explicit = self._entities_from(query, None, None)
        followup = bool(re.search(r"\b(that|it|there|tomorrow|still|same)\b", query, re.I))
        resolved_origin = explicit.get("origin_harbour") or (session.entities.get("origin_harbour") if followup else origin_harbour) or origin_harbour
        resolved_pfz = explicit.get("target_pfz") or (session.entities.get("target_pfz") if followup else target_pfz) or target_pfz
        history = (session.turns + client_history)[-MAX_TURNS:]
        return {"origin_harbour": resolved_origin, "target_pfz": resolved_pfz, "history": history, "carried_forward": followup and bool(session.entities)}

    def record(self, session_id: Optional[str], user_text: str, assistant_text: str, origin_harbour: str, target_pfz: str) -> None:
        if not session_id:
            return
        self._evict()
        session = self._sessions.setdefault(session_id, Session())
        session.touched_at = time.monotonic()
        session.turns.extend([{"role": "user", "text": user_text}, {"role": "assistant", "text": assistant_text}])
        session.turns = session.turns[-MAX_TURNS:]
        session.entities.update(self._entities_from(user_text, origin_harbour, target_pfz))

    def clear(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


session_store = SessionStore()
