"""Inline src/*.css and src/*.js into one self-contained HTML file.

Usage:  python tools/build_single.py            -> dist/suspectra.html (full document)
        python tools/build_single.py --fragment -> dist/fragment.html (no <html>/<head>/<body>)
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")

def inline_css(m):
    return "<style>\n" + (root / m.group(1)).read_text(encoding="utf-8") + "\n</style>"

def inline_js(m):
    return "<script>\n" + (root / m.group(1)).read_text(encoding="utf-8") + "\n</script>"

html = re.sub(r'<link rel="stylesheet" href="(src/[^"]+)">', inline_css, html)
html = re.sub(r'<script src="(src/[^"]+)"></script>', inline_js, html)

out = root / "dist"
out.mkdir(exist_ok=True)
if "--fragment" in sys.argv:
    head = html.split("<!-- BUILD:CONTENT-START -->")[1].split("<!-- BUILD:HEAD-END -->")[0]
    body = html.split("<body>")[1].split("<!-- BUILD:CONTENT-END -->")[0]
    (out / "fragment.html").write_text(head + body, encoding="utf-8")
    print("wrote dist/fragment.html")
else:
    (out / "suspectra.html").write_text(html, encoding="utf-8")
    print("wrote dist/suspectra.html")
