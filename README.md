# ClickClick Academy

Pack-gated courses for ClickClick. An access code unlocks a pack of courses — other catalogs stay hidden.

## Live URL

- **Now:** https://clickclick26.github.io/clickclick-academy/
- **Target:** https://academy.clickclick.video/ (after 123-reg CNAME `academy` → `Clickclick26.github.io`)

Claude / agents: read **`CLAUDE.md`** first.

## Local preview

```bash
cd ~/Projects/clickclick-academy
python3 -m http.server 5199
```

Open http://localhost:5199

Hard refresh if the old page sticks: **Cmd+Shift+R**.

## Try codes (local / staging)

| Code | Pack | What you see |
|------|------|----------------|
| `corp-basic` | Corporate Basic | Serious corp onboarding courses |
| `corp-premium` | Corporate Premium | Basic + advanced corporate |
| `agency` | Agency Pack | Agency-relevant courses |
| `creator-ugc` | Creator UGC | UGC / short-form creator courses |
| `clocal-free` | CLocal Creator | The CLocal Creator Track (free-tier creators) |
| `clocal-creator` | CLocal Creator | The CLocal Creator Track + 1:1 coaching (upgraded plan) |
| `staff-onboard` | Staff onboarding | ClickClick staff day-one courses |
| `live-host` | Live host training | Contractor hosts for live video selling |
| `internal` | All courses | Full catalog |
| `Clickclick123` | All courses | Same as `internal` (legacy for Kathryn) |

## How packs work

1. **Audience vibe** — `audience` on each pack (`corporate`, `agency`, `creator`, `staff`, `live-host`, `internal`) sets greeting tone.
2. **Course IDs** — `courseIds` is the real access list. Only those courses render. No lock icons for hidden ones.

## Add a course

1. Open `courses.json`.
2. Add an object with at least: `id`, `title`, `description`, `tag`, `audience`, `lessons`, `level`, `status`, `icon`, `tone`.
3. Add that `id` into the right packs in `packs.json`.

## Add or change a pack

1. Open `packs.json`.
2. Key = access code people type (e.g. `"acme-spring"`).
3. Value:

```json
{
  "label": "Acme Spring",
  "audience": "corporate",
  "courseIds": ["corp-brand-hooks", "corp-linkedin-shorts"]
}
```

4. Give that code only to the right people.

## Deploy (GitHub Pages)

1. Push this folder to `main` on the Academy repo.
2. GitHub → Settings → Pages → Deploy from branch `main` / root (`/`).
3. DNS CNAME: host **academy** → **Clickclick26.github.io**

`CNAME` in the repo is `academy.clickclick.video`. If github.io redirects to a dead custom domain, remove `CNAME` until DNS works.

## Note

Separate from the main ClickClick marketing site (`www.clickclick.video`). Do not put Academy inside that site root. Branding here is ClickClick Academy only.
