"""
ORCA Buyer Network -- real, stored buyer requirements for the Fisherman
module's "Buyer Leads" feature, per the Step 7 buyer-marketplace scope doc.

Deliberately reuses the SAME SQLite database live_data.py already created
(data/orca_live.db) rather than introducing new infrastructure, per the
project's own instruction to reuse the existing store.

Distinction this module exists to enforce: a restaurant/business showing
up near a fisherman on a map (restaurant_discovery.py) is NOT a buyer
requirement. Only a row in buyer_listings, created by a phone/email-
verified Buyer, is ever surfaced as a "Buyer Lead" -- nothing here is ever
fabricated or inferred from map data.

v1 scope, matching the original design doc:
  - OTP-only auth (no passwords) -- a Buyer is a verified contact, not a
    rich account.
  - Single-claim-closes-listing (no partial-quantity fulfillment tracking).
  - No payments anywhere in this flow -- ORCA connects, it never mediates
    money. The claim step ends with a fisherman contact recorded against
    the listing; the two parties transact off-platform.
  - Verification delivery: if SMTP_* env vars are configured, the OTP is
    actually emailed. If not, it is returned directly in the API response
    (clearly tagged DEV_MODE_OTP_IN_RESPONSE) so the whole flow is still
    genuinely testable/demoable without requiring email infrastructure --
    never silently treated as "sent" when it wasn't.
"""

import logging
import os
import random
import smtplib
import sqlite3
import time
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "orca_live.db"  # same file live_data.py uses

OTP_TTL_SECONDS = 10 * 60
TRACKED_SPECIES = ("Tuna", "Pomfret", "Sardine", "Mackerel", "Kingfish")


def _now() -> float:
    return time.time()


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS buyers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            contact_email TEXT NOT NULL,
            location TEXT,
            verified_at REAL,
            created_at REAL NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS buyer_otps (
            buyer_id INTEGER PRIMARY KEY,
            code TEXT NOT NULL,
            expires_at REAL NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS buyer_listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id INTEGER NOT NULL,
            species TEXT NOT NULL,
            required_qty_kg REAL NOT NULL,
            price_min REAL,
            price_max REAL,
            deadline TEXT,
            location TEXT,
            status TEXT NOT NULL DEFAULT 'OPEN',
            created_at REAL NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS buyer_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            fisherman_contact TEXT NOT NULL,
            claimed_qty_kg REAL,
            created_at REAL NOT NULL
        )""")


def _send_otp_email(to_email: str, code: str) -> bool:
    host, port = os.getenv("SMTP_HOST", "").strip(), os.getenv("SMTP_PORT", "").strip()
    user, password = os.getenv("SMTP_USER", "").strip(), os.getenv("SMTP_PASSWORD", "").strip()
    if not (host and port and user and password):
        return False
    try:
        msg = MIMEText(f"Your ORCA Buyer Network verification code is: {code}\nExpires in 10 minutes.")
        msg["Subject"] = "ORCA Buyer Network -- verification code"
        msg["From"] = user
        msg["To"] = to_email
        with smtplib.SMTP(host, int(port), timeout=10) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(user, [to_email], msg.as_string())
        return True
    except Exception as exc:
        logger.warning("buyer_network: OTP email send failed (%s), falling back to dev-mode response", exc)
        return False


def register_buyer(business_name: str, contact_email: str, location: Optional[str]) -> Dict[str, Any]:
    code = f"{random.randint(0, 999999):06d}"
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO buyers(business_name, contact_email, location, verified_at, created_at) VALUES (?,?,?,NULL,?)",
            (business_name, contact_email, location, _now()),
        )
        buyer_id = cur.lastrowid
        conn.execute(
            "INSERT OR REPLACE INTO buyer_otps(buyer_id, code, expires_at) VALUES (?,?,?)",
            (buyer_id, code, _now() + OTP_TTL_SECONDS),
        )

    emailed = _send_otp_email(contact_email, code)
    result = {"buyer_id": buyer_id, "verification_required": True}
    if emailed:
        result["delivery"] = "EMAILED"
    else:
        result["delivery"] = "DEV_MODE_OTP_IN_RESPONSE (SMTP not configured)"
        result["dev_otp"] = code
    return result


def verify_buyer(buyer_id: int, code: str) -> Dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT code, expires_at FROM buyer_otps WHERE buyer_id=?", (buyer_id,)).fetchone()
        if not row:
            return {"verified": False, "reason": "No pending verification for this buyer_id"}
        if _now() > row["expires_at"]:
            return {"verified": False, "reason": "Code expired"}
        if row["code"] != code.strip():
            return {"verified": False, "reason": "Incorrect code"}
        conn.execute("UPDATE buyers SET verified_at=? WHERE id=?", (_now(), buyer_id))
        conn.execute("DELETE FROM buyer_otps WHERE buyer_id=?", (buyer_id,))
    return {"verified": True}


def _is_verified(conn: sqlite3.Connection, buyer_id: int) -> bool:
    row = conn.execute("SELECT verified_at FROM buyers WHERE id=?", (buyer_id,)).fetchone()
    return bool(row and row["verified_at"])


def create_listing(buyer_id: int, species: str, required_qty_kg: float, price_min: Optional[float],
                    price_max: Optional[float], deadline: Optional[str], location: Optional[str]) -> Dict[str, Any]:
    if species not in TRACKED_SPECIES:
        return {"created": False, "reason": f"species must be one of {TRACKED_SPECIES}"}
    with _conn() as conn:
        if not _is_verified(conn, buyer_id):
            return {"created": False, "reason": "Buyer is not verified"}
        cur = conn.execute(
            """INSERT INTO buyer_listings(buyer_id, species, required_qty_kg, price_min, price_max, deadline, location, status, created_at)
               VALUES (?,?,?,?,?,?,?, 'OPEN', ?)""",
            (buyer_id, species, required_qty_kg, price_min, price_max, deadline, location, _now()),
        )
    return {"created": True, "listing_id": cur.lastrowid}


def list_listings(species: Optional[str] = None, status: str = "OPEN") -> List[Dict[str, Any]]:
    """Returns listings mapped onto the SAME shape the frontend's existing
    FishermanBuyer rendering already expects (name/species/qty_kg/price_min/
    price_max/deadline/location), plus isSimulated:false and a listing id --
    additive fields the existing render function simply ignores."""
    query = """SELECT bl.*, b.business_name FROM buyer_listings bl
               JOIN buyers b ON b.id = bl.buyer_id WHERE 1=1"""
    params: List[Any] = []
    if species:
        query += " AND bl.species = ?"
        params.append(species)
    if status:
        query += " AND bl.status = ?"
        params.append(status)
    query += " ORDER BY bl.created_at DESC"
    with _conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [
        {
            "listing_id": r["id"],
            "species": r["species"],
            "name": r["business_name"],
            "qty_kg": r["required_qty_kg"],
            "price_min": r["price_min"],
            "price_max": r["price_max"],
            "deadline": r["deadline"],
            "location": r["location"],
            "status": r["status"],
            "isSimulated": False,
            "source": "ORCA_BUYER_NETWORK",
        }
        for r in rows
    ]


def claim_listing(listing_id: int, fisherman_contact: str, claimed_qty_kg: Optional[float]) -> Dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT status FROM buyer_listings WHERE id=?", (listing_id,)).fetchone()
        if not row:
            return {"claimed": False, "reason": "Listing not found"}
        if row["status"] != "OPEN":
            return {"claimed": False, "reason": f"Listing is {row['status']}, not OPEN"}
        conn.execute(
            "INSERT INTO buyer_claims(listing_id, fisherman_contact, claimed_qty_kg, created_at) VALUES (?,?,?,?)",
            (listing_id, fisherman_contact, claimed_qty_kg, _now()),
        )
        # v1 simplification (per the original scope doc): a single claim
        # closes the listing -- no partial-fulfillment tracking yet.
        conn.execute("UPDATE buyer_listings SET status='CLAIMED' WHERE id=?", (listing_id,))
    return {"claimed": True, "listing_id": listing_id}
