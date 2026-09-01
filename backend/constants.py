"""
Plain constants with zero external dependencies, so modules that don't
otherwise need Pydantic/FastAPI (e.g. core.py, agents/*) can use these
defaults without pulling in the web-framework dependency chain.
"""

DEFAULT_HARBOUR_ID = "HBR-KOC"
DEFAULT_PFZ_ID = "PFZ-01"
MAX_QUERY_LENGTH = 500
