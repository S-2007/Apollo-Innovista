"""Small text helpers shared by the writer, assembler, verifier, and checker.

- Citations are always stored in the canonical form [S3][S7]. normalize_citations
  rewrites LLM variants like "[S3, S7]" or "[S3; S7]" into that form.
- split_sentences is a simple regex splitter (good enough for report prose). It
  also re-attaches a citation that the LLM put after the full stop
  ("... grew 20%. [S2]") to the sentence it belongs to.
"""

import re

CITE = re.compile(r"\[(S\d+)\]")
_GROUP = re.compile(r"\[\s*(S\d+(?:\s*[,;]\s*S\d+)+)\s*\]")
_LEFTOVER = re.compile(r"\[[^\]]*\bS\d+\b[^\]]*\]")  # e.g. "[S1-S3]" or "[source S2]"
_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_LEADING_CITES = re.compile(r"^((?:\[S\d+\]\s*)+)(.*)$", re.DOTALL)
NOT_FOUND = "not found in sources"
# A section the LLM could not write (every model failed). Deliberately NOT the NOT_FOUND phrase:
# the sources may well answer the question; the report must not claim they do not.
WRITE_FAILED = "Section not written: the language model was unavailable, so the retrieved sources for this sub-question were not summarised."
# LLM variants such as "not found in the provided sources" are rewritten to the exact phrase.
_NOT_FOUND_VARIANTS = re.compile(r"not found in (?:the )?(?:provided |given |retrieved |available )?sources?\b", re.I)
# Sentences whose SUBJECT is the sources' silence ("The sources do not specify X", "No data on X was
# found"). Deliberately narrow: an uncited factual negative ("AI apps do not raise yields") must not match.
_ABSENCE = re.compile(
    r"^(?:however,?\s*|but\s+)?(?:the (?:provided |available |given |retrieved )?sources|none of the sources|"
    r"no (?:specific |further |additional )?(?:information|data|details|evidence|figures|studies))\b",
    re.I,
)


def mark_absence(sentence: str) -> str:
    """Make an "the sources do not say X" sentence carry the exact NOT_FOUND phrase."""
    if NOT_FOUND in sentence.lower() or not _ABSENCE.match(sentence):
        return sentence
    return sentence.rstrip(" .") + f": {NOT_FOUND}."


def normalize_citations(text: str) -> str:
    text = _GROUP.sub(lambda m: "".join(f"[{i}]" for i in re.split(r"\s*[,;]\s*", m.group(1))), text)
    return _LEFTOVER.sub(lambda m: m.group(0) if CITE.fullmatch(m.group(0)) else "", text)


def normalize_not_found(text: str) -> str:
    return _NOT_FOUND_VARIANTS.sub(lambda m: NOT_FOUND.capitalize() if m.group(0)[0].isupper() else NOT_FOUND, text)


def find_citations(text: str) -> list[str]:
    """Cited ids in order of first appearance, without duplicates."""
    return list(dict.fromkeys(CITE.findall(text)))


def strip_citations(text: str) -> str:
    return re.sub(r"\s+", " ", CITE.sub("", text)).strip()


def split_sentences(text: str) -> list[str]:
    out: list[str] = []
    for part in _SPLIT.split(text):
        part = part.strip().lstrip("-*• ").strip()
        if not part:
            continue
        m = _LEADING_CITES.match(part)
        if m and out:
            out[-1] = f"{out[-1]} {m.group(1).strip()}"
            part = m.group(2).strip()
            if not part:
                continue
        out.append(part)
    return out


def sentence_key(sentence: str) -> str:
    """Normalised form used to detect duplicate sentences."""
    return re.sub(r"[^a-z0-9 ]", "", strip_citations(sentence).lower())


def int_id(source_id: str) -> int:
    return int(source_id[1:])
