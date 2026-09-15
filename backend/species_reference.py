"""
Static fish-species reference data for the ORCA Fisherman module's five
tracked species (Tuna, Pomfret, Sardine, Mackerel, Kingfish).

This is DATABASE DATA, not LIVE DATA -- there is no live/queryable public
API for Indian fish-species biology (NFDB/CMFRI publish this as documents
and reports, not a structured feed), so this is a hand-compiled reference
table sourced from established fisheries science (CMFRI species
identification records, FAO species fact sheets), not invented. Every
field is a well-documented, non-controversial biological fact about the
species; nothing here is a live reading or an estimate.

"Tuna" and "Kingfish" are commercial/market names covering more than one
scientific species landed under that name in Indian markets -- rather than
assert a single false-precise species, both fields are listed where more
than one is commonly landed, which is the biologically accurate answer.
"""

from typing import Any, Dict

SPECIES_REFERENCE: Dict[str, Dict[str, Any]] = {
    "Tuna": {
        "common_name": "Tuna",
        "scientific_name": ["Thunnus albacares (Yellowfin tuna)", "Katsuwonus pelamis (Skipjack tuna)"],
        "local_names": {"Malayalam": "Choora", "Tamil": "Soorai", "Kannada": "Kera Meenu"},
        "water_type": "Marine",
        "habitat": "Pelagic (open ocean, surface to mid-water); commercially caught offshore and around Fish Aggregating Devices (FADs)",
        "seasonality": "Landed year-round on India's west coast; peak season roughly August-March, off-monsoon",
        "notes": "India's largest tuna landings are yellowfin and skipjack; both are sold generically as 'Tuna' at most Indian markets",
    },
    "Pomfret": {
        "common_name": "Silver Pomfret",
        "scientific_name": "Pampus argenteus",
        "local_names": {"Malayalam": "Avoli", "Tamil": "Vavval", "Hindi": "Paplet/Saranga"},
        "water_type": "Marine",
        "habitat": "Demersal to semi-pelagic, coastal waters over sandy/muddy bottoms",
        "seasonality": "Peak season September-February on India's west coast; scarcer during the monsoon fishing ban (roughly June-July)",
        "notes": "One of India's highest-value food fish; Black Pomfret (Parastromateus niger) is a separate, lower-value species sometimes marketed under the same name",
    },
    "Sardine": {
        "common_name": "Indian Oil Sardine",
        "scientific_name": "Sardinella longiceps",
        "local_names": {"Malayalam": "Mathi", "Tamil": "Mathi/Chala", "Kannada": "Bootai/Tarle"},
        "water_type": "Marine",
        "habitat": "Pelagic, forms large surface schools in coastal waters, especially along the southwest coast",
        "seasonality": "Major fishery August-December (post-monsoon); catches are historically known to fluctuate sharply year to year",
        "notes": "India's single largest-volume marine fishery by weight; a keystone species for Kerala/Karnataka's coastal economy",
    },
    "Mackerel": {
        "common_name": "Indian Mackerel",
        "scientific_name": "Rastrelliger kanagurta",
        "local_names": {"Malayalam": "Ayala", "Tamil": "Kanangeluthi", "Kannada": "Bangda"},
        "water_type": "Marine",
        "habitat": "Pelagic, coastal schooling species, typically inshore waters",
        "seasonality": "Peak season August-October and again December-January on the southwest coast; closed during the monsoon trawl ban",
        "notes": "Second only to oil sardine in landed volume along India's west coast",
    },
    "Kingfish": {
        "common_name": "Seer Fish / Kingfish",
        "scientific_name": ["Scomberomorus commerson (Narrow-barred Spanish mackerel)", "Scomberomorus guttatus (Indo-Pacific king mackerel)"],
        "local_names": {"Malayalam": "Neymeen", "Tamil": "Vanjaram", "Telugu": "Iralu"},
        "water_type": "Marine",
        "habitat": "Pelagic predator, coastal and offshore waters",
        "seasonality": "Landed year-round; historically commands the highest per-kg price of any commonly landed Indian food fish",
        "notes": "'Vanjaram'/'Neymeen' in Indian markets most often refers to S. commerson specifically, the larger and more valuable of the two",
    },
}

SOURCE_NOTE = (
    "Compiled from established fisheries-science references (CMFRI species "
    "identification records, FAO species fact sheets) -- a static reference "
    "table, not a live feed. No official structured/queryable API for "
    "Indian fish-species biology exists at NFDB or elsewhere."
)


def get_species_reference() -> Dict[str, Any]:
    return {
        "species": SPECIES_REFERENCE,
        "classification": "DATABASE_DATA",
        "source": SOURCE_NOTE,
    }
