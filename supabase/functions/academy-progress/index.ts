// Academy's real progress/unlock backend. Shares the ClickClick CRM's
// Supabase project (academy_-prefixed tables) rather than provisioning
// Academy its own project — it's a small static site with no infra of
// its own. See supabase/migrations note in the CRM repo for schema.
//
// No direct table access from the browser at all: RLS is enabled on
// academy_students/academy_progress with zero policies, so only this
// function (service role) can touch them. A student's opaque studentId
// (a UUID they hold client-side, in localStorage) is what scopes their
// own data — not cryptographically bulletproof, but nothing sensitive
// lives here, and it matches the access-code-only trust model the rest
// of Academy already runs on.
//
// Actions (POST body has a "type" field):
//   identify   {name, email, accessCode} -> {studentId, name}
//   list       {studentId, courseId} -> {progress: [{lessonNum, note, filePath, submittedAt}]}
//   submit     {studentId, courseId, lessonNum, note, filePath?} -> {ok:true}
//              Records that a student marked a lesson done. Nothing of theirs is
//              stored beyond the fact and the timestamp: the uploadUrl action and
//              the whole file-upload path were removed 16 Sep 2026 because nobody
//              was ever going to look at the files. Students self-mark, gated on
//              the lesson's own graded activity or gate quiz. filePath stays in
//              the signature only so existing rows keep working.
//   directory  {adminKey} -> {rows: [{studentId, name, email, courseId, lessonsSubmitted, lastSubmittedAt}]}
//              Internal use only (Kathryn's own creator directory, matching brand
//              requests to certified creators) — not for public/student use. Returns
//              raw per-student-per-course submission counts; the caller cross-checks
//              against each course's actual lesson count (from courses.json) to decide
//              who's actually complete, since this function doesn't know course shapes.
//              REQUIRES adminKey === ACADEMY_ADMIN_KEY. This is the one action that
//              dumps every student's name and email in a single response, and the
//              anon key that reaches this function is published in app.js on a public
//              site — so "only Kathryn knows the URL" protected nothing. The key is a
//              Supabase secret, never in this repo: admin-directory.html is served by
//              GitHub Pages and anything written into it is public too.
//   content    {accessCode} -> {label, audience, courseIds, courses:[...]}
//              The paid course text itself. It used to sit in courses.json next to
//              index.html, which meant GitHub Pages served all 20,000 words to
//              anyone who asked, code or no code, and the public repo served them
//              again from raw.githubusercontent.com. The access-code gate was
//              decoration: it hid courses from the screen, not from the network.
//              Now the lessons live in a private Storage bucket that only the
//              service role can read, the code is checked here, and a caller gets
//              back ONLY the courses their pack allows. A wrong code gets 401 and
//              no course data at all, not even titles.
//   portfolioGet    {studentId} -> the creator's own portfolio page, for editing
//   portfolioSave   {studentId, slug?, portfolio, published} -> {ok, slug}
//   portfolioUpload {studentId, contentType} -> a signed URL to upload one file
//   portfolioPublic {slug} -> a published page, for clickclick.video to render
//              The £249 "Certification + Priority" tier includes a portfolio page
//              hosted on the marketing site. Entitlement is the access code's pack
//              carrying "portfolio": true, not merely having a code. The first
//              three actions are scoped to the student's own UUID; portfolioPublic
//              is open on purpose, because it is what draws a page a brand was
//              sent a link to. Run supabase/RUN-THIS-portfolio-setup.sql and create
//              the creator-portfolios bucket before any of it works.
//   certificate {studentId, courseId} -> {credentialId, issuedAt}
//              Issues (or returns the existing) credential ID for a completed course.
//              Persisted in academy_certificates with a unique constraint on
//              credential_id, so two students can never end up with the same one —
//              the old client-side hash could collide and reset every year, this
//              can't. Run supabase/certificates-table.sql once before this works.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const ALLOWED_ORIGINS = new Set([
  "https://clickclick26.github.io",
  "https://academy.clickclick.video",
  "https://www.clickclick.video",
  "https://clickclick.video",
  "http://localhost:5199",
  "http://127.0.0.1:5199",
])

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://academy.clickclick.video"
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
    Vary: "Origin",
  }
}

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })
}

// Constant-time string compare, so a wrong admin key can't be narrowed down
// character by character from how long the response takes.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const CONTENT_BUCKET = "academy-content"
// Public on purpose: a portfolio page is meant to be opened by a brand who
// was sent the link, and signed URLs would expire and break it. Only this
// function can issue an upload URL into it. See RUN-THIS-portfolio-setup.sql.
const PORTFOLIO_BUCKET = "creator-portfolios"

// A student's UUID is unusable over the phone or in an email subject line, so
// every student also gets a short Academy ID. Derived from the UUID rather
// than stored, so there is no second thing to keep in sync and no chance of a
// collision: same student, same ID, forever. Prefix-searchable, which is what
// makes it traceable when someone writes in saying their course has vanished.
// Same alphabet as credential IDs: no 0/O/1/I, because people read these aloud.
function academyId(studentId: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const hex = String(studentId).replace(/-/g, "")
  let out = ""
  for (let i = 0; i < 6; i++) {
    const chunk = parseInt(hex.slice(i * 5, i * 5 + 5) || "0", 16)
    out += alphabet[chunk % alphabet.length]
  }
  return "CC-" + out.slice(0, 3) + "-" + out.slice(3)
}

// Countries where a consumer purchase makes EU VAT the buyer's-country
// problem. Kept here rather than client-side so it cannot be edited by the
// person it applies to.
const EU_REGIONS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
])

// Course text changes rarely and a warm isolate can serve many gate submits,
// so hold it briefly rather than downloading both files on every keystroke's
// worth of traffic. Short enough that an edit shows up without a redeploy.
const CONTENT_TTL_MS = 60_000
let contentCache: { at: number; courses: unknown[]; packs: Record<string, PackRow> } | null = null

type PackRow = { label?: string; audience?: string; courseIds?: string[]; portfolio?: boolean; lifetime?: boolean }

async function loadContent(admin: AdminClient) {
  if (contentCache && Date.now() - contentCache.at < CONTENT_TTL_MS) return contentCache

  async function readJson(name: string) {
    const { data, error } = await admin.storage.from(CONTENT_BUCKET).download(name)
    if (error) throw error
    return JSON.parse(await data.text())
  }

  const [courses, packs] = await Promise.all([readJson("courses.json"), readJson("packs.json")])
  contentCache = {
    at: Date.now(),
    courses: Array.isArray(courses) ? courses : [],
    packs: packs && typeof packs === "object" ? packs : {},
  }
  return contentCache
}

// Codes are matched exactly first, then case-insensitively, so "CLICKCLICK123"
// still works for someone typing on a phone with autocapitalise on. Matches the
// behaviour the old client-side gate had, so no existing code stops working.
function findPack(packs: Record<string, PackRow>, code: string) {
  const trimmed = String(code ?? "").trim()
  if (!trimmed) return null
  if (packs[trimmed]) return { code: trimmed, pack: packs[trimmed] }
  const lower = trimmed.toLowerCase()
  for (const key of Object.keys(packs)) {
    if (key.toLowerCase() === lower) return { code: key, pack: packs[key] }
  }
  return null
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// deno-lint-ignore no-explicit-any
type AdminClient = any

// ---------------------------------------------------------------------------
// Portfolio pages (the £249 "Certification + Priority" tier).
//
// Everything a creator types here ends up on a public page that brands open,
// so none of it is trusted: strings are stripped of angle brackets and capped,
// links must be http(s), the theme and accent are whitelists rather than free
// text, and an uploaded file is only accepted if its path is inside the
// student's own folder. The renderer on clickclick.video still escapes on the
// way out; this is the second lock, not the only one.
// ---------------------------------------------------------------------------

const PORTFOLIO_THEMES = new Set(["ink", "sand", "mono", "signal"])
const PORTFOLIO_ACCENTS = new Set(["#d9f125", "#ff6b4a", "#4a7dff", "#12b886", "#ffffff", "#111111"])
const MAX_WORKS = 8

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function cleanLink(value: unknown): string {
  const raw = String(value ?? "").trim().slice(0, 500)
  if (!raw) return ""
  if (!/^https?:\/\//i.test(raw)) return ""
  try {
    return new URL(raw).toString()
  } catch {
    return ""
  }
}

// An uploaded file is only ever referenced by its storage path. Anything that
// is not inside this student's own folder is dropped rather than rejected, so
// one bad row cannot stop somebody saving the rest of their page.
function cleanUpload(value: unknown, studentId: string): string {
  const raw = String(value ?? "").trim().slice(0, 300)
  if (!raw) return ""
  if (!raw.startsWith(studentId + "/")) return ""
  if (raw.includes("..")) return ""
  return raw
}

function slugify(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

// Reserved so a creator cannot take a slug that would collide with a real page
// on the marketing site, or with a word that reads as official.
const RESERVED_SLUGS = new Set([
  "", "p", "new", "admin", "clickclick", "clocal", "creators", "academy",
  "about", "terms", "privacy", "refund", "login", "signup", "index", "api",
])

function sanitisePortfolio(input: Record<string, unknown>, studentId: string) {
  const worksIn = Array.isArray(input.works) ? input.works.slice(0, MAX_WORKS) : []
  const theme = String(input.theme ?? "ink")
  const accent = String(input.accent ?? "#d9f125")
  return {
    name: cleanText(input.name, 60),
    headline: cleanText(input.headline, 90),
    bio: cleanText(input.bio, 400),
    location: cleanText(input.location, 60),
    email: cleanText(input.email, 120),
    instagram: cleanText(input.instagram, 40).replace(/^@/, ""),
    tiktok: cleanText(input.tiktok, 40).replace(/^@/, ""),
    website: cleanLink(input.website),
    rates: cleanText(input.rates, 120),
    theme: PORTFOLIO_THEMES.has(theme) ? theme : "ink",
    accent: PORTFOLIO_ACCENTS.has(accent) ? accent : "#d9f125",
    avatar: cleanUpload(input.avatar, studentId),
    works: worksIn
      .map((w) => {
        const item = (w ?? {}) as Record<string, unknown>
        return {
          title: cleanText(item.title, 70),
          label: cleanText(item.label, 120),
          link: cleanLink(item.link),
          image: cleanUpload(item.image, studentId),
          video: cleanUpload(item.video, studentId),
        }
      })
      .filter((w) => w.title || w.link || w.image || w.video),
  }
}

// Turns stored paths into the public URLs the rendered page actually loads.
function publicUrl(supabaseUrl: string, path: string): string {
  if (!path) return ""
  return `${supabaseUrl}/storage/v1/object/public/${PORTFOLIO_BUCKET}/${path}`
}

// The portfolio page is a paid extra, not part of the course, so entitlement
// is the pack's own flag rather than "has an access code".
async function portfolioEntitlement(admin: AdminClient, studentId: string) {
  const { data, error } = await admin
    .from("academy_students")
    .select("id, name, access_code")
    .eq("id", studentId)
    .limit(1)
  if (error) throw error
  const student = data?.[0]
  if (!student) return { ok: false as const, reason: "No such student." }

  const content = await loadContent(admin)
  const pack = findPack(content.packs, String(student.access_code ?? ""))
  if (!pack || pack.pack.portfolio !== true) {
    return { ok: false as const, reason: "A portfolio page is part of Certification + Priority." }
  }
  return { ok: true as const, student, pack }
}


// Mirrors an Academy student into the CRM's contacts table (same Supabase
// project — see the file header). Sales can then see who's actually engaging
// with course content before pitching them, instead of Academy and the CRM
// being two disconnected worlds. Matches by email scoped to brand_id
// 'clickclick', same dedupe pattern as CLocal's waitlist-ingest function.
// Best-effort: a failure here must never break signing in to Academy itself.
async function syncToCrmContacts(opts: {
  admin: AdminClient
  name: string
  email: string
  accessCode: string
}) {
  try {
    const { admin, name, email, accessCode } = opts
    const tags = Array.from(new Set(["academy", accessCode].filter(Boolean)))
    const notesLine = `Academy signup\naccess code: ${accessCode || "(none)"}`

    const { data: existingRows, error: findErr } = await admin
      .from("contacts")
      .select("id, tags, notes")
      .ilike("email", email)
      .eq("brand_id", "clickclick")
      .limit(1)
    if (findErr) throw findErr

    const existing = existingRows?.[0] as
      | { id: string; tags: string[] | null; notes: string }
      | undefined

    if (existing) {
      const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...tags]))
      const mergedNotes = existing.notes?.includes("Academy signup")
        ? existing.notes
        : [existing.notes?.trim(), notesLine].filter(Boolean).join("\n\n")
      const { error: updErr } = await admin
        .from("contacts")
        .update({ tags: mergedTags, notes: mergedNotes, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      if (updErr) throw updErr
    } else {
      const { error: insErr } = await admin.from("contacts").insert({
        name,
        email,
        phone: "",
        company: "",
        stage: "new",
        source: "academy",
        tags,
        notes: notesLine,
        brand_id: "clickclick",
      })
      if (insErr) throw insErr
    }
  } catch (err) {
    console.error("academy->crm contact sync failed:", (err as Error).message)
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin")

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(origin) })
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, origin)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Server not configured." }, origin)
  }
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const body = await req.json()
    const type = body?.type

    if (type === "identify") {
      const name = String(body.name ?? "").trim()
      const email = String(body.email ?? "").trim().toLowerCase()
      const accessCode = String(body.accessCode ?? "").trim()
      const region = String(body.region ?? "").trim().toUpperCase().slice(0, 2)
      if (!name) return json(400, { error: "Name required." }, origin)
      if (!EMAIL_RE.test(email)) return json(400, { error: "Real email required." }, origin)

      const { data: existing, error: findErr } = await admin
        .from("academy_students")
        .select("id, name")
        .ilike("email", email)
        .limit(1)
      if (findErr) throw findErr

      if (existing && existing.length > 0) {
        if (region) {
          await admin.from("academy_students").update({ region }).eq("id", existing[0].id)
        }
        // Still sync on repeat visits — cheap, and catches anyone who signed
        // up before this existed, or unlocked a second pack since.
        await syncToCrmContacts({ admin, name: existing[0].name, email, accessCode })
        return json(
          200,
          {
            studentId: existing[0].id,
            name: existing[0].name,
            academyId: academyId(existing[0].id),
          },
          origin,
        )
      }

      const { data: created, error: insErr } = await admin
        .from("academy_students")
        .insert({ name, email, access_code: accessCode, region: region || null })
        .select("id, name")
        .single()
      if (insErr) throw insErr
      await syncToCrmContacts({ admin, name, email, accessCode })
      return json(
        200,
        { studentId: created.id, name: created.name, academyId: academyId(created.id) },
        origin,
      )
    }

    if (type === "list") {
      const studentId = String(body.studentId ?? "")
      const courseId = String(body.courseId ?? "")
      if (!studentId || !courseId) return json(400, { error: "Missing fields." }, origin)

      const { data, error } = await admin
        .from("academy_progress")
        .select("lesson_num, note, file_path, submitted_at")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
      if (error) throw error

      return json(
        200,
        {
          progress: (data ?? []).map((r) => ({
            lessonNum: r.lesson_num,
            note: r.note,
            filePath: r.file_path,
            submittedAt: r.submitted_at,
          })),
        },
        origin,
      )
    }

    if (type === "submit") {
      const studentId = String(body.studentId ?? "")
      const courseId = String(body.courseId ?? "")
      const lessonNum = String(body.lessonNum ?? "")
      const note = String(body.note ?? "").trim()
      const filePath = body.filePath ? String(body.filePath) : null
      if (!studentId || !courseId || !lessonNum) {
        return json(400, { error: "Missing fields." }, origin)
      }
      if (!note && !filePath) {
        return json(400, { error: "Add a note or a file before submitting." }, origin)
      }

      const { error } = await admin.from("academy_progress").upsert(
        {
          student_id: studentId,
          course_id: courseId,
          lesson_num: lessonNum,
          note,
          file_path: filePath,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "student_id,course_id,lesson_num" },
      )
      if (error) throw error
      return json(200, { ok: true }, origin)
    }

    if (type === "content") {
      // The storage bucket may not exist yet. Say so specifically rather than
      // falling through to a generic 500: the front end treats this exact
      // message as "not migrated yet, use the public files", and a generic
      // error would just lock everyone out.
      let loaded
      try {
        loaded = await loadContent(admin)
      } catch (_e) {
        return json(503, { error: "Content store not configured." }, origin)
      }
      const { courses, packs } = loaded
      const match = findPack(packs, String(body.accessCode ?? ""))
      // Same 401 and same shape whether the code is unknown or empty, so the
      // response can't be used to probe which codes exist.
      if (!match) return json(401, { error: "That code did not work." }, origin)

      const allowedIds = new Set(match.pack.courseIds ?? [])
      const allowed = (courses as Array<{ id?: string }>).filter((c) => allowedIds.has(String(c.id)))

      return json(
        200,
        {
          code: match.code,
          label: match.pack.label ?? match.code,
          audience: match.pack.audience ?? "",
          courseIds: match.pack.courseIds ?? [],
          // Lets the front end show the portfolio link to the tier that paid
          // for it. Not a permission: portfolioGet/Save re-check the pack
          // server-side, so a hand-edited response buys nothing.
          portfolio: match.pack.portfolio === true,
          lifetime: match.pack.lifetime === true,
          courses: allowed,
        },
        origin,
      )
    }

    if (type === "directory") {
      const adminKey = Deno.env.get("ACADEMY_ADMIN_KEY")
      if (!adminKey) return json(500, { error: "Directory not configured." }, origin)
      if (!timingSafeEqual(String(body.adminKey ?? ""), adminKey)) {
        return json(401, { error: "Not authorised." }, origin)
      }

      const { data: progressRows, error: progErr } = await admin
        .from("academy_progress")
        .select("student_id, course_id, lesson_num, submitted_at")
      if (progErr) throw progErr

      const { data: students, error: studErr } = await admin
        .from("academy_students")
        .select("id, name, email")
      if (studErr) throw studErr

      const studentById = new Map((students ?? []).map((s) => [s.id, s]))
      const byKey = new Map<string, { count: number; lastSubmittedAt: string }>()
      for (const row of progressRows ?? []) {
        const key = `${row.student_id}|${row.course_id}`
        const cur = byKey.get(key)
        if (!cur) {
          byKey.set(key, { count: 1, lastSubmittedAt: row.submitted_at })
        } else {
          cur.count += 1
          if (row.submitted_at > cur.lastSubmittedAt) cur.lastSubmittedAt = row.submitted_at
        }
      }

      const rows = Array.from(byKey.entries()).map(([key, v]) => {
        const [studentId, courseId] = key.split("|")
        const student = studentById.get(studentId)
        return {
          studentId,
          name: student?.name ?? "Unknown",
          email: student?.email ?? "",
          courseId,
          lessonsSubmitted: v.count,
          lastSubmittedAt: v.lastSubmittedAt,
        }
      })

      return json(200, { rows }, origin)
    }

    if (type === "certificate") {
      const studentId = String(body.studentId ?? "")
      const courseId = String(body.courseId ?? "")
      if (!studentId || !courseId) return json(400, { error: "Missing fields." }, origin)

      // Completion is checked HERE, on the server, not taken on trust from the
      // browser. Until 16 Sep 2026 this action minted a credential for anyone
      // who asked: no payment, no access code, zero lessons done. A stranger
      // could call identify with any email and then certificate, and land a
      // real approved credential in the creator directory.
      //
      // Two gates now. The student's access code has to actually open this
      // course, and every lesson in it has to have a progress row.
      let content
      try {
        content = await loadContent(admin)
      } catch (_e) {
        return json(503, { error: "Content store not configured." }, origin)
      }

      const { data: certStudent } = await admin
        .from("academy_students")
        .select("region, access_code")
        .eq("id", studentId)
        .limit(1)
      const studentRecord = certStudent?.[0]
      if (!studentRecord) return json(404, { error: "No such student." }, origin)

      const pack = findPack(content.packs, String(studentRecord.access_code ?? ""))
      if (!pack || !(pack.pack.courseIds ?? []).includes(courseId)) {
        return json(403, { error: "That course is not on your access code." }, origin)
      }

      const course = (content.courses as Array<Record<string, unknown>>).find(
        (c) => String(c.id) === courseId,
      )
      if (!course) return json(404, { error: "No such course." }, origin)

      // Self-paced courses are not graded and issue no certificate at all.
      if (course.selfPaced) {
        return json(400, { error: "This course does not issue a certificate." }, origin)
      }

      const lessonNums: string[] = []
      for (const m of (course.modules as Array<{ lessons?: Array<{ num?: string }> }>) ?? []) {
        for (const l of m.lessons ?? []) if (l.num) lessonNums.push(String(l.num))
      }

      const { data: doneRows, error: doneErr } = await admin
        .from("academy_progress")
        .select("lesson_num")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
      if (doneErr) throw doneErr
      const done = new Set((doneRows ?? []).map((r) => String(r.lesson_num)))
      const missing = lessonNums.filter((n) => !done.has(n))

      if (missing.length > 0) {
        return json(
          403,
          {
            error: "Course not finished.",
            completed: lessonNums.length - missing.length,
            total: lessonNums.length,
          },
          origin,
        )
      }

      // EU students' certificates are held for a human look rather than issued
      // automatically. See supabase/eu-review-and-ids.sql for why.
      const needsReview = EU_REGIONS.has(String(studentRecord.region ?? "").toUpperCase())

      const { data: existing, error: findErr } = await admin
        .from("academy_certificates")
        .select("credential_id, issued_at, approved")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .limit(1)
      if (findErr) throw findErr
      if (existing && existing.length > 0) {
        return json(
          200,
          {
            credentialId: existing[0].credential_id,
            issuedAt: existing[0].issued_at,
            approved: existing[0].approved !== false,
          },
          origin,
        )
      }

      // No 0/O/1/I: a credential ID gets read aloud and typed in by hand
      // sometimes, so drop the characters people misread most.
      const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
      function randomCode(len: number): string {
        let out = ""
        for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
        return out
      }

      const year = new Date().getFullYear()
      // The `unique` constraint on credential_id is what actually guarantees
      // no duplicates. This loop just picks a fresh code on the rare chance
      // a random one collides, rather than failing the request outright.
      for (let attempt = 0; attempt < 5; attempt++) {
        const credentialId = `CC-${year}-${randomCode(6)}`
        const { data: created, error: insErr } = await admin
          .from("academy_certificates")
          .insert({
            student_id: studentId,
            course_id: courseId,
            credential_id: credentialId,
            approved: !needsReview,
          })
          .select("credential_id, issued_at, approved")
          .single()
        if (!insErr) {
          return json(
            200,
            {
              credentialId: created.credential_id,
              issuedAt: created.issued_at,
              approved: created.approved !== false,
            },
            origin,
          )
        }
        if (insErr.code !== "23505") throw insErr // 23505 = unique_violation, anything else is real
      }
      return json(500, { error: "Could not mint a unique credential ID, try again." }, origin)
    }

    // Certificates waiting on a human, and the bulk approve that clears them.
    // Both sit behind the same admin key as the directory: between them they
    // read every pending student's name and email and decide who gets a
    // credential, so neither can be open to whoever finds the URL.
    if (type === "pendingCertificates" || type === "approveCertificates") {
      const adminKey = Deno.env.get("ACADEMY_ADMIN_KEY")
      if (!adminKey) return json(500, { error: "Not configured." }, origin)
      if (!timingSafeEqual(String(body.adminKey ?? ""), adminKey)) {
        return json(401, { error: "Not authorised." }, origin)
      }

      if (type === "pendingCertificates") {
        const { data: certs, error: cErr } = await admin
          .from("academy_certificates")
          .select("credential_id, student_id, course_id, issued_at")
          .eq("approved", false)
        if (cErr) throw cErr

        const ids = Array.from(new Set((certs ?? []).map((c) => c.student_id)))
        const { data: studs, error: sErr } = ids.length
          ? await admin.from("academy_students").select("id, name, email, region").in("id", ids)
          : { data: [], error: null }
        if (sErr) throw sErr
        const byId = new Map((studs ?? []).map((st) => [st.id, st]))

        return json(
          200,
          {
            rows: (certs ?? []).map((c) => {
              const st = byId.get(c.student_id)
              return {
                credentialId: c.credential_id,
                studentId: c.student_id,
                academyId: academyId(c.student_id),
                name: st?.name ?? "Unknown",
                email: st?.email ?? "",
                region: st?.region ?? "",
                courseId: c.course_id,
                issuedAt: c.issued_at,
              }
            }),
          },
          origin,
        )
      }

      // Bulk approve. One statement for the whole selection rather than a
      // request per student, so clearing a morning's queue is one click.
      const credentialIds = Array.isArray(body.credentialIds)
        ? body.credentialIds.map((c: unknown) => String(c)).slice(0, 500)
        : []
      if (!credentialIds.length) return json(400, { error: "Nothing selected." }, origin)

      const { data: updated, error: uErr } = await admin
        .from("academy_certificates")
        .update({ approved: true })
        .in("credential_id", credentialIds)
        .select("credential_id")
      if (uErr) throw uErr
      return json(200, { approved: (updated ?? []).length }, origin)
    }

    // --- Portfolio pages -------------------------------------------------
    // portfolioGet     {studentId} -> the creator's own page, for the editor
    // portfolioSave    {studentId, slug?, portfolio, published} -> {ok, slug}
    // portfolioUpload  {studentId, filename, contentType} -> signed upload URL
    // portfolioPublic  {slug} -> the rendered page's data, no auth at all
    //
    // The first three are scoped by the student's own UUID, same trust model
    // as the rest of this function. The last one is deliberately open: it is
    // what clickclick.video calls to draw a page a brand was sent.

    if (type === "portfolioGet") {
      const studentId = String(body.studentId ?? "")
      if (!studentId) return json(400, { error: "Missing fields." }, origin)

      const ent = await portfolioEntitlement(admin, studentId)
      if (!ent.ok) return json(403, { error: ent.reason, entitled: false }, origin)

      const { data, error } = await admin
        .from("academy_portfolios")
        .select("slug, data, published, updated_at")
        .eq("student_id", studentId)
        .limit(1)
      if (error) throw error

      const row = data?.[0]
      return json(
        200,
        {
          entitled: true,
          slug: row?.slug ?? "",
          suggestedSlug: slugify(ent.student.name || "creator") || "creator",
          published: row?.published === true,
          portfolio: row?.data ?? null,
          updatedAt: row?.updated_at ?? null,
          storageBase: `${supabaseUrl}/storage/v1/object/public/${PORTFOLIO_BUCKET}/`,
        },
        origin,
      )
    }

    if (type === "portfolioSave") {
      const studentId = String(body.studentId ?? "")
      if (!studentId) return json(400, { error: "Missing fields." }, origin)

      const ent = await portfolioEntitlement(admin, studentId)
      if (!ent.ok) return json(403, { error: ent.reason, entitled: false }, origin)

      const clean = sanitisePortfolio(
        (body.portfolio ?? {}) as Record<string, unknown>,
        studentId,
      )
      const published = body.published === true

      // A page with nothing on it is worse than no page, so publishing needs
      // at least a name and one piece of work. Saving a draft needs neither.
      if (published && (!clean.name || clean.works.length === 0)) {
        return json(
          400,
          { error: "Add your name and at least one piece of work before you publish." },
          origin,
        )
      }

      const { data: existingRows, error: exErr } = await admin
        .from("academy_portfolios")
        .select("slug")
        .eq("student_id", studentId)
        .limit(1)
      if (exErr) throw exErr
      let slug = existingRows?.[0]?.slug ?? ""

      // The slug is the creator's URL. It is chosen once and then frozen, so
      // a link already sent to a brand never stops working.
      if (!slug) {
        const wanted = slugify(String(body.slug ?? "")) ||
          slugify(clean.name || ent.student.name || "creator")
        let candidate = RESERVED_SLUGS.has(wanted) ? "" : wanted
        if (!candidate) candidate = "creator"
        for (let attempt = 0; attempt < 25; attempt++) {
          const trial = attempt === 0 ? candidate : `${candidate}-${attempt + 1}`
          const { data: taken, error: takenErr } = await admin
            .from("academy_portfolios")
            .select("student_id")
            .eq("slug", trial)
            .limit(1)
          if (takenErr) throw takenErr
          if (!taken || taken.length === 0) {
            slug = trial
            break
          }
        }
        if (!slug) return json(409, { error: "Could not find a free page address." }, origin)
      }

      const { error: upErr } = await admin.from("academy_portfolios").upsert(
        {
          student_id: studentId,
          slug,
          data: clean,
          published,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      )
      if (upErr) throw upErr

      return json(200, { ok: true, slug, published }, origin)
    }

    if (type === "portfolioUpload") {
      const studentId = String(body.studentId ?? "")
      if (!studentId) return json(400, { error: "Missing fields." }, origin)

      const ent = await portfolioEntitlement(admin, studentId)
      if (!ent.ok) return json(403, { error: ent.reason, entitled: false }, origin)

      const contentType = String(body.contentType ?? "").toLowerCase()
      const EXT: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
      }
      const ext = EXT[contentType]
      if (!ext) {
        return json(400, { error: "Pictures (JPG, PNG, WebP) or video (MP4, MOV) only." }, origin)
      }

      // Random filename rather than the one off their phone: the originals
      // carry names like IMG_4821 or worse, and a guessable path in a public
      // bucket is a path somebody else can guess too.
      const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      const path = `${studentId}/${rand}.${ext}`

      const { data, error } = await admin.storage
        .from(PORTFOLIO_BUCKET)
        .createSignedUploadUrl(path)
      if (error) {
        console.error("portfolio upload url failed:", error.message)
        return json(503, { error: "File store not ready. Create the creator-portfolios bucket." }, origin)
      }

      return json(
        200,
        {
          path,
          token: data.token,
          signedUrl: data.signedUrl,
          bucket: PORTFOLIO_BUCKET,
          publicUrl: publicUrl(supabaseUrl, path),
        },
        origin,
      )
    }

    if (type === "portfolioPublic") {
      const slug = slugify(String(body.slug ?? ""))
      if (!slug) return json(400, { error: "No page asked for." }, origin)

      const { data, error } = await admin
        .from("academy_portfolios")
        .select("student_id, data, published, updated_at")
        .eq("slug", slug)
        .eq("published", true)
        .limit(1)
      if (error) throw error

      const row = data?.[0]
      if (!row) return json(404, { error: "No page here." }, origin)

      const portfolio = (row.data ?? {}) as Record<string, unknown>
      const works = Array.isArray(portfolio.works) ? portfolio.works : []

      // The credential is the point of hosting this here rather than on a
      // free site builder, so it is read from the certificates table rather
      // than anything the creator can type. An unapproved one is not shown.
      const { data: certs } = await admin
        .from("academy_certificates")
        .select("credential_id, issued_at, approved")
        .eq("student_id", row.student_id)
        .eq("approved", true)
        .order("issued_at", { ascending: true })
        .limit(1)
      const cert = certs?.[0]

      return json(
        200,
        {
          slug,
          updatedAt: row.updated_at,
          credentialId: cert?.credential_id ?? "",
          certifiedAt: cert?.issued_at ?? "",
          portfolio: {
            ...portfolio,
            avatar: publicUrl(supabaseUrl, String(portfolio.avatar ?? "")),
            works: works.map((w) => {
              const item = (w ?? {}) as Record<string, string>
              return {
                ...item,
                image: publicUrl(supabaseUrl, String(item.image ?? "")),
                video: publicUrl(supabaseUrl, String(item.video ?? "")),
              }
            }),
          },
        },
        origin,
      )
    }

    return json(400, { error: "Unknown request type." }, origin)
  } catch (err) {
    console.error("academy-progress error:", err)
    return json(500, { error: "Something went wrong." }, origin)
  }
})
