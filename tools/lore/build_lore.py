"""Builds the Reference page's lore Archive from the fan translations.

Reads the translated Markdown in Project-Documents (outside this repo) and writes
  data/lore.json        one entry per piece, story and notes already as HTML
  assets/lore/*.webp    the four pictures that came with the translations

Run from anywhere:  python tools/lore/build_lore.py
Needs the `markdown` and `Pillow` packages.
"""

import html
import json
import os
import re
import sys

import markdown
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
LORE = os.path.normpath(os.path.join(REPO, "..", "Project-Documents", "New Ember Resources", "Lore"))
SRC = os.path.join(LORE, "Translated")
IMAGES = os.path.join(LORE, "tools", "images")
OUT_JSON = os.path.join(REPO, "data", "lore.json")
OUT_IMG = os.path.join(REPO, "assets", "lore")

# The site's faction name wins over the glossary's (OTTO, 2026-11-05).
NAMES = [
    ("Revival and Development League", "Reconstruction Development League"),
    ("Revival League", "Reconstruction Development League"),
]

OPV = "opv-diagram"

# Shelf order is the Archive's order. `art` is the tile and reader picture; a
# piece without one gets `quote` as its tile cover instead.
PIECES = [
    {
        "slug": "chronology", "layout": "timeline", "file": "EMBER World Chronology (681837bd4f56912a.png).md",
        "shelf": "featured", "kicker": "Start here · The world", "zh": "月尘 · 黑曜协议 · 纪年表",
        "art": "chronology-banner", "factions": ["RDL", "UN", "GOF"],
        "hook": "In 1910 a small family factory makes bandages for a war. A century later its heirs "
                "hold the keys to the human mind, and the Moon has become a battlefield.",
    },
    {
        "slug": "relics",
        "pulls": [("The appearance of the Relics shook the whole human world",
                   "From here on, breaking the reactor is about as easy as smashing the chief's head in with a water pipe. "
                   "The hard part is telling which one you are doing.",
                   "Stephen Vinge, Lunar Management Committee")], "file": "Relics and Black Boxes (遗迹与黑箱).md",
        "shelf": "world", "kicker": "Background", "zh": "遗迹与黑箱",
        "quote": "We are like a band of apemen who have just learned to make tools…",
        "hook": "A probe photographs the far side of the Moon and sees something that was built. "
                "Humanity goes inside, and starts taking things apart.",
    },
    {
        "slug": "obsidian-protocol",
        "pulls": [("Far more people simply doubted it", "The will is sacred, down with Obsidian.", "Sharwen chant"),
                  ("Supporters of the Leighton Group",
                   "Anthony is a dreamer who wants to drive civilization forward through technology.",
                   "Leighton's supporters")], "file": "The Obsidian Protocol (黑曜协议).md",
        "shelf": "world", "kicker": "Background", "zh": "黑曜协议",
        "quote": "OPV4 formally meant that humans could discard their native brain entirely.",
        "hook": "A young intern walks into a forgotten Relic and comes back changed. Within twenty "
                "years, anyone can leave their body behind.",
    },
    {
        "slug": "soup",
        "pulls": [("This condensed-matter black box",
                   "From “waking” and “tuning” to “steeping” and then “tie-dyeing.”", None),
                  ("Thanks to its excellent general-purpose design",
                   "Many users feel that they have “died and come back to life.”", None)], "file": "SOUP, Theseus and Achilles (SOUP、忒修斯与阿喀琉斯).md",
        "shelf": "world", "kicker": "Background", "zh": "SOUP、忒修斯与阿喀琉斯", "art": OPV,
        "hook": "A black liquid found in the Relics learns to think. Two roads follow: rebuild the "
                "brain piece by piece, or leave it behind for good.",
        "figures": [(r"<p><em>\(Image caption:\)</em>.*?</p>", OPV,
                     "The Theseus and Achilles processes. Diagram by Discord community member “ωistar!α”.")],
    },
    {
        "slug": "camping",
        "pulls": [("Whales aren't cows", "If I'm right, this kind of command system will be banned in the future.", None)], "file": "Camping Under the Stars (星空露营).md",
        "shelf": "stories", "kicker": "Short story", "zh": "星空露营", "part": 1,
        "quote": "“I can't remember the last time we lay out like this looking at the stars.”",
        "hook": "Two brothers lie out under the stars, arguing about a black box. One of them is "
                "about to change the world.",
    },
    {
        "slug": "bucket-town",
        "pulls": [("I don't get why you built a computer",
                   "It's just, it's a little too good. So good it makes me uneasy.", None)], "file": "Bucket Town Days (水桶镇往事).md",
        "shelf": "stories", "kicker": "Short story", "zh": "水桶镇往事", "part": 2, "factions": ["RDL"],
        "quote": "Little brother, you've been gone a lot of years now.",
        "hook": "Years later, Matt lays flowers on his brother's grave, in a town that grew into the "
                "heart of the League.",
    },
    {
        "slug": "interview", "layout": "interview", "file": "Late Night Wargames 154 Interview (采访翻译).md",
        "shelf": "designers", "kicker": "Interview", "zh": "Late Night Wargames 154 采访翻译",
        "art": "sleipnir-city", "title": "Late Night Wargames, episode 154",
        "hook": "Queti's designer sits down with two hosts to tell the story behind the setting: the "
                "Moon, its colonies, and the three sides fighting over it.",
        "figures": [
            (r"<em>\[Illustration: Sleipnir City[^<]*\]</em>", "sleipnir-city",
             "Sleipnir City, the largest city on the Moon, inside the ring of its mass driver."),
            (r"<em>\[Illustration: a green garden city[^<]*\]</em>", "titius-colony",
             "Inside Titius, a colony satellite in Earth orbit."),
            (r"\(Image\.\)", OPV,
             "The two OPV4 procedures. This community diagram comes from “SOUP, Theseus and Achilles”; "
             "the show used a Discord-made picture of the same thing."),
        ],
    },
]


def md(text):
    out = markdown.markdown(text, extensions=["tables", "sane_lists", "smarty", "nl2br"])
    # Smarty reads the '45 of a year as an opening quote; it is an apostrophe.
    return re.sub(r"&lsquo;(?=\d)", "&rsquo;", out)


def split(md_text):
    lines = md_text.splitlines()
    title = lines[0].lstrip("# ").strip()
    body = "\n".join(lines[1:])
    body = re.sub(r"^\*(Source|Header):.*\*\s*$", "", body, flags=re.M)
    body = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", body)
    body = re.sub(r"^&nbsp;\s*$", '<p class="lore-break">· · ·</p>', body, flags=re.M)
    body = re.sub(r"^\s*---\s*\n", "", body.lstrip(), count=1)
    parts = re.split(r"^## Translator's notes\s*$", body, maxsplit=1, flags=re.M)
    story = re.sub(r"\n---\s*$", "", parts[0].rstrip())
    notes = parts[1] if len(parts) > 1 else ""
    return title, story, notes


def figure(img, caption):
    cap = html.escape(caption)
    return (f'<figure class="lore-fig"><img src="{{ASSETS}}lore/{img}.webp" alt="{cap}" loading="lazy">'
            f"<figcaption>{cap}</figcaption></figure>")


def add_figures(slug, story_html, figures):
    for pattern, img, caption in figures:
        block = figure(img, caption)
        # The marker can sit inside a paragraph or a list item; the figure
        # replaces the whole paragraph when it is the only thing in it.
        story_html, n = re.subn(r"(<p>)?(<br />\s*)?" + pattern + r"(\s*<br />)?(</p>)?",
                                lambda m: block, story_html, count=1, flags=re.S)
        if n != 1:
            raise SystemExit(f"figure marker not found in {slug}: {pattern}")
    return story_html


# ---- reading aids -----------------------------------------------------------

def plain(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", "", fragment))
    return t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')


def add_pulls(slug, story_html, pulls):
    """A pull quote goes in after the first paragraph that contains `after`."""
    for after, text, who in pulls:
        key = plain(after)
        hit = None
        for m in re.finditer(r"<p[^>]*>.*?</p>", story_html, flags=re.S):
            if key in plain(m.group(0)):
                hit = m
                break
        if not hit:
            raise SystemExit(f"pull-quote anchor not found in {slug}: {after}")
        cite = f"<cite>{html.escape(who)}</cite>" if who else ""
        block = f'\n<blockquote class="lore-pull"><p>{html.escape(text)}</p>{cite}</blockquote>'
        story_html = story_html[: hit.end()] + block + story_html[hit.end():]
    return story_html


def add_years(story_html):
    """A paragraph that opens on a year ('69) gets that year in the margin."""
    def mark(m):
        y = re.match(r"^.{0,60}?'(\d\d)\b", plain(m.group(1)), flags=re.S)
        if not y:
            return m.group(0)
        return f'<p class="lore-dated" data-year="’{y.group(1)}">{m.group(1)}</p>'
    return re.sub(r"<p>(.*?)</p>", mark, story_html, flags=re.S)


# ---- the Chronology as a timeline -----------------------------------------

ERAS = [
    ("old-wars", "The old wars", -10_000, 1958),
    ("moon-rush", "The Moon rush", 1959, 1973),
    ("obsidian-age", "The Obsidian age", 1974, 2009),
    ("great-war", "The Great War", 2010, 2040),
    ("after", "After the ceasefire", 2041, 10_000),
]
FACTION_RE = {
    "RDL": r"Reconstruction Development League|\b[Tt]he Guide\b",
    "UN": r"United Network",
    "GOF": r"Guardians",
}
FAC_SHORT = {"RDL": "RDL", "UN": "UN", "GOF": "GoF"}


def timeline(story):
    story = re.sub(r"\n---\s*\n\*Footer:.*$", "", story, flags=re.S).rstrip()
    story = re.sub(r"\n---\s*$", "", story)
    parts = re.split(r"^\*\*((?:BAE|AE)\.\d{3})\*\*\s*—\s*", story, flags=re.M)
    intro, rest = parts[0].strip(), parts[1:]
    out = []
    if intro:
        out.append(re.sub(r"^<p><em>(.*?)</em></p>", r'<p class="lore-lead"><em>\1</em></p>', md(intro), flags=re.S))
    eras, current, years = [], None, {}
    for label, body in zip(rest[0::2], rest[1::2]):
        n = int(label.split(".")[1])
        year = 1959 - n if label.startswith("BAE") else 1959 + n
        era = next(e for e in ERAS if e[2] <= year <= e[3])
        if era[0] != current:
            if current:
                out.append("</section>")
            current = era[0]
            eras.append({"id": era[0], "label": era[1]})
            out.append(f'<section class="tl-era" id="tl-{era[0]}"><h2 class="tl-era-h">{html.escape(era[1])}'
                       f'<small>{{SPAN:{era[0]}}}</small></h2>')
        years.setdefault(era[0], []).append(year)
        facs = [f for f, rx in FACTION_RE.items() if re.search(rx, body)]
        tags = "".join(f'<span class="tag lore-fac" data-fac="{f}">{FAC_SHORT[f]}</span>' for f in facs)
        tag_html = f'<div class="tl-tags">{tags}</div>' if tags else ""
        out.append(f'<div class="tl-e" data-f="{" ".join(facs)}">'
                   f'<div class="tl-y">{label}<small>{year}</small></div>'
                   f'<div class="tl-x">{md(body.strip())}{tag_html}</div></div>')
    if current:
        out.append("</section>")
    html_out = "\n".join(out)
    for e in eras:
        ys = years[e["id"]]
        e["years"] = f"{min(ys)}–{max(ys)}"
        html_out = html_out.replace("{SPAN:" + e["id"] + "}", e["years"])
    return html_out, eras


# ---- the interview as a conversation ---------------------------------------

SPEAKERS = {
    "A": ("A", "Adam", "host"),
    "J": ("J", "Jon", "host"),
    "R": ("R", "Ren", "Queti"),
    "A, J": ("A·J", "Adam & Jon", "hosts"),
    "J, A": ("A·J", "Adam & Jon", "hosts"),
}


def asides(fragment):
    # The guest's own bracketed comments, set apart from what was said.
    return re.sub(r"\(([^()<>]{3,})\)", r'<span class="iv-aside">(\1)</span>', fragment)


def conversation(story):
    # The talk starts at the first speaker line; everything before it is the
    # translator's introduction (who is who), kept as ordinary text.
    start = re.search(r"^- \*\*[A-Z]\*\*", story, flags=re.M).start()
    head = re.sub(r"\n---\s*$", "", story[:start].rstrip())
    talk = story[start:]
    out = [re.sub(r"^<p><em>(.*?)</em></p>", r'<p class="lore-lead"><em>\1</em></p>', md(head), flags=re.S)]
    for item in re.split(r"^- ", talk.strip(), flags=re.M):
        item = re.sub(r"^  ", "", item.strip("\n"), flags=re.M).strip()
        item = re.sub(r"\n---\s*$", "", item).strip()
        if not item or item == "---":
            continue
        m = re.match(r"\*\*([A-Z](?:, [A-Z])?)\*\*\s*(.*)", item, flags=re.S)
        if not m:
            out.append(f'<div class="iv-stage">{md(item)}</div>')
            continue
        who, text = m.group(1), m.group(2).strip()
        if who == "T":
            note = re.sub(r"^\(interprets\)\s*", "", text).strip()
            if note:
                out.append(f'<div class="iv-interp"><span>Interpreter</span>{md(note)}</div>')
            continue
        av, name, role = SPEAKERS[who]
        out.append(f'<div class="iv-turn iv-{who[0]}"><div class="iv-av" aria-hidden="true">{av}</div>'
                   f'<div class="iv-b"><div class="iv-who">{name} <small>{role}</small></div>'
                   f'<div class="iv-say">{asides(md(text))}</div></div></div>')
    return "\n".join(out)


def rename(text):
    for old, new in NAMES:
        text = text.replace(old, new)
    return text


# ---- glossary notes (batch 3) ----------------------------------------------
# GLOSSARY.md gives each term's English name only, so the short definitions
# are written here from the pieces themselves. The first use of a term in each
# piece becomes a tap-to-read note; later uses stay plain text.
# Years: A.E. n = 1959 + n.

GLOSS = [
    ("relics", "Relics", "遗迹", r"\bRelics?\b",
     "Something built, found on the far side of the Moon in the 1940s. Nobody knows who made them. "
     "The things carried out of them drive almost everything that follows."),
    ("black-box", "Black box", "黑箱", r"\bblack box(?:es)?\b",
     "A Relic product that can be switched on and used, though nobody understands how it works."),
    ("obsidian", "Obsidian Protocol", "黑曜协议", r"\bObsidian Protocol\b",
     "The Leighton Group's technology for joining the human mind to machines, released as OPV1 to OPV4. "
     "Its long-term aim is to digitize consciousness, which is why many faiths oppose it."),
    ("opv4", "OPV4", "黑曜协议 4", r"\bOPV ?4\b",
     "The fourth Obsidian Protocol: the mind runs on a cyberbrain, cut loose from the body it was born in. "
     "OPV4 soldiers were first used at scale on Earth in 1990."),
    ("soup", "SOUP", "汤汁", r"\bSOUP\b",
     "Self-Organizing Unstructured Processor: a black liquid found in the Relics. "
     "Tuned SOUP is what turns a living brain into a cyberbrain."),
    ("cyberbrain", "Cyberbrain", "电子脑", r"\bcyberbrains?\b",
     "An artificial brain that holds a person's consciousness. It can replace part of the brain or all of it."),
    ("theseus", "Theseus Process", "忒修斯流程", r"\bTheseus Process\b",
     "An early cyberbrain procedure that replaces the brain a piece at a time. Gentler, but costly. "
     "It went on sale with OPV3 in 1976."),
    ("achilles", "Achilles Process", "阿喀琉斯流程", r"\bAchilles Process\b",
     "Dips the whole brain into tuned SOUP at once and comes out with a standard OPV4 cyberbrain. "
     "Cheaper and more general than the Theseus Process."),
    ("core", "Coordination Core", "统筹核心", r"\bCoordination Cores?\b",
     "AI-like black boxes from the Relics with immense computing power. The first was found in 1977; "
     "they went on to run the automated armies of the Great War."),
    ("guide", "The Guide", "指导者", r"\b[Tt]he Guide\b",
     "A Coordination Core put in charge of a whole society: it allocates the resources and steers what people want. "
     "Proposed by the scholar Lauren in 2009, it took over the Reconstruction Development League in 2030."),
    ("rogue", "Rogue Cores", "失控核心", r"\bRogue Cores?\b",
     "Automated war forces that no one controls any more; the Chinese name means “cores out of control.” "
     "In Operation Vitusia (2064) they attack the safe zones."),
    ("lmc", "Lunar Management Committee", "月管会", r"\bLunar Management Committee\b",
     "Set up by the first Space Treaty in 1973 to govern high orbit and the Moon. The A.E. calendar dates from its founding."),
    ("hou", "High Orbit Union", "高轨道联合", r"\bHigh (?:Orbit )?Union\b",
     "The independent state of the Moon and high orbit, declared in 2015. Its basic unit is the company, not the citizen."),
    ("rdl", "Reconstruction Development League", "复兴发展同盟", r"\bReconstruction Development League\b",
     "One of the three great factions, founded in 2024 and run in full by the Guide from 2030."),
    ("un", "United Network", "联合网络", r"\bUnited Network\b",
     "Began as a project of companies led by Red Dot Technology and Midas Capital to bring the High Union's "
     "orbital internet down to Earth, and grew into one of the three great factions."),
    ("gof", "Guardians of Freedom", "自由卫士", r"\bGuardians of Freedom\b",
     "A union of farming companies and cooperatives led by Saturn-8, founded in 2031. "
     "The media gave them the name for their fight for “free will.”"),
    ("ying", "Ying", "锳", r"\bYing\b",
     "A stable superheavy element found on the Moon. The lunar mining companies began trading in it, "
     "and it became the Moon's money."),
    ("great-war", "The Great War", "大战", r"\bGreat War\b",
     "The worldwide war that broke out in 2010, fought by automated armies on both sides. "
     "A ceasefire on Earth came in 2040."),
    ("sharwen", "The Sharwen faith", "沙尔文教", r"\bSharwen\b",
     "A branch of an old monotheistic religion that grew with the space race. "
     "Most of it came to reject Leighton and the Obsidian Protocol."),
    ("leighton", "Leighton Group", "雷顿集团", r"\bLeighton Group\b",
     "The Leighton family's company, built on medicine. It bet everything on exploring the Relics, "
     "and went on to make the Obsidian Protocol."),
    ("sleipnir", "Sleipnir", "斯雷普尼尔", r"\bSleipnir\b",
     "The city on the Moon that grew up around a giant mass driver in the Rhaetia crater."),
]
GLOSS_SKIP_TAGS = {"h1", "h2", "h3", "figcaption", "blockquote", "button", "a", "cite", "table"}
GLOSS_SKIP_CLASS = re.compile(r'class="[^"]*\b(?:tl-y|tl-tags|iv-who|iv-av|lore-dated-y)\b')
VOID = {"img", "br", "hr", "source", "input", "meta", "link", "wbr"}


def add_gloss(story_html):
    """Marks the first use of each glossary term; returns the html and the terms used."""
    used = {}
    pats = [(g[0], re.compile(g[3])) for g in GLOSS]
    stack = []
    parts = re.split(r"(<[^>]+>)", story_html)
    for i, part in enumerate(parts):
        if part.startswith("<"):
            m = re.match(r"</?([a-zA-Z0-9]+)", part)
            if not m:
                continue
            name = m.group(1).lower()
            if part.startswith("</"):
                while stack and stack.pop()[0] != name:
                    pass
            elif name not in VOID and not part.endswith("/>"):
                parent = stack[-1][1] if stack else False
                stack.append((name, parent or name in GLOSS_SKIP_TAGS or bool(GLOSS_SKIP_CLASS.search(part))))
            continue
        if not part or (stack and stack[-1][1]):
            continue
        out, rest = "", part
        while True:
            best = None
            for gid, rx in pats:
                if gid in used:
                    continue
                m = rx.search(rest)
                if m and (best is None or m.start() < best[1].start()):
                    best = (gid, m)
            if not best:
                break
            gid, m = best
            used[gid] = True
            out += rest[: m.start()] + f'<button type="button" class="lore-g" data-g="{gid}" aria-expanded="false">{m.group(0)}</button>'
            rest = rest[m.end():]
        parts[i] = out + rest
    gloss = {g[0]: [g[1], g[2], g[4]] for g in GLOSS if g[0] in used}
    return "".join(parts), gloss


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT_IMG, exist_ok=True)
    for name in sorted(os.listdir(IMAGES)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        im = Image.open(os.path.join(IMAGES, name)).convert("RGB")
        im.save(os.path.join(OUT_IMG, stem + ".webp"), "WEBP", quality=82, method=6)

    out = []
    for p in PIECES:
        with open(os.path.join(SRC, p["file"]), encoding="utf-8") as f:
            title, story, notes = split(rename(f.read()))
        eras = None
        if p.get("layout") == "timeline":
            story_html, eras = timeline(story)
        elif p.get("layout") == "interview":
            story_html = conversation(story)
        else:
            story_html = md(story)
            story_html = re.sub(r"^<p><em>(.*?)</em></p>", r'<p class="lore-lead"><em>\1</em></p>', story_html, flags=re.S)
            story_html = add_years(story_html)
        story_html = add_figures(p["slug"], story_html, p.get("figures", []))
        story_html = add_pulls(p["slug"], story_html, p.get("pulls", []))
        story_html, gloss = add_gloss(story_html)
        notes_html = md(notes) if notes.strip() else ""
        words = len(re.sub(r"<[^>]+>", " ", story_html).split())
        entry = {
            "slug": p["slug"],
            "title": p.get("title", title),
            "zh": p["zh"],
            "shelf": p["shelf"],
            "kicker": p["kicker"],
            "hook": p["hook"],
            "factions": p.get("factions", []),
            "words": words,
            "html": story_html,
            "notes": notes_html,
        }
        if gloss:
            entry["gloss"] = gloss
        if eras:
            entry["eras"] = eras
        if p.get("layout"):
            entry["layout"] = p["layout"]
        for k in ("art", "quote", "part"):
            if k in p:
                entry[k] = p[k]
        out.append(entry)

    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(out)} pieces -> {OUT_JSON}")


if __name__ == "__main__":
    main()
