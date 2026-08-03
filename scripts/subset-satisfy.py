#!/usr/bin/env python3
"""Regenerate the inlined Satisfy @font-face in public/index.html.

Satisfy is embedded as a base64 data URI rather than fetched, so it is present
at first paint with no request and no font-display race. Run this after
changing the glyph set; it rewrites the @font-face block in place.

    pip install fonttools brotli
    python scripts/subset-satisfy.py
"""
import base64, io, os, re, sys
from fontTools import subset

SRC = 'fonts-src/satisfy-latin.woff2'   # full face, kept out of public/
HTML = 'public/index.html'

# Satisfy renders .nav-logo, h1 and section h2 — including journal post titles,
# so the set covers all French accents, ligatures and typographic punctuation.
CHARS = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    " .,!?;:'\"()-\u2013\u2014\u2026\u00ab\u00bb\u2019\u2018\u201c\u201d/&%+\u00b0"
    "\u00c0\u00c2\u00c4\u00c7\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc\u0178\u00c6\u0152"
    "\u00e0\u00e2\u00e4\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00ff\u00e6\u0153"
)

BLOCK_RE = re.compile(
    r"      /\* Satisfy is inlined.*?\*/\n      @font-face \{\n"
    r"        font-family: 'Satisfy';.*?\n      \}", re.S)

def main():
    opts = subset.Options(flavor='woff2', desubroutinize=True, layout_features=['*'])
    f = subset.load_font(SRC, opts)
    s = subset.Subsetter(options=opts)
    s.populate(unicodes=sorted({ord(c) for c in CHARS}))
    s.subset(f)
    buf = io.BytesIO()
    subset.save_font(f, buf, opts)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')

    new = (
        "      /* Satisfy is inlined as base64 so it is available at first paint with\n"
        "         no request and no font-display race. Regenerate with\n"
        "         scripts/subset-satisfy.py; full face lives in fonts-src/. */\n"
        "      @font-face {\n"
        "        font-family: 'Satisfy';\n"
        "        font-style: normal;\n"
        "        font-weight: 400;\n"
        "        font-display: block;\n"
        f"        src: url('data:font/woff2;base64,{b64}') format('woff2');\n"
        "        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215;\n"
        "      }")

    html = open(HTML, encoding='utf-8').read()
    if not BLOCK_RE.search(html):
        sys.exit("ERROR: inlined Satisfy @font-face block not found — nothing written.")
    out = BLOCK_RE.sub(lambda m: new, html, count=1)
    open(HTML, 'w', encoding='utf-8', newline='').write(out)
    print(f"subset {len(buf.getvalue()):,} B -> base64 {len(b64):,} chars; {HTML} now {len(out):,} B")

if __name__ == '__main__':
    main()
