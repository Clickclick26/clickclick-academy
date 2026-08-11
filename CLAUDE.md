# ClickClick Academy — for Claude

Read this first, then `README.md`, then the four content files.

Owner: **Kathryn**. Short plain sentences for her.

---

## What it is

Pack-gated **course catalog**. User types an access code → only that pack’s courses show. No lock icons for hidden courses.

**Not** the marketing site. **Not** inside `clickclick-landing`.

---

## Paths / URLs

| What | Value |
|------|--------|
| Folder | `/Users/kathryn/Projects/clickclick-academy` |
| GitHub | https://github.com/Clickclick26/clickclick-academy |
| Live (GitHub Pages) | https://clickclick26.github.io/clickclick-academy/ |
| Custom domain (target) | `https://academy.clickclick.video/` |
| Pages source | branch `main`, folder `/` |
| `CNAME` file | `academy.clickclick.video` (for when DNS works) |

DNS: Kathryn adds in **123-reg** — CNAME name `academy` → `Clickclick26.github.io`.  
Main site `www.clickclick.video` already works; subdomains need their own records.

---

## Run locally

```bash
cd /Users/kathryn/Projects/clickclick-academy
python3 -m http.server 5199
```

Open http://localhost:5199 — hard refresh **Cmd+Shift+R** if sticky.

---

## File map (whole app)

| File | Role |
|------|------|
| `index.html` | Shell + login UI |
| `app.js` | Gate, pack unlock, render courses |
| `styles.css` | Cream CRM-like Academy look |
| `courses.json` | All courses |
| `packs.json` | Access code → pack label, audience, `courseIds` |
| `CNAME` | Custom domain for Pages |
| `README.md` | Human docs + codes |

No build step. No React. Edit JSON + static files, push `main`.

---

## Access codes (staging / Kathryn)

| Code | Pack |
|------|------|
| `corp-basic` | Corporate Basic |
| `corp-premium` | Corporate Premium |
| `agency` | Agency |
| `creator-ugc` | Creator UGC |
| `staff-onboard` | Staff |
| `live-host` | Live host |
| `internal` | All courses |
| `Clickclick123` | All courses (Kathryn legacy) |

Audience vibes on packs: `corporate`, `agency`, `creator`, `staff`, `live-host`, `internal`.

---

## How to change content

**Add course:** edit `courses.json` → add `id` to the right pack(s) in `packs.json`.

**Add pack / code:** new key in `packs.json` with `label`, `audience`, `courseIds`.

---

## Deploy

```bash
cd /Users/kathryn/Projects/clickclick-academy
git add -A && git commit -m "…" && git push origin main
```

GitHub Pages rebuilds from `main`.

If custom domain breaks github.io (redirect to dead DNS): temporarily remove `CNAME` + clear Pages custom domain until 123-reg CNAME is live.

---

## Rules

1. Do not put Academy inside `clickclick-landing`.
2. Branding = **ClickClick Academy** only (cream / soft cards).
3. Do not expose other packs’ courses when a limited code is used.
4. Keep Kathryn’s `Clickclick123` working unless she asks to remove it.

---

## Paste prompt

```
Work in /Users/kathryn/Projects/clickclick-academy.
Read CLAUDE.md and README.md first.
Static Academy site — packs in packs.json, courses in courses.json.
Live: https://clickclick26.github.io/clickclick-academy/
Custom domain academy.clickclick.video needs 123-reg CNAME → Clickclick26.github.io.
Do not touch clickclick-landing.
```
