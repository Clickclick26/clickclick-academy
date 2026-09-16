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
//   uploadUrl  {studentId, courseId, lessonNum, fileName} -> {path, signedUrl, token}
//   submit     {studentId, courseId, lessonNum, note, filePath?} -> {ok:true}
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

const BUCKET = "academy-deliverables"
const CONTENT_BUCKET = "academy-content"

// Course text changes rarely and a warm isolate can serve many gate submits,
// so hold it briefly rather than downloading both files on every keystroke's
// worth of traffic. Short enough that an edit shows up without a redeploy.
const CONTENT_TTL_MS = 60_000
let contentCache: { at: number; courses: unknown[]; packs: Record<string, PackRow> } | null = null

type PackRow = { label?: string; audience?: string; courseIds?: string[] }

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
      if (!name) return json(400, { error: "Name required." }, origin)
      if (!EMAIL_RE.test(email)) return json(400, { error: "Real email required." }, origin)

      const { data: existing, error: findErr } = await admin
        .from("academy_students")
        .select("id, name")
        .ilike("email", email)
        .limit(1)
      if (findErr) throw findErr

      if (existing && existing.length > 0) {
        // Still sync on repeat visits — cheap, and catches anyone who signed
        // up before this existed, or unlocked a second pack since.
        await syncToCrmContacts({ admin, name: existing[0].name, email, accessCode })
        return json(200, { studentId: existing[0].id, name: existing[0].name }, origin)
      }

      const { data: created, error: insErr } = await admin
        .from("academy_students")
        .insert({ name, email, access_code: accessCode })
        .select("id, name")
        .single()
      if (insErr) throw insErr
      await syncToCrmContacts({ admin, name, email, accessCode })
      return json(200, { studentId: created.id, name: created.name }, origin)
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

    if (type === "uploadUrl") {
      const studentId = String(body.studentId ?? "")
      const courseId = String(body.courseId ?? "")
      const lessonNum = String(body.lessonNum ?? "")
      const fileName = String(body.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_")
      if (!studentId || !courseId || !lessonNum) {
        return json(400, { error: "Missing fields." }, origin)
      }
      const path = `${studentId}/${courseId}/${lessonNum}/${Date.now()}-${fileName}`
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      return json(200, { path: data.path, signedUrl: data.signedUrl, token: data.token }, origin)
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
      const { courses, packs } = await loadContent(admin)
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

      const { data: existing, error: findErr } = await admin
        .from("academy_certificates")
        .select("credential_id, issued_at")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .limit(1)
      if (findErr) throw findErr
      if (existing && existing.length > 0) {
        return json(200, { credentialId: existing[0].credential_id, issuedAt: existing[0].issued_at }, origin)
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
          .insert({ student_id: studentId, course_id: courseId, credential_id: credentialId })
          .select("credential_id, issued_at")
          .single()
        if (!insErr) {
          return json(200, { credentialId: created.credential_id, issuedAt: created.issued_at }, origin)
        }
        if (insErr.code !== "23505") throw insErr // 23505 = unique_violation, anything else is real
      }
      return json(500, { error: "Could not mint a unique credential ID, try again." }, origin)
    }

    return json(400, { error: "Unknown request type." }, origin)
  } catch (err) {
    console.error("academy-progress error:", err)
    return json(500, { error: "Something went wrong." }, origin)
  }
})
