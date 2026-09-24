"""Name normalization, display casing and slugs."""

from __future__ import annotations

import re
import unicodedata

# Words kept upper-case when proper-casing DOHMH's ALL-CAPS names.
ACRONYMS = {
    "NYC", "NY", "BBQ", "USA", "LES", "UWS", "UES", "JFK", "LGA", "II", "III", "IV", "MLB", "KX", "KO",
    "BK", "DJ", "TV", "PJ", "KFC", "NJ", "LIC", "DUMBO", "SLDR", "IHOP", "BLT", "NBA", "NFL", "UFC", "EWR",
}
# Whole words with non-trivial casing.
SPECIAL_WORDS = {
    "SOHO": "SoHo", "NOHO": "NoHo", "NOLITA": "NoLita", "TRIBECA": "Tribeca", "BURGERFI": "BurgerFi",
    "BAREBURGER": "Bareburger", "SMASHBURGER": "Smashburger", "SMASHBURGERS": "Smashburgers",
}
SMALL_WORDS = {"a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "n", "y", "de", "del"}

# normalized name -> display name, for brands whose casing rules can't guess.
DISPLAY_OVERRIDES = {
    "mcdonalds": "McDonald's",
    "burgerfi": "BurgerFi",
    "bareburger": "Bareburger",
    "7th street burger": "7th Street Burger",
    "sonic drive in": "Sonic Drive-In",
    "wendys": "Wendy's",
    "burger king popeyes": "Burger King",
    "five guys famous burgers and fries": "Five Guys",
    "five guys burgers and fries": "Five Guys",
    "the famous jimbos hamburger palace": "Jimbo's Hamburger Palace",
    "pat lafriedas burgers and fries": "Pat LaFrieda's Burgers & Fries",
    "custom burgers pat la frieda": "Custom Burgers Pat LaFrieda",
    "bills bar and burger downtown": "Bill's Bar & Burger Downtown",
}


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm_name(s: str | None) -> str:
    """Lowercase ascii, '&' -> 'and', apostrophes dropped, other punctuation -> space."""
    s = ascii_fold(s or "").lower()
    s = s.replace("&", " and ").replace("+", " and ")
    s = re.sub(r"['’`´]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_store_number(s: str) -> str:
    """'MCDONALD'S #13068' -> "MCDONALD'S"; "WENDY'S (CONCOURSE F)" -> "WENDY'S"."""
    s = re.sub(r"\s*#\s*\d+\w*", "", s or "")
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    s = re.sub(r"\s+-\s+food court$", "", s, flags=re.I)
    return s.strip(" -,")


def slugify(s: str | None) -> str:
    s = ascii_fold(s or "").lower().replace("&", " and ")
    s = re.sub(r"['’`´]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _case_word(w: str, first: bool) -> str:
    letters = re.sub(r"[^A-Za-z0-9]", "", w).upper()
    if letters in SPECIAL_WORDS:
        return SPECIAL_WORDS[letters]
    if letters in ACRONYMS and "'" not in w:
        return w.upper()
    if re.fullmatch(r"\d+(ST|ND|RD|TH)", w.upper()):
        return w.lower()
    lw = w.lower()
    if not first and letters.lower() in SMALL_WORDS and letters:
        return lw
    m = re.match(r"^([^a-z]*)mc([a-z])(.+)$", lw)
    if m and len(letters) > 3:
        return f"{m.group(1)}Mc{m.group(2).upper()}{m.group(3)}"
    if re.match(r"^o'[a-z]", lw):
        return "O'" + lw[2].upper() + lw[3:]
    idx = next((i for i, c in enumerate(lw) if c.isalpha()), None)
    if idx is None:
        return lw
    return lw[:idx] + lw[idx].upper() + lw[idx + 1 :]


def display_case(s: str | None) -> str:
    """Proper-case an ALL-CAPS string; mixed-case input is returned untouched."""
    s = re.sub(r"\s+", " ", (s or "").strip())
    if not s or any(c.islower() for c in s):
        return s
    parts = re.split(r"(\s+|/|-)", s)
    out, first = [], True
    for p in parts:
        if not p or p.isspace() or p in ("/", "-"):
            out.append(p)
            continue
        out.append(_case_word(p, first))
        first = False
    return "".join(out)


def display_name(dba: str | None) -> str:
    """Display name for a DOHMH dba: store numbers stripped, sensible casing, brand overrides."""
    base = strip_store_number(dba or "")
    base = re.sub(r"^HAMBURGERS?,\s*", "", base, flags=re.I)  # stadium stands: 'HAMBURGER, DAILY BURGER'
    base = re.sub(r"\s*\b[A-Z]{1,3}\d{3,}\b", "", base).strip(" ,")  # concession codes like FB6030
    override = DISPLAY_OVERRIDES.get(norm_name(base))
    if override:
        return override
    return display_case(base)


# Street-address words folded to one spelling, so '383 West 31 Street' (DOHMH) and
# '383 W 31st St' (a menu page) compare equal.
_ADDRESS_WORDS = {
    "west": "w", "east": "e", "north": "n", "south": "s", "street": "st", "avenue": "ave", "av": "ave",
    "road": "rd", "boulevard": "blvd", "place": "pl", "drive": "dr", "parkway": "pkwy", "lane": "ln",
    "first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5", "sixth": "6", "seventh": "7",
    "eighth": "8", "ninth": "9", "tenth": "10",
}


def address_tokens(s: str | None) -> list[str]:
    """'383 West 31st Street, Unit 31' -> ['383', 'w', '31', 'st', 'unit', '31']."""
    s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", r"\1", norm_name(s))
    return [_ADDRESS_WORDS.get(w, w) for w in s.split()]


def address_in_text(address: str | None, text: str | None) -> bool:
    """True when `text` names this street address: the house number followed by the same street
    ('383 West 31 Street' in '383 west 31st street, unit 31, new york, ny 10001'; '320 West 36
    Street' in 'burger joint at 320 W 36th'). Compares the number and the next two words."""
    a = address_tokens(address)
    if len(a) < 2 or not a[0].isdigit():
        return False
    key = a[:3]
    t = address_tokens(text)
    return any(t[i:i + len(key)] == key for i in range(len(t) - len(key) + 1))
