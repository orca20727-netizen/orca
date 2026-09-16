"""
Fisherman Opportunity Agent -- the ORCA Fisherman module's own agent,
following the same shape as agents/pfz_agent.py: load a dataset once at
startup (graceful fallback if the file is missing/corrupt), then compute
everything else on demand from live inputs handed in by the caller.

This agent deliberately does NOT fetch weather or PFZ data itself -- it is
composed in backend/api/routes.py from the SAME core.weather_agent and
core.pfz_agent results already used by the rest of the app, so a fisherman
checking "today's opportunity" and someone checking the Safety Barometer
for the same coordinates can never disagree about sea conditions or which
zone is currently best. The Opportunity Score is a weighted composite of:

    Ocean   25% -- today's Weather & Hazard Agent safety_score
    Fish    30% -- the top-ranked PFZ zone's yield_score_pct
    Market  20% -- species price momentum (vs previous price) + demand
    Profit  25% -- profit margin for that species at the current trip cost

All market/buyer/trip-history figures come from data/fisherman_market.json
and are simulated for Smart India Hackathon 2026 judging demonstration,
consistent with this app's own disclosed data sources (see index.html's
simulatedDisclaimer) -- but every number shown to the user (Opportunity
Score, Sell Smarter, performance trend) is computed from that file, never
a separately hardcoded figure.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import demand_intelligence
import price_trend

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

WEIGHT_OCEAN = 0.25
WEIGHT_FISH = 0.30
WEIGHT_MARKET = 0.20
WEIGHT_PROFIT = 0.25

DEMAND_BONUS = {"High": 15, "Medium": 0, "Low": -15}

# The PFZ zones dataset (data/pfz_zones.json) names dominant species in its
# own regional/common-name style -- "Indian Mackerel", "Sardines", "King
# Seerfish", "Yellowfin Tuna" -- which don't always literally match our
# five market species names. This alias table lets _species_matches() do a
# loose, case-insensitive match (aliases are the commercial/local names a
# fisherman would recognize for that market species) instead of requiring
# an exact string match, so "today's best zone's species" reliably lines
# up with a species we actually carry market data for.
SPECIES_ALIASES: Dict[str, List[str]] = {
    "Tuna": ["tuna"],
    "Pomfret": ["pomfret"],
    "Sardine": ["sardine", "sardines"],
    "Mackerel": ["mackerel"],
    "Kingfish": ["kingfish", "king seerfish", "seerfish", "vanjaram"],
}


def _species_matches(market_species: str, pfz_species_name: str) -> bool:
    """True if a PFZ zone's dominant-species label (e.g. "Indian Mackerel")
    refers to the same fish as one of our market species (e.g. "Mackerel")."""
    terms = SPECIES_ALIASES.get(market_species, [market_species.lower()])
    label = pfz_species_name.lower()
    return any(term in label for term in terms)

# Used only if data/fisherman_market.json can't be read (missing file,
# corrupted JSON) -- a single offline Tuna snapshot so the module degrades
# gracefully instead of the whole Fisherman tab erroring out.
FALLBACK_DATA: Dict[str, Any] = {
    "species_market": [
        {
            "species": "Tuna", "price_per_kg": 320, "prev_price_per_kg": 285,
            "demand": "High", "typical_informal_price_per_kg": 260,
            "catch_min_kg": 90, "catch_max_kg": 120,
            "buyer": {"name": "Seafood Restaurant Group", "qty_kg": 500, "price_min": 300, "price_max": 330, "deadline": "Tomorrow", "location": "Nearby Market"},
        }
    ],
    "default_trip_cost": {"fuel": 4200, "ice": 1200, "other": 600},
    "trip_history": [],
    "community_posts": [],
}


class FishermanOpportunityAgent:
    def __init__(self):
        self.name = "Fisherman Opportunity Agent"
        self._data, self._using_fallback = self._load_market()

    @staticmethod
    def _load_market() -> Tuple[Dict[str, Any], bool]:
        path = os.path.join(DATA_DIR, "fisherman_market.json")
        try:
            with open(path, "r") as f:
                data = json.load(f)
            if not data.get("species_market"):
                raise ValueError("fisherman_market.json contained no species_market")
            return data, False
        except Exception as e:
            logger.warning("Fisherman Opportunity Agent: falling back to offline market snapshot (%s)", e)
            return FALLBACK_DATA, True

    @staticmethod
    def _market_score(species: Dict[str, Any]) -> Tuple[float, float]:
        """Returns (market_score_0_100, price_change_pct)."""
        price, prev = species["price_per_kg"], species["prev_price_per_kg"]
        pct_change = ((price - prev) / prev * 100.0) if prev else 0.0
        score = 50.0 + pct_change * 2.0 + DEMAND_BONUS.get(species.get("demand"), 0)
        return max(0.0, min(100.0, score)), round(pct_change, 1)

    @staticmethod
    def _profit_for(species: Dict[str, Any], trip_cost_total: float) -> Dict[str, Any]:
        catch_min, catch_max, price = species["catch_min_kg"], species["catch_max_kg"], species["price_per_kg"]
        revenue_min, revenue_max = catch_min * price, catch_max * price
        profit_min, profit_max = revenue_min - trip_cost_total, revenue_max - trip_cost_total
        margin_pct = (profit_max / revenue_max * 100.0) if revenue_max else 0.0
        profit_score = max(0.0, min(100.0, margin_pct * 1.4))
        return {
            "catch_min_kg": catch_min, "catch_max_kg": catch_max,
            "revenue_min": round(revenue_min), "revenue_max": round(revenue_max),
            "trip_cost": round(trip_cost_total),
            "profit_min": round(profit_min), "profit_max": round(profit_max),
            "profit_score": profit_score,
        }

    def _rank_species(
        self,
        ocean_score: float,
        fish_score: float,
        trip_cost_total: float,
        live_price_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
        live_listings_by_species: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    ) -> List[Dict[str, Any]]:
        live_price_overrides = live_price_overrides or {}
        live_listings_by_species = live_listings_by_species or {}
        ranked = []
        for base in self._data["species_market"]:
            sp = dict(base)
            override = live_price_overrides.get(sp["species"])
            if override:
                # The old static/previous price becomes "previous" so
                # momentum (price_change_pct) still reflects a real change,
                # not a discontinuity from swapping data sources.
                sp["prev_price_per_kg"] = base["price_per_kg"]
                sp["price_per_kg"] = override["price_per_kg"]
                sp["price_source"] = override["source"]  # LIVE_AGMARKNET or STORED_SNAPSHOT
                sp["price_observed_at"] = override.get("observed_at")
                sp["price_market"] = override.get("market")
            else:
                sp["price_source"] = "SIMULATED_DEMO"

            real_listings = live_listings_by_species.get(sp["species"], [])
            if real_listings:
                live_buyer = real_listings[0]
                sp["buyer"] = {
                    "name": live_buyer["name"], "qty_kg": live_buyer["qty_kg"],
                    "price_min": live_buyer["price_min"], "price_max": live_buyer["price_max"],
                    "deadline": live_buyer["deadline"], "location": live_buyer["location"],
                }
                sp["buyer_source"] = "ORCA_BUYER_NETWORK"
            else:
                sp["buyer_source"] = "SIMULATED_DEMO"

            market_score, price_change_pct = self._market_score(sp)
            profit = self._profit_for(sp, trip_cost_total)
            composite = (
                WEIGHT_OCEAN * ocean_score
                + WEIGHT_FISH * fish_score
                + WEIGHT_MARKET * market_score
                + WEIGHT_PROFIT * profit["profit_score"]
            )

            price_trend_result = (
                price_trend.compute_price_trend(sp["species"])
                if sp["price_source"] != "SIMULATED_DEMO"
                else {"species": sp["species"], "status": "INSUFFICIENT_DATA", "reason": "Price is still simulated demo data", "classification": "CALCULATED"}
            )
            demand_result = demand_intelligence.compute_demand_score(sp["species"], real_listings, price_change_pct, sp.get("demand"))
            opportunity_result = demand_intelligence.compute_market_opportunity_score(demand_result["score"], sp["price_source"], price_change_pct)

            ranked.append({
                "species": sp["species"],
                "price_per_kg": sp["price_per_kg"],
                "prev_price_per_kg": sp["prev_price_per_kg"],
                "price_change_pct": price_change_pct,
                "price_source": sp["price_source"],
                "price_observed_at": sp.get("price_observed_at"),
                "price_trend": price_trend_result,
                "demand": sp["demand"],
                "demand_score": demand_result,
                "market_opportunity_score": opportunity_result,
                "buyer": sp["buyer"],
                "buyer_source": sp["buyer_source"],
                "real_listing_count": len(real_listings),
                "typical_informal_price_per_kg": sp["typical_informal_price_per_kg"],
                "ocean_score": round(ocean_score, 1),
                "fish_score": round(fish_score, 1),
                "market_score": round(market_score, 1),
                "profit_score": round(profit["profit_score"], 1),
                "composite_score": round(composite, 1),
                **{k: v for k, v in profit.items() if k != "profit_score"},
                "_real_listings": real_listings,  # internal only, stripped before response
            })
        ranked.sort(key=lambda r: r["composite_score"], reverse=True)
        return ranked

    def _performance(self) -> Dict[str, Any]:
        trips = self._data.get("trip_history") or []
        if not trips:
            return {"trips": [], "average_profit": 0, "trend_pct": 0, "insight": "No trip history recorded yet."}
        profits = [t["profit"] for t in trips]
        avg_profit = sum(profits) / len(profits)
        half = max(1, len(profits) // 2)
        first_half_avg = sum(profits[:half]) / half
        second_half = profits[-half:]
        second_half_avg = sum(second_half) / len(second_half)
        trend_pct = ((second_half_avg - first_half_avg) / first_half_avg * 100.0) if first_half_avg else 0.0
        direction = "up" if trend_pct >= 0 else "down"
        insight = (
            f"Average profit ₹{round(avg_profit):,} per trip, trending {direction} "
            f"{abs(round(trend_pct))}% over your last {len(trips)} trips."
        )
        return {
            "trips": trips,
            "average_profit": round(avg_profit),
            "trend_pct": round(trend_pct, 1),
            "insight": insight,
        }

    async def build_dashboard(
        self,
        weather: Dict[str, Any],
        pfz: Dict[str, Any],
        preferred_species: Optional[str] = None,
        live_price_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
        live_buyer_listings: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        cost = self._data["default_trip_cost"]
        trip_cost_total = float(sum(cost.values()))

        ocean_score = float(weather.get("safety_score", 70))
        fish_score = float(pfz.get("yield_score_pct", 70))

        # Real Buyer Network listings win over the static demo buyer for a
        # species (grouped so demand scoring can see every open listing,
        # not just one; the display "buyer" field still shows just the
        # first, matching this app's existing "one buyer per species" shape
        # with zero render changes).
        live_listings_by_species: Dict[str, List[Dict[str, Any]]] = {}
        for listing in (live_buyer_listings or []):
            live_listings_by_species.setdefault(listing["species"], []).append(listing)

        ranked = self._rank_species(
            ocean_score, fish_score, trip_cost_total,
            live_price_overrides=live_price_overrides,
            live_listings_by_species=live_listings_by_species,
        )
        by_name = {r["species"]: r for r in ranked}

        # Prefer whichever dominant species of the top-recommended PFZ zone
        # we actually carry market data for, so the "best opportunity" card
        # matches the same zone the GIS Command Map / Safety Barometer are
        # already recommending -- falls back to the top-ranked species on
        # pure Opportunity Score if none of that zone's species are in our
        # market dataset, and to an explicit ?species= override if given.
        # Matching is alias-based (see SPECIES_ALIASES / _species_matches)
        # since the PFZ dataset's species labels ("Indian Mackerel", "King
        # Seerfish") don't always literally match our market species names.
        #
        # Among however many of that zone's dominant species we have market
        # data for, pick whichever actually has the HIGHEST composite
        # Opportunity Score -- not just whichever happens to be listed
        # FIRST in the zone's dominant_species array. The earlier version of
        # this picked the first list match unconditionally, which meant the
        # "best opportunity" was effectively pinned to whatever species a
        # PFZ zone's dataset happens to name first (e.g. PFZ-01 always lists
        # "Indian Mackerel" before "Yellowfin Tuna"/"Sardines"), regardless
        # of that species' actual score -- confirmed live: Tuna scored 87.1
        # and Mackerel only 84.8 for the same request, yet Mackerel was the
        # one shown, every time PFZ-01 was the top zone (which is most of
        # the time). This still keeps the zone-consistency guarantee (only
        # recommends a species genuinely found in the top-recommended zone)
        # while actually reflecting which of those species is winning today.
        best = None
        if preferred_species and preferred_species in by_name:
            best = by_name[preferred_species]
        else:
            zone_species_names = {
                m for sp_name in (pfz.get("dominant_species") or [])
                for m in by_name if _species_matches(m, sp_name)
            }
            if zone_species_names:
                best = max((by_name[m] for m in zone_species_names), key=lambda r: r["composite_score"])
        if best is None:
            best = ranked[0]

        catch_mid = round((best["catch_min_kg"] + best["catch_max_kg"]) / 2)
        sell_smarter_extra = round((best["price_per_kg"] - best["typical_informal_price_per_kg"]) * catch_mid)

        confidence_pct = 80
        if weather.get("status") not in ("SKIPPED", "DEGRADED_AGENT_FAILURE"):
            confidence_pct += 10
        if not self._using_fallback:
            confidence_pct += 7
        confidence_pct = min(97, confidence_pct)

        best_buyer_recommendation = demand_intelligence.recommend_best_buyer(
            species=best["species"],
            current_price_per_kg=best["price_per_kg"],
            price_source=best["price_source"],
            real_listings_for_species=best["_real_listings"],
            static_buyer=best["buyer"],
            trip_cost_total=best["trip_cost"],
            catch_kg=catch_mid,
        )

        # Internal-only field used above to build the recommendation --
        # strip it before the ranking goes out over the wire.
        for r in ranked:
            r.pop("_real_listings", None)

        return {
            "opportunity": {
                "recommended_species": best["species"],
                "top_recommended_pfz": pfz.get("top_recommended_pfz"),
                "distance_from_vessel_nm": pfz.get("distance_from_vessel_nm"),
                "price_per_kg": best["price_per_kg"],
                "catch_min_kg": best["catch_min_kg"],
                "catch_max_kg": best["catch_max_kg"],
                "revenue_min": best["revenue_min"],
                "revenue_max": best["revenue_max"],
                "trip_cost": best["trip_cost"],
                "profit_min": best["profit_min"],
                "profit_max": best["profit_max"],
                "confidence_pct": confidence_pct,
                "composite_score": best["composite_score"],
                "price_source": best["price_source"],
                "price_observed_at": best.get("price_observed_at"),
                "demand_score": best["demand_score"],
                "market_opportunity_score": best["market_opportunity_score"],
                "best_buyer_recommendation": best_buyer_recommendation,
                "score_breakdown": {
                    "ocean": {"weight": WEIGHT_OCEAN, "score": best["ocean_score"]},
                    "fish": {"weight": WEIGHT_FISH, "score": best["fish_score"]},
                    "market": {"weight": WEIGHT_MARKET, "score": best["market_score"]},
                    "profit": {"weight": WEIGHT_PROFIT, "score": best["profit_score"]},
                },
            },
            "ranking": ranked,
            "sell_smarter": {
                "species": best["species"],
                "typical_price_per_kg": best["typical_informal_price_per_kg"],
                "opportunity_price_per_kg": best["price_per_kg"],
                "assumed_catch_kg": catch_mid,
                "potential_additional_revenue": sell_smarter_extra,
            },
            "trip_calculator_defaults": {
                "species": best["species"],
                "catch_kg": catch_mid,
                "price_per_kg": best["price_per_kg"],
                "fuel_cost": cost["fuel"],
                "ice_cost": cost["ice"],
                "other_cost": cost["other"],
            },
            "buyers": [
                {"species": r["species"], "buyer_source": r["buyer_source"], **r["buyer"]} for r in ranked
            ],
            "performance": self._performance(),
            "community_posts": self._data.get("community_posts", []),
            "data_source": self._data_source_summary(ranked),
        }

    @staticmethod
    def _data_source_summary(ranked: List[Dict[str, Any]]) -> str:
        """Honest, at-a-glance summary of how many of the 5 tracked species
        currently have a real price/buyer vs. the simulated demo defaults --
        shown verbatim in the frontend's LIVE status badge, so this must
        never claim "live" when nothing live actually came through."""
        live_prices = sum(1 for r in ranked if r["price_source"] in ("LIVE_AGMARKNET", "STORED_SNAPSHOT"))
        live_buyers = sum(1 for r in ranked if r["buyer_source"] == "ORCA_BUYER_NETWORK")
        total = len(ranked)
        if live_prices == 0 and live_buyers == 0:
            return "SIMULATED_DEMO (no live price or buyer data configured yet)"
        return f"MIXED -- prices: {live_prices}/{total} live, buyers: {live_buyers}/{total} real listings (rest simulated demo)"
