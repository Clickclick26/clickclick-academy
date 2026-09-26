// meta-leads: follow-up emails for people who fill in a ClickClick lead form
// on Facebook or Instagram.
//
// Meta keeps the leads; nothing arrives here by itself. So a GitHub Actions
// job calls "run" every ten minutes, and each run does two things:
//   1. pulls any new leads from every lead form on the ClickClick Page into
//      public.meta_leads, and
//   2. sends whichever follow-up email each lead is now due, one per lead
//      per run at most.
//
// The sequences, by which form they came through:
//   creator-uk / creator-us  day 0 the code; day 2 a "five minutes" nudge if
//                            they have not opened the course, the usage point
//                            if they have; then the paid course, sent the
//                            moment they finish the free one, or on day 7 if
//                            they never do. Skipped if they have bought.
//   brand                    day 0 the score link, day 3 an offer to talk
//
// Actions (POST, JSON):
//   run          {type, key}                        from the scheduled job
//   preview      {type, key, to, audience, step,    sends one email to a
//                 started?, finished?}
//                                                   @clickclick.video inbox
//   insights     {type, key, since, until,          read-only ad stats (spend,
//                 breakdown?, level?}              reach, sign-ups), e.g. by region
//   broadcast    {type, key, campaign, audience,    one-off email to an audience;
//                 dryRun (default true), sendAt?,  once per lead per campaign,
//                 testTo?}                          buyers and unsubscribes skipped
//   unsubscribe  {type, u, s}                       from the unsubscribe page
// Plus the one-click unsubscribe POST mail apps send by themselves, which
// carries u and s in the query string.
//
// Secrets:
//   CRON_KEY             shared with the GitHub Actions job
//   META_LEADS_TOKEN     a ClickClick system-user token with leads_retrieval
//                        and access to the Page. Until it is set, runs still
//                        succeed and send what is due, they just fetch nothing.
//   LEADS_UNSUB_SECRET   signs unsubscribe links so nobody can unsubscribe
//                        someone else by guessing ids
//   RESEND_API_KEY       already set, the purchase emails use it too
//   META_PAGE_ID         optional, otherwise found by name

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { upsertContact } from "../_shared/crm.ts"

type AdminClient = ReturnType<typeof createClient>
type Audience = "brand" | "creator-uk" | "creator-us"

type Lead = {
  leadgen_id: string
  audience: Audience | null
  email: string | null
  name: string | null
  created_time: string
  steps_sent: number
  last_sent_at: string | null
}

const GRAPH = "https://graph.facebook.com/v21.0"
const FUNCTION_URL = "https://gapybapywpdogexibtgj.supabase.co/functions/v1/meta-leads"
const ACADEMY = "https://academy.clickclick.video/"
const GROUP = "https://www.facebook.com/groups/753290293164414"
const ADDRESS = "ClickClick Video Marketing Ltd, Arthur House, Belfast BT1 4GB, United Kingdom"

const ALLOWED_ORIGINS = new Set([
  "https://www.clickclick.video",
  "https://clickclick.video",
  "http://localhost:5199",
  "http://127.0.0.1:5199",
])

// Days after the lead came in that each step goes out. For creators the
// last step can come sooner: finishing the free course brings it forward.
const DELAYS: Record<Audience, number[]> = {
  "creator-uk": [0, 2, 7],
  "creator-us": [0, 2, 7],
  brand: [0, 3],
}

// The link an email sends people to. It carries the access code, so nobody has
// to copy one out of an email and type it into a box: that step was losing
// about five people in six. app.js reads ?k= and ?c=, unlocks, and wipes both
// from the address bar.
//
// A lead's own link also carries their lead id, signed, so the Academy can
// fill in the name and email Meta already gave us instead of asking again
// (academy-progress identifyLead checks the signature).
function courseLink(us: boolean, lead?: { id: string; sig: string }): string {
  const code = us ? "GOLDENQUARTERUS" : "GOLDENQUARTER"
  const course = us ? "golden-quarter-ugc-us" : "golden-quarter-ugc"
  const who = lead ? `&l=${encodeURIComponent(lead.id)}&s=${lead.sig}` : ""
  return `${ACADEMY}?k=${code}&c=${course}&src=email${who}`
}

async function leadCourseLink(us: boolean, leadgenId: string): Promise<string> {
  if (!leadgenId || leadgenId === "preview") return courseLink(us)
  return courseLink(us, { id: leadgenId, sig: await sign(leadgenId) })
}

const FREE_COURSE: Record<string, string> = {
  "creator-uk": "golden-quarter-ugc",
  "creator-us": "golden-quarter-ugc-us",
}
// The five core lessons. The bonus lesson (1.06) is the taste of the paid
// course, so finishing does not wait on it.
const CORE_LESSONS = ["1.01", "1.02", "1.03", "1.04", "1.05"]

type Progress = { started: boolean; finished: boolean }

// Two follow-ups never land on the same day, even for a lead first seen late.
const MIN_GAP_HOURS = 20

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.clickclick.video"
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  }
}

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

// Which sequence a form feeds, from its name in Ads Manager. A form that
// matches none of these is stored but never emailed, so a new form cannot
// start sending anything until it is added here on purpose.
function audienceFor(formName: string): Audience | null {
  if (/brand/i.test(formName)) return "brand"
  if (/golden quarter/i.test(formName)) return /\(US\)/.test(formName) ? "creator-us" : "creator-uk"
  return null
}

// ---------------------------------------------------------------- Meta ----

async function graph(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token)
  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok || body.error) {
    throw new Error(`Graph ${path}: ${body.error?.message ?? res.status}`)
  }
  return body
}

async function pageToken(systemToken: string) {
  const pages = await graph("me/accounts", systemToken, { fields: "id,name,access_token", limit: "50" })
  const wanted = Deno.env.get("META_PAGE_ID")
  const page = (pages.data ?? []).find((p: { id: string; name: string }) =>
    wanted ? p.id === wanted : /clickclick/i.test(p.name)
  )
  if (!page) throw new Error("The token cannot see the ClickClick Page.")
  return { id: page.id as string, token: page.access_token as string }
}

// Only looks back a week. A lead older than that which was somehow never
// fetched is better left alone than sent a "welcome" a fortnight late.
async function fetchLeads(admin: AdminClient, systemToken: string) {
  const page = await pageToken(systemToken)
  const forms = await graph(`${page.id}/leadgen_forms`, page.token, { fields: "id,name", limit: "100" })
  const since = Math.floor(Date.now() / 1000) - 7 * 86400
  let fetched = 0
  let inserted = 0

  for (const form of forms.data ?? []) {
    let next: string | null = null
    let first = true
    let pagesRead = 0
    while ((first || next) && pagesRead < 10) {
      const body = first
        ? await graph(`${form.id}/leads`, page.token, {
          fields: "id,created_time,field_data",
          limit: "100",
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
        })
        : await graph(next as string, page.token)
      first = false
      pagesRead++
      next = body.paging?.next ?? null

      const rows = (body.data ?? []).map((lead: {
        id: string
        created_time: string
        field_data?: Array<{ name: string; values: string[] }>
      }) => {
        const answers: Record<string, string> = {}
        for (const f of lead.field_data ?? []) answers[f.name] = (f.values ?? []).join(", ")
        return {
          leadgen_id: lead.id,
          form_id: form.id,
          form_name: form.name,
          audience: audienceFor(form.name),
          email: (answers.email ?? "").trim().toLowerCase() || null,
          name: (answers.full_name ?? answers.first_name ?? "").trim() || null,
          answers,
          created_time: lead.created_time,
        }
      })
      fetched += rows.length
      if (rows.length === 0) continue

      const { data, error } = await admin
        .from("meta_leads")
        .upsert(rows, { onConflict: "leadgen_id", ignoreDuplicates: true })
        .select("leadgen_id")
      if (error) throw error
      inserted += data?.length ?? 0

      // New leads only: the ones this run actually inserted.
      const fresh = new Set((data ?? []).map((r: { leadgen_id: string }) => r.leadgen_id))
      for (const row of rows) {
        if (fresh.has(row.leadgen_id)) await leadToCrm(admin, row)
      }
    }
  }
  return { forms: (forms.data ?? []).length, fetched, inserted }
}

// Every new lead also becomes a CRM contact, so sales can see them and the
// creators can be picked out later for upsells. Best effort: the CRM being
// unhappy must not stop the lead's email.
async function leadToCrm(admin: AdminClient, row: {
  form_name: string
  audience: Audience | null
  email: string | null
  name: string | null
  answers: Record<string, string>
  created_time: string
}) {
  // Meta's own test tool sends leads with placeholder text for the email.
  if (!row.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return
  const tags = ["facebook-lead"]
  if (row.audience === "brand") tags.push("business", "readiness-score")
  if (row.audience === "creator-uk") tags.push("creator", "golden-quarter", "uk")
  if (row.audience === "creator-us") tags.push("creator", "golden-quarter", "us")
  const extra = Object.entries(row.answers)
    .filter(([k]) => !["email", "full_name", "first_name", "last_name"].includes(k))
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
  try {
    await upsertContact(admin, {
      email: row.email,
      name: row.name,
      source: "facebook-lead-ad",
      tags,
      note: [`Facebook lead form "${row.form_name}", ${row.created_time.slice(0, 10)}`, ...extra].join("\n"),
    })
  } catch (err) {
    console.error("lead -> crm failed:", (err as Error).message)
  }
}

// --------------------------------------------------------- Unsubscribe ----

async function sign(id: string) {
  const secret = Deno.env.get("LEADS_UNSUB_SECRET") ?? ""
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id))
  return Array.from(new Uint8Array(mac)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")
}

async function unsubscribeLinks(id: string) {
  const s = await sign(id)
  const q = `u=${encodeURIComponent(id)}&s=${s}`
  return { page: `https://www.clickclick.video/unsubscribe/?${q}`, oneClick: `${FUNCTION_URL}?${q}` }
}

async function unsubscribe(admin: AdminClient, id: string, s: string) {
  if (!Deno.env.get("LEADS_UNSUB_SECRET") || !id || !timingSafeEqual(s, await sign(id))) return false
  // "s:<uuid>" is a student rather than a lead: the people who signed up from a
  // DM, a group or the website, who have no meta_leads row to stop.
  if (id.startsWith("s:")) {
    const { error } = await admin
      .from("academy_students")
      .update({ unsubscribed_at: new Date().toISOString(), marketing_consent: false })
      .eq("id", id.slice(2))
      .is("unsubscribed_at", null)
    if (error) throw error
    return true
  }
  const { error } = await admin
    .from("meta_leads")
    .update({ stopped_at: new Date().toISOString(), stopped_reason: "unsubscribed" })
    .eq("leadgen_id", id)
    .is("stopped_at", null)
  if (error) throw error
  return true
}

// -------------------------------------------------------------- Emails ----

// The US Black Friday: the day after the fourth Thursday of November. The UK
// runs on the same day.
function blackFriday(from: Date) {
  for (const year of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const first = new Date(Date.UTC(year, 10, 1))
    const firstThursday = 1 + ((4 - first.getUTCDay() + 7) % 7)
    const day = new Date(Date.UTC(year, 10, firstThursday + 21 + 1))
    if (day.getTime() >= from.getTime() - 86400000) return day
  }
  throw new Error("unreachable")
}

function longDate(d: Date, us: boolean) {
  return d.toLocaleDateString(us ? "en-US" : "en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  })
}

type Email = { subject: string; paras: string[]; button?: { label: string; href: string }; after?: string[] }

function creatorEmail(step: number, us: boolean, progress: Progress, link = courseLink(us)): Email {
  const price = us ? "$199" : "£149"
  const bf = longDate(blackFriday(new Date()), us)
  // The group covers the UK, Ireland and the US (since 18 Sep 2026), so
  // every creator lead gets the invite.
  const group = [
    `Free mini course on reading your first brand brief. Join the group to get it: ${GROUP}`,
  ]

  if (step === 0) {
    return {
      subject: "The Golden Quarter is open",
      paras: [
        "Your free course, The Golden Quarter, is ready. The button below opens it, so there is no code to type and nothing to fill in.",
      ],
      button: { label: "Open lesson one", href: link },
      after: [
        "Five short lessons. Start with the first one: it explains why the Black Friday work you see in November was booked in September.",
        ...group,
      ],
    }
  }

  if (step === 1 && !progress.started) {
    return {
      subject: "Lesson one takes five minutes",
      paras: [
        "You asked for The Golden Quarter and have not started it yet. That is normal.",
        "Lesson one takes about five minutes. It explains why the Black Friday work you see in November was booked in September, which is the part most creators find out too late.",
        "The button opens it straight away, no code needed.",
      ],
      button: { label: "Open lesson one", href: link },
      after: group.length ? [`P.S. ${group[0]}`] : [],
    }
  }

  if (step === 1) {
    return {
      subject: "The Black Friday video that is still running in January",
      paras: [
        "A video made for Black Friday rarely stops on Black Friday. It runs through December, and often into the January sales. That is three campaigns, and most creators are paid for one.",
        `The fix is one line on your invoice: usage, paid social, ${us ? "US" : "UK"}, with an end date. Lesson three of the course walks through it.`,
        ...(us ? [] : ["What to charge for it, with the exact words to use when a brand asks: https://www.clickclick.video/creators/usage-rates/"]),
      ],
      button: { label: "Open the course", href: link },
      after: group.length ? [`P.S. ${group[0]}`] : [],
    }
  }

  // The pitch. Finishers hear it as a win the moment they are done; everyone
  // else hears it once, on day 7, as the season closing in. Either way it
  // carries the one real deadline there is: brands book Black Friday
  // creators in September and October.
  const roster = "Certified creators go on the roster ClickClick matches brands from, so getting it done this month puts you there before the season is booked."
  const last = ["If it is not for you, no problem. This is the last email about it."]
  const button = { label: "See the full course", href: "https://www.clickclick.video/creators/#price" }

  if (progress.finished) {
    return {
      subject: "You did the Golden Quarter",
      paras: [
        "You finished The Golden Quarter. Most people who start a free course never do.",
        `The rate calculator in the bonus lesson is one tool from the full UGC Content Creator Certification. The rest is 32 lessons: hooks and scripting, filming and editing on a phone, pricing, invoices, and a ${us ? "US" : "UK"} client contract you can use as it is.`,
        `Brands book their Black Friday creators in September and October. ${roster}`,
        `${price}, one payment, 12 months. No live calls. What you have done so far stays saved to your email.`,
      ],
      button,
      after: last,
    }
  }

  return {
    subject: "Before Black Friday is booked",
    paras: [
      `Black Friday is ${bf}. Brands book the creators for it in September and October, so most of that work is being decided now.`,
      `The Golden Quarter is still there when you want it: ${link} Its bonus lesson has the rate calculator from the full course.`,
      `If you want the whole thing now: the UGC Content Creator Certification, 32 lessons, ${price} for 12 months. ${roster}`,
    ],
    button,
    after: last,
  }
}

function brandEmail(step: number): Email {
  const bf = blackFriday(new Date())
  const weeks = Math.max(1, Math.round((bf.getTime() - Date.now()) / (7 * 86400000)))
  const score = "https://www.clickclick.video/readiness/"

  if (step === 0) {
    return {
      subject: "Your readiness score",
      paras: [
        "Here is the readiness score you asked for.",
        `Ten questions about your live shopping show, about two minutes. You get a score out of 100 and a plan with real dates, counted back from Black Friday on ${longDate(bf, false)}.`,
      ],
      button: { label: "Get my score", href: score },
      after: ["You can save the plan as a PDF at the end if you want to share it with your team."],
    }
  }

  return {
    subject: `Black Friday is ${weeks} week${weeks === 1 ? "" : "s"} away`,
    paras: [
      `Black Friday is ${longDate(bf, false)}.`,
      "If your score came back lower than you hoped, the gaps are usually the same few: nobody owns the show, the products are not picked, and the first run-through happens on the day.",
      "We make the software brands run live shopping shows on. If you would like to see it working, reply to this email and we will set up twenty minutes. No slides.",
    ],
    button: { label: "Do the score", href: score },
    after: ["Not done the score yet? The button above takes two minutes."],
  }
}

function render(email: Email, firstName: string, why: string, unsubPage: string) {
  const text = [
    `Hi ${firstName},`,
    ...email.paras,
    ...(email.button ? [`${email.button.label}: ${email.button.href}`] : []),
    ...(email.after ?? []),
    "ClickClick",
    "",
    `${why} Unsubscribe: ${unsubPage}`,
    ADDRESS,
  ].join("\n\n")

  // Links in body text become real links; everything else is escaped first.
  const linkify = (s: string) =>
    escapeHtml(s).replace(/https?:\/\/[^\s<]+[^\s<.,)]/g, (u) => `<a href="${u}" style="color:#141414">${u}</a>`)

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${email.paras.map((p) => `<p>${linkify(p)}</p>`).join("\n")}
${email.button ? `<p><a href="${email.button.href}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">${escapeHtml(email.button.label)}</a></p>` : ""}
${(email.after ?? []).map((p) => `<p>${linkify(p)}</p>`).join("\n")}
<p>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsubPage}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { text, html }
}

// "reject" means Resend refused the address itself (a typo, a fake one from
// Meta's test tool). Retrying that every ten minutes forever would be a loop,
// so the caller stops the lead instead. "retry" is anything that might work
// next time: no key, a timeout, a rate limit.
type SendResult = "ok" | "retry" | "reject"

async function sendStep(
  lead: Pick<Lead, "leadgen_id" | "audience" | "email" | "name">,
  step: number,
  to = lead.email,
  progress: Progress = { started: false, finished: false },
): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey || !lead.audience) return "retry"
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "reject"

  const email = lead.audience === "brand"
    ? brandEmail(step)
    : creatorEmail(step, lead.audience === "creator-us", progress, await leadCourseLink(lead.audience === "creator-us", lead.leadgen_id))
  const firstName = String(lead.name ?? "").trim().split(/\s+/)[0] || "there"
  // Academy sign-ups joined by ticking the box on the course form, not a lead ad.
  const why = lead.audience === "brand"
    ? "You are getting this because you asked for the readiness score on Facebook or Instagram."
    : lead.leadgen_id.startsWith("academy-")
    ? "You are getting this because you ticked the box for tips and news when you started The Golden Quarter."
    : "You are getting this because you asked for The Golden Quarter on Facebook or Instagram."
  const links = await unsubscribeLinks(lead.leadgen_id)
  const { text, html } = render(email, firstName, why, links.page)

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ClickClick <hello@clickclick.video>",
        to: [to],
        reply_to: "hello@clickclick.video",
        subject: email.subject,
        text,
        html,
        headers: {
          "List-Unsubscribe": `<${links.oneClick}>, <mailto:hello@clickclick.video?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    })
    if (!res.ok) {
      console.error("resend rejected a lead email:", res.status, await res.text())
      return res.status === 422 ? "reject" : "retry"
    }
    return "ok"
  } catch (err) {
    console.error("lead email failed:", (err as Error).message)
    return "retry"
  }
}

// How far a lead has got in their free course, found by the email they
// used in the Academy. A lead who used a different email there just looks
// like a non-starter, which only means they get the gentler emails.
async function courseProgress(admin: AdminClient, email: string, courseId: string): Promise<Progress> {
  const { data: students, error } = await admin
    .from("academy_students")
    .select("id")
    .ilike("email", email)
  if (error) throw error
  const ids = (students ?? []).map((s: { id: string }) => s.id)
  if (ids.length === 0) return { started: false, finished: false }
  const { data: rows, error: pErr } = await admin
    .from("academy_progress")
    .select("lesson_num")
    .in("student_id", ids)
    .eq("course_id", courseId)
  if (pErr) throw pErr
  const done = new Set((rows ?? []).map((r: { lesson_num: string }) => r.lesson_num))
  return { started: done.size > 0, finished: CORE_LESSONS.every((n) => done.has(n)) }
}

// A creator who has bought does not need to be sold the course.
async function hasBought(admin: AdminClient, email: string) {
  const { data, error } = await admin
    .from("academy_access_codes")
    .select("code")
    .ilike("email", email)
    .like("pack", "creator-ugc%")
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

async function sendDue(admin: AdminClient) {
  const { data, error } = await admin
    .from("meta_leads")
    .select("leadgen_id, audience, email, name, created_time, steps_sent, last_sent_at")
    .is("stopped_at", null)
    .not("audience", "is", null)
    .not("email", "is", null)
    .lt("steps_sent", 3)
    .order("created_time")
    .limit(300)
  if (error) throw error

  const now = Date.now()
  let sent = 0
  let failed = 0
  for (const lead of (data ?? []) as Lead[]) {
    const delays = DELAYS[lead.audience as Audience]
    if (!delays || lead.steps_sent >= delays.length) continue
    if (lead.last_sent_at && now - new Date(lead.last_sent_at).getTime() < MIN_GAP_HOURS * 3600000) continue

    // Creators past the welcome email: what they have done decides what
    // comes next. Finishing the free course jumps straight to the pitch,
    // skipping anything still queued, so nobody is told to "start lesson
    // one" after they have finished.
    let progress: Progress = { started: false, finished: false }
    let step = lead.steps_sent
    const courseId = FREE_COURSE[lead.audience as string]
    if (courseId && step >= 1) {
      progress = await courseProgress(admin, lead.email as string, courseId)
      if (progress.finished) step = delays.length - 1
    }
    const dueNow = progress.finished && step === delays.length - 1
    if (!dueNow && now < new Date(lead.created_time).getTime() + delays[step] * 86400000) continue

    const isSalesStep = lead.audience !== "brand" && step === delays.length - 1
    if (isSalesStep && await hasBought(admin, lead.email as string)) {
      await admin.from("meta_leads")
        .update({ stopped_at: new Date().toISOString(), stopped_reason: "bought" })
        .eq("leadgen_id", lead.leadgen_id)
      continue
    }

    // Claim first. Only the run whose update matches steps_sent = step gets
    // the row back, so an overlapping run cannot send the same step again.
    const { data: claimed, error: claimErr } = await admin
      .from("meta_leads")
      .update({ steps_sent: step + 1, last_sent_at: new Date().toISOString() })
      .eq("leadgen_id", lead.leadgen_id)
      .eq("steps_sent", lead.steps_sent)
      .select("leadgen_id")
    if (claimErr) throw claimErr
    if (!claimed || claimed.length === 0) continue

    const result = await sendStep(lead, step, lead.email, progress)
    if (result === "ok") {
      sent++
    } else if (result === "reject") {
      failed++
      await admin.from("meta_leads")
        .update({ stopped_at: new Date().toISOString(), stopped_reason: "email address rejected" })
        .eq("leadgen_id", lead.leadgen_id)
    } else {
      // Put it back so the next run tries again.
      failed++
      await admin.from("meta_leads")
        .update({ steps_sent: lead.steps_sent, last_sent_at: lead.last_sent_at })
        .eq("leadgen_id", lead.leadgen_id)
        .eq("steps_sent", step + 1)
    }
  }
  return { sent, failed }
}

// ------------------------------------------------------------ Broadcasts ----
//
// One-off emails to a whole audience, written here so every word Kathryn
// approved is in version control. Each lead gets a campaign at most once:
// meta_lead_broadcasts is claimed before sending.

type Broadcast = { subject: string; html: string; text: string }

function foundingSep26(us: boolean, firstName: string, unsub: string, link = courseLink(us)): Broadcast {
  const code = us ? "GOLDENQUARTERUS" : "GOLDENQUARTER"
  const promo = us ? "FOUNDING60" : "FOUNDING50"
  const off = us ? "$60" : "£50"
  const contract = us ? "US" : "UK"
  const ends = us ? "September 30, 11:59pm Eastern" : "30 September, 11:59pm"
  const oct31 = us ? "October 31" : "31 October"
  const season = us ? "Thanksgiving, Black Friday and the holidays" : "Black Friday and Christmas"
  const course = "https://www.clickclick.video/creators/#price"
  const subject = us ? "Before brands book their Black Friday creators" : "Your certificate is five lessons away"
  const why = "You're getting this because you asked for The Golden Quarter on Facebook or Instagram."

  const text = [
    `Hi ${firstName},`,
    "Your free course, The Golden Quarter, is waiting for you. Five short lessons, each one about ten minutes, and it saves your place if you stop halfway.",
    `Open lesson one: ${link}\nYour code: ${code}`,
    "Finish it and you get a certificate with its own credential ID, something you can show a brand.",
    `Why now: brands are booking creators for ${season} right now, through October. The first 20 people to get certified by ${oct31} go to the top of the list we match brands from.`,
    `Founding-member price: ${off} off the full course. 32 lessons, the ${contract} client contract, and the certificate brands check. Use code ${promo} at checkout. Ends ${ends}.\nSee the full course: ${course}`,
    `And if you want to ask questions or see what other creators are working on, our Facebook group is open: ${GROUP}`,
    "Kathryn\nClickClick",
    `${why} Unsubscribe: ${unsub}\n${ADDRESS}`,
  ].join("\n\n")

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
<p>Your free course, The Golden Quarter, is waiting for you. Five short lessons, each one about ten minutes, and it saves your place if you stop halfway.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open lesson one</a></p>
<p style="margin:0 0 18px;font-size:14px;color:#5c5c5c">Your code: <b style="color:#141414;letter-spacing:.04em">${code}</b></p>
<p>Finish it and you get a certificate with its own credential ID, something you can show a brand.</p>
<p><b>Why now:</b> brands are booking creators for ${season} right now, through October. The first 20 people to get certified by ${oct31} go to the top of the list we match brands from.</p>
<div style="background:#f6f3ec;border-radius:12px;padding:16px 18px;margin:20px 0">
<p style="margin:0 0 6px;font-weight:600">Founding-member price: ${off} off the full course</p>
<p style="margin:0 0 10px;font-size:15px">32 lessons, the ${contract} client contract, and the certificate brands check. Use code <b>${promo}</b> at checkout. Ends ${ends}.</p>
<a href="${course}" style="color:#141414;font-weight:600">See the full course &rarr;</a>
</div>
<p>And if you want to ask questions or see what other creators are working on, our Facebook group is open: <a href="${GROUP}" style="color:#141414">UGC Creators UK, Ireland &amp; USA</a>.</p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// Sent 20 Sep 2026 to everyone who asked for the free course and never got in.
// 50 of the first 58 stopped at the code box, so this is the same course with
// the code taken out of their hands. One link, on purpose: a wall of links
// reads as spam to Gmail.
function oneClickSep26(us: boolean, firstName: string, unsub: string, link = courseLink(us)): Broadcast {
  const code = us ? "GOLDENQUARTERUS" : "GOLDENQUARTER"
  const subject = "The Golden Quarter, without the code"
  const why = "You're getting this because you asked for The Golden Quarter on Facebook or Instagram."

  const text = [
    `Hi ${firstName},`,
    "You asked for The Golden Quarter, then had to find a code in an email and type it into a box. Most people did not bother, and that is my fault rather than theirs.",
    `This link opens the course on its own, no code: ${link}`,
    "It asks for your name and email once. That is what saves your place and puts your name on the certificate.",
    "Five lessons, about ten minutes each. The first one is why the Black Friday work you see in November was booked in September.",
    `If you would rather type it in yourself, your code is still ${code}.`,
    "Kathryn\nClickClick",
    `${why} Unsubscribe: ${unsub}\n${ADDRESS}`,
  ].join("\n\n")

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
<p>You asked for The Golden Quarter, then had to find a code in an email and type it into a box. Most people did not bother, and that is my fault rather than theirs.</p>
<p>This link opens the course on its own, no code:</p>
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open lesson one</a></p>
<p>It asks for your name and email once. That is what saves your place and puts your name on the certificate.</p>
<p>Five lessons, about ten minutes each. The first one is why the Black Friday work you see in November was booked in September.</p>
<p style="font-size:14px;color:#5c5c5c">If you would rather type it in yourself, your code is still <b style="color:#141414;letter-spacing:.04em">${code}</b>.</p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// Sent 21 Sep 2026 to leads who never opened the course. Until 20 Sep the
// "every 10 minutes" GitHub job really ran every 2 to 5 hours, so most of
// them got their link long after they had moved on. Stefan's copy, approved
// by Kathryn. Plain, one link, no offer: most never ticked a marketing box.
function buriedSep26(us: boolean, firstName: string, unsub: string, link: string): Broadcast {
  const subject = "Your course link, in case it got buried"
  const why = "You're getting this because you asked for The Golden Quarter on Facebook or Instagram."
  const paras = [
    "A few days ago you asked for The Golden Quarter, my free UGC course. My first email may have gone to spam or Promotions, so here's the link again.",
    "Lesson one takes five minutes. It explains why brands book their Black Friday creators in September, and what that means for you this month.",
  ]
  const after = "No code to type, no calls, and nobody will ask about your follower count."
  const text = [
    `Hi ${firstName},`,
    ...paras,
    `Open lesson one: ${link}`,
    after,
    "Kathryn\nClickClick",
    `${why} Unsubscribe: ${unsub}\n${ADDRESS}`,
  ].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open lesson one</a></p>
<p>${escapeHtml(after)}</p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// The "your basket is waiting" email (22 Sep 2026, Kathryn's wording): for
// anyone who opened the course and then stalled. No mention of any glitch:
// the course now remembers people, so this simply says their place is kept.
function resumeEmail(us: boolean, firstName: string, unsub: string, link: string): Broadcast {
  const subject = "Your place is saved"
  const why = "You're getting this because you asked for The Golden Quarter."
  const paras = [
    "Your place in The Golden Quarter is saved, along with anything you've already done.",
    "Lesson one takes about five minutes. It covers why the Black Friday work you see in November gets booked in September.",
  ]
  const after = "It's set up to remember you, so you can dip in whenever suits."
  const text = [`Hi ${firstName},`, ...paras, `Continue the course: ${link}`, after, "Kathryn\nClickClick", `${why} Unsubscribe: ${unsub}\n${ADDRESS}`].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Continue the course</a></p>
<p>${escapeHtml(after)}</p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// The last call on the founding price (sent 28-29 Sep 2026). Everyone who
// has not bought gets it, whether they finished the free course or not, so
// it points both ways: the paid course, and their saved place in the free one.
function foundingEndsSep26(us: boolean, firstName: string, unsub: string, link: string): Broadcast {
  const promo = us ? "FOUNDING60" : "FOUNDING50"
  const off = us ? "$60" : "£50"
  const price = us ? "$139 instead of $199" : "£99 instead of £149"
  const ends = us ? "this Wednesday, September 30, at 11:59pm Eastern" : "this Wednesday, 30 September, at 11:59pm"
  const contract = us ? "US" : "UK"
  const course = "https://www.clickclick.video/creators/#price"
  const subject = `${off} off ends Wednesday`
  const why = "You're getting this because you asked for The Golden Quarter."
  const paras = [
    `Quick one. The founding price on the full UGC course ends ${ends}.`,
    `Use code ${promo} at checkout and it's ${price}.`,
    `You get 32 lessons, the ${contract} client contract you can send to brands, and a certificate brands can check.`,
  ]
  const after = "Still on the free course? That stays free, and your place is saved."
  const text = [`Hi ${firstName},`, ...paras, `See the full course: ${course}`, `${after} ${link}`, "Kathryn\nClickClick", `${why} Unsubscribe: ${unsub}\n${ADDRESS}`].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${course}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">See the full course</a></p>
<p>${escapeHtml(after)} <a href="${link}" style="color:#141414;font-weight:600">Continue the free course &rarr;</a></p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// For leads who still have not opened the course (sent 2 Oct 2026). Asks
// for one word back, so we learn what is stopping people. Replies land in
// hello@clickclick.video.
function whatStoppedOct26(_us: boolean, firstName: string, unsub: string, link: string): Broadcast {
  const subject = "Can I ask you something?"
  const why = "You're getting this because you asked for The Golden Quarter."
  const paras = [
    "You asked for The Golden Quarter, my free UGC course, but it's still unopened.",
    "Can I ask what got in the way? Just hit reply. One word is plenty: busy, forgot, not for me, or something else.",
    "I read every reply. It helps me make the course better for the next person.",
  ]
  const after = "If you still want it, it's here, no code needed:"
  const text = [`Hi ${firstName},`, ...paras, `${after} ${link}`, "Kathryn\nClickClick", `${why} Unsubscribe: ${unsub}\n${ADDRESS}`].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p>${escapeHtml(after)}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open lesson one</a></p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

// Sends resumeEmail once to each lead who opened the course, has not
// finished it, and has done nothing for a day. Runs with every cron run;
// meta_lead_broadcasts (campaign "resume") is the once-only claim. Only
// people in meta_leads, i.e. who agreed to hear from us. Capped per run so
// the drip keeps its share of Resend's daily limit.
async function sendResumes(admin: AdminClient, max = 30) {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) return { resumes: 0 }
  const now = Date.now()
  const { data: students, error } = await admin
    .from("academy_students")
    .select("id, email, created_at")
    .in("access_code", ["GOLDENQUARTER", "GOLDENQUARTERUS"])
    .gte("created_at", new Date(now - 7 * 86400000).toISOString())
    .lte("created_at", new Date(now - 86400000).toISOString())
  if (error) throw error
  let sent = 0
  for (const st of (students ?? []) as Array<{ id: string; email: string; created_at: string }>) {
    if (sent >= max) break
    const { data: leads } = await admin.from("meta_leads")
      .select("leadgen_id, audience, name, email, last_sent_at")
      .ilike("email", st.email).is("stopped_at", null).not("audience", "is", null).limit(1)
    const lead = leads?.[0] as Lead | undefined
    if (!lead || lead.audience === "brand") continue
    const { data: already } = await admin.from("meta_lead_broadcasts")
      .select("leadgen_id").eq("leadgen_id", lead.leadgen_id).eq("campaign", "resume").limit(1)
    if (already?.length) continue
    if (lead.last_sent_at && now - new Date(lead.last_sent_at).getTime() < MIN_GAP_HOURS * 3600000) continue
    const { data: rows } = await admin.from("academy_progress")
      .select("lesson_num, submitted_at").eq("student_id", st.id)
    const done = new Set((rows ?? []).map((r: { lesson_num: string }) => r.lesson_num))
    if (CORE_LESSONS.every((n) => done.has(n))) continue
    const lastTouch = Math.max(new Date(st.created_at).getTime(),
      ...(rows ?? []).map((r: { submitted_at: string }) => new Date(r.submitted_at).getTime()))
    if (now - lastTouch < 86400000) continue

    // Daytime only, in their own time zone: 8am to 8pm UK or US Eastern.
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", hour12: false, timeZone: lead.audience === "creator-us" ? "America/New_York" : "Europe/London",
    }).format(new Date()))
    if (hour < 8 || hour >= 20) continue

    const { error: claimErr } = await admin.from("meta_lead_broadcasts").insert({ leadgen_id: lead.leadgen_id, campaign: "resume" })
    if (claimErr) continue
    const us = lead.audience === "creator-us"
    const firstName = String(lead.name ?? "").trim().split(/\s+/)[0] || "there"
    const links = await unsubscribeLinks(lead.leadgen_id)
    const res = await sendCampaignEmail(apiKey, lead.email as string, resumeEmail(us, firstName, links.page, await leadCourseLink(us, lead.leadgen_id)), links.oneClick)
    if (res.ok) {
      sent++
      await admin.from("meta_leads").update({ last_sent_at: new Date().toISOString() }).eq("leadgen_id", lead.leadgen_id)
    } else {
      console.error("resume send failed:", res.status, await res.text())
      await admin.from("meta_lead_broadcasts").delete().eq("leadgen_id", lead.leadgen_id).eq("campaign", "resume")
    }
  }
  return { resumes: sent }
}

// ------------------------------------------------- Students, not leads ----
//
// Everything above this line is keyed on meta_leads: a Facebook lead form
// comes in, and the day 0, day 2 and day 7 sequence and the resume nudge
// follow it. Anyone who signed up any other way (an Instagram DM, a Facebook
// group, the website) has no lead row, and until 26 Sep 2026 every one of
// those lookups skipped them. They received nothing, ever. With the ads off,
// that is everyone arriving.
//
// So this is the same care, driven off academy_students. Three emails:
//
//   welcome  their link back in, once, soon after they sign up
//   resume   they have not finished and have not touched it for two days
//   offer    day 7, the paid course, and only with marketing consent
//
// The first two are about the course they asked for. The third is marketing,
// so it needs the tick box (PECR), and it is not sent to anyone who never
// opened a lesson: pitching £149 to someone who has not read a word is how
// you lose them.
const STUDENT_MAX_PER_RUN = 25

// Byte for byte what academy-progress computes for the same student, so its
// ?u=&t= link check passes: same secret, same HMAC, same 16-byte truncation.
async function studentSig(studentId: string): Promise<string> {
  return await sign(`student:${studentId}`)
}

// Students unsubscribe with the same signed link, marked "s:" so the handler
// knows to look in academy_students rather than meta_leads.
async function studentUnsubLinks(studentId: string) {
  const id = `s:${studentId}`
  const s = await sign(id)
  const q = `u=${encodeURIComponent(id)}&s=${s}`
  return { page: `https://www.clickclick.video/unsubscribe/?${q}`, oneClick: `${FUNCTION_URL}?${q}` }
}

function studentCourseLink(code: string, courseId: string, src: string, studentId: string, sig: string) {
  return `${ACADEMY}?k=${encodeURIComponent(code)}${courseId ? `&c=${courseId}` : ""}&src=${src}&u=${studentId}&t=${sig}`
}

function welcomeEmail(firstName: string, unsub: string, link: string): Broadcast {
  const subject = "Your link into The Golden Quarter"
  const why = "You're getting this because you signed up for The Golden Quarter."
  const paras = [
    "Here is your way back into the course. Keep this email: the link opens it on any phone or laptop, and it remembers where you got to.",
    "Five short lessons. The first one explains why the Black Friday work you see in November was booked back in September.",
  ]
  const after = "Nothing to pay, and no calls. Finish the five and there is a certificate with an ID a brand can look up."
  const text = [`Hi ${firstName},`, ...paras, `Open the course: ${link}`, after, "Kathryn\nClickClick", `${why} Unsubscribe: ${unsub}\n${ADDRESS}`].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open the course</a></p>
<p>${escapeHtml(after)}</p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

function studentOfferEmail(us: boolean, firstName: string, unsub: string, link: string): Broadcast {
  const price = us ? "$199" : "£149"
  const contract = us ? "US" : "UK"
  const course = "https://www.clickclick.video/creators/#price"
  const subject = "The full course, if the free one was useful"
  const why = "You're getting this because you signed up for The Golden Quarter and ticked to hear from us."
  const paras = [
    "You have been working through The Golden Quarter, so this is the one email about the paid one.",
    `It is ${price}, one payment, 12 months. 32 lessons, the ${contract} client contract you can send to brands, and a certificate with an ID a brand can check.`,
    "If the free course is all you wanted, that is genuinely fine. It stays open and your place stays saved.",
  ]
  const after = "Either way, finish the five lessons and get your certificate."
  const text = [`Hi ${firstName},`, ...paras, `See the full course: ${course}`, `${after} ${link}`, "Kathryn\nClickClick", `${why} Unsubscribe: ${unsub}\n${ADDRESS}`].join("\n\n")
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
${paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p><a href="${course}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">See the full course</a></p>
<p>${escapeHtml(after)} <a href="${link}" style="color:#141414;font-weight:600">Continue the free course &rarr;</a></p>
<p>Kathryn<br>ClickClick</p>
<p style="color:#5c5c5c;font-size:13px;margin-top:28px">${escapeHtml(why)} <a href="${unsub}" style="color:#5c5c5c">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</p>
</div>`
  return { subject, html, text }
}

type StudentRow = {
  id: string
  name: string | null
  email: string | null
  access_code: string | null
  created_at: string
  marketing_consent: boolean | null
  unsubscribed_at: string | null
}

async function sendStudentFollowUps(admin: AdminClient, dry = false) {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey && !dry) return { students: 0, planned: [] as string[] }
  const now = Date.now()

  const { data, error } = await admin
    .from("academy_students")
    .select("id, name, email, access_code, created_at, marketing_consent, unsubscribed_at")
    .in("access_code", ["GOLDENQUARTER", "GOLDENQUARTERUS"])
    .is("unsubscribed_at", null)
    .not("email", "is", null)
    .gte("created_at", new Date(now - 60 * 86400000).toISOString())
    .order("created_at")
  if (error) throw error

  let sent = 0
  const planned: string[] = []
  const seen = new Set<string>()

  for (const st of (data ?? []) as StudentRow[]) {
    if (sent >= STUDENT_MAX_PER_RUN) break
    const email = String(st.email ?? "").trim()
    if (!email) continue
    // A few people signed up twice with two addresses; one email each.
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    // Leads already have their own sequence above. This is only for the people
    // that sequence cannot see.
    const { data: leads } = await admin.from("meta_leads")
      .select("leadgen_id").ilike("email", email).not("audience", "is", null).limit(1)
    if ((leads as unknown[] | null)?.length) continue

    const us = String(st.access_code ?? "").toUpperCase() === "GOLDENQUARTERUS"
    const courseId = us ? FREE_COURSE["creator-us"] : FREE_COURSE["creator-uk"]

    const { data: rows } = await admin.from("academy_progress")
      .select("lesson_num, submitted_at").eq("student_id", st.id)
    const done = new Set((rows ?? []).map((r: { lesson_num: string }) => r.lesson_num))
    const finished = CORE_LESSONS.every((n) => done.has(n))
    const started = done.size > 0
    const signedUp = new Date(st.created_at).getTime()
    const lastTouch = Math.max(signedUp,
      ...(rows ?? []).map((r: { submitted_at: string }) => new Date(r.submitted_at).getTime()))

    const { data: sends } = await admin.from("academy_sends")
      .select("campaign, sent_at").eq("student_id", st.id)
    const already = new Map((sends ?? []).map((r: { campaign: string; sent_at: string }) => [r.campaign, r.sent_at]))
    const lastSend = Math.max(0, ...(sends ?? []).map((r: { sent_at: string }) => new Date(r.sent_at).getTime()))
    if (lastSend && now - lastSend < MIN_GAP_HOURS * 3600000) continue

    // Which one is due. First match wins, so nobody gets two in a day.
    let campaign = ""
    if (!already.has("welcome")) {
      campaign = "welcome"
    } else if (!finished && !already.has("resume") && now - lastTouch >= 2 * 86400000) {
      campaign = "resume"
    } else if (
      !already.has("offer") &&
      st.marketing_consent === true &&
      started &&
      now - signedUp >= 7 * 86400000
    ) {
      if (await hasBought(admin, email)) continue
      campaign = "offer"
    }
    if (!campaign) continue

    // Daytime where they are, same rule as the lead sequence.
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", hour12: false, timeZone: us ? "America/New_York" : "Europe/London",
    }).format(new Date()))
    if (hour < 8 || hour >= 20) continue

    if (dry) {
      planned.push(`${campaign}: ${email}`)
      continue
    }

    // Claim first, so two overlapping runs cannot send the same one twice.
    const { error: claimErr } = await admin.from("academy_sends")
      .insert({ student_id: st.id, campaign })
    if (claimErr) continue

    const firstName = String(st.name ?? "").trim().split(/\s+/)[0] || "there"
    const links = await studentUnsubLinks(st.id)
    const link = studentCourseLink(
      String(st.access_code ?? ""), courseId, campaign, st.id, await studentSig(st.id),
    )
    const body = campaign === "welcome"
      ? welcomeEmail(firstName, links.page, link)
      : campaign === "resume"
      ? resumeEmail(us, firstName, links.page, link)
      : studentOfferEmail(us, firstName, links.page, link)

    const res = await sendCampaignEmail(apiKey as string, email, body, links.oneClick)
    if (res.ok) {
      sent++
    } else {
      console.error("student send failed:", campaign, res.status, await res.text())
      await admin.from("academy_sends").delete().eq("student_id", st.id).eq("campaign", campaign)
    }
  }
  return { students: sent, planned }
}

// link is the lead's own signed course link (leadCourseLink); older
// campaigns ignore it.
type BroadcastBuilder = (us: boolean, firstName: string, unsub: string, link: string) => Broadcast
const CAMPAIGNS: Record<string, BroadcastBuilder> = {
  "founding-sep26": foundingSep26,
  "one-click-sep26": oneClickSep26,
  "buried-sep26": buriedSep26,
  "founding-ends-sep26": foundingEndsSep26,
  "what-stopped-oct26": whatStoppedOct26,
  // Sent automatically by sendResumes; listed here so it can be test-sent.
  "resume": resumeEmail,
}
// Campaigns only for people who never opened the course.
const NOT_STARTED_ONLY = new Set(["buried-sep26", "what-stopped-oct26"])

// One campaign-style email from Kathryn, with the one-click unsubscribe
// headers every marketing email here carries.
async function sendCampaignEmail(apiKey: string, to: string, b: Broadcast, oneClick: string, sendAt?: string) {
  return await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Kathryn at ClickClick <hello@clickclick.video>",
      to: [to],
      reply_to: "hello@clickclick.video",
      subject: b.subject,
      text: b.text,
      html: b.html,
      ...(sendAt ? { scheduled_at: sendAt } : {}),
      headers: {
        "List-Unsubscribe": `<${oneClick}>, <mailto:hello@clickclick.video?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  })
}

async function sendBroadcast(opts: {
  admin: AdminClient
  campaign: string
  audience: Audience
  sendAt?: string
  dryRun: boolean
  // Most to send in this call: Resend's free plan stops at 100 a day, and the
  // drip needs its share.
  max?: number
}) {
  const { admin, campaign, audience, sendAt, dryRun } = opts
  const max = Math.max(0, Math.floor(opts.max ?? 1000))
  const build = CAMPAIGNS[campaign]
  if (!build || audience === "brand") throw new Error("Unknown campaign or audience.")
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) throw new Error("No RESEND_API_KEY.")

  const { data, error } = await admin
    .from("meta_leads")
    .select("leadgen_id, audience, email, name")
    .eq("audience", audience)
    .is("stopped_at", null)
    .not("email", "is", null)
  if (error) throw error

  const result = { eligible: 0, sent: 0, skipped: [] as string[], failed: 0 }
  for (const lead of (data ?? []) as Lead[]) {
    const email = lead.email as string
    if (await hasBought(admin, email)) { result.skipped.push("bought"); continue }
    const { data: already } = await admin.from("meta_lead_broadcasts")
      .select("leadgen_id").eq("leadgen_id", lead.leadgen_id).eq("campaign", campaign).limit(1)
    if (already?.length) { result.skipped.push("already sent"); continue }
    if (NOT_STARTED_ONLY.has(campaign)) {
      const { data: student } = await admin.from("academy_students").select("id").ilike("email", email).limit(1)
      if (student?.length) { result.skipped.push("opened the course"); continue }
    }
    result.eligible++
    if (dryRun || result.sent + result.failed >= max) continue

    // Claim first, so two calls can never both send it.
    const { error: claimErr } = await admin.from("meta_lead_broadcasts")
      .insert({ leadgen_id: lead.leadgen_id, campaign })
    if (claimErr) { result.skipped.push("claimed elsewhere"); continue }

    const firstName = String(lead.name ?? "").trim().split(/\s+/)[0] || "there"
    const links = await unsubscribeLinks(lead.leadgen_id)
    const b = build(audience === "creator-us", firstName, links.page, await leadCourseLink(audience === "creator-us", lead.leadgen_id))
    const res = await sendCampaignEmail(apiKey, email, b, links.oneClick, sendAt)
    if (res.ok) {
      result.sent++
    } else {
      result.failed++
      console.error("broadcast send failed:", res.status, await res.text())
      await admin.from("meta_lead_broadcasts").delete()
        .eq("leadgen_id", lead.leadgen_id).eq("campaign", campaign)
    }
  }
  return result
}

// ----------------------------------------------------------------- Serve ----

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin")
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders(origin) })
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Server not configured." }, origin)
  const admin = createClient(supabaseUrl, serviceKey)

  // One-click unsubscribe from the mail app itself: u and s in the query
  // string, and a form body we do not need to read.
  const query = new URL(req.url).searchParams
  if (query.get("u") && query.get("s")) {
    const ok = await unsubscribe(admin, query.get("u") as string, query.get("s") as string)
    return json(ok ? 200 : 400, { ok }, origin)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: "Expected JSON." }, origin)
  }

  if (body.type === "unsubscribe") {
    const ok = await unsubscribe(admin, String(body.u ?? ""), String(body.s ?? ""))
    return json(ok ? 200 : 400, { ok }, origin)
  }

  const cronKey = Deno.env.get("CRON_KEY")
  if (!cronKey || !timingSafeEqual(String(body.key ?? ""), cronKey)) {
    return json(401, { error: "Not allowed." }, origin)
  }

  // studentFollowUps {dry} -> who would get what, and nothing is sent unless
  // dry is explicitly false. The cron key is already checked above.
  if (body.type === "studentFollowUps") {
    return json(200, await sendStudentFollowUps(admin, body.dry !== false), origin)
  }

  if (body.type === "preview") {
    const to = String(body.to ?? "").trim().toLowerCase()
    if (!to.endsWith("@clickclick.video")) return json(400, { error: "Previews only go to @clickclick.video." }, origin)
    const audience = String(body.audience ?? "") as Audience
    if (!DELAYS[audience]) return json(400, { error: "Unknown audience." }, origin)
    const step = Number(body.step ?? 0)
    if (!(step >= 0 && step < DELAYS[audience].length)) return json(400, { error: "Unknown step." }, origin)
    const progress: Progress = { started: Boolean(body.started), finished: Boolean(body.finished) }
    const result = await sendStep({ leadgen_id: "preview", audience, email: to, name: "Sarah" }, step, to, progress)
    return json(result === "ok" ? 200 : 502, { ok: result === "ok", result }, origin)
  }

  // Read-only ad stats for reports: spend, reach and sign-ups, optionally
  // split by region. Uses the same system-user token (ads_read, View
  // performance only), so it can look but never change or spend anything.
  if (body.type === "insights") {
    const token = Deno.env.get("META_LEADS_TOKEN")
    if (!token) return json(503, { error: "No token." }, origin)
    const since = String(body.since ?? "")
    const until = String(body.until ?? "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return json(400, { error: "since and until must be YYYY-MM-DD." }, origin)
    }
    const breakdown = String(body.breakdown ?? "")
    if (breakdown && !["region", "country", "age", "gender", "publisher_platform"].includes(breakdown)) {
      return json(400, { error: "Unknown breakdown." }, origin)
    }
    const level = body.level === "ad" ? "ad" : "campaign"
    const params: Record<string, string> = {
      level,
      fields: "campaign_name,ad_name,spend,impressions,reach,actions,cost_per_action_type",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    }
    if (breakdown) params.breakdowns = breakdown
    try {
      const data = await graph(`act_${Deno.env.get("META_AD_ACCOUNT_ID") ?? "1122147610145033"}/insights`, token, params)
      const rows = (data.data ?? []).map((r: Record<string, unknown>) => {
        const acts = (r.actions ?? []) as Array<{ action_type: string; value: string }>
        const leads = acts.filter((a) => a.action_type === "lead" || a.action_type === "leadgen_grouped")
          .reduce((m, a) => Math.max(m, Number(a.value)), 0)
        return {
          campaign: r.campaign_name,
          ad: r.ad_name,
          [breakdown || "all"]: breakdown ? r[breakdown] : "all",
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          reach: Number(r.reach ?? 0),
          leads,
        }
      })
      return json(200, { rows }, origin)
    } catch (err) {
      return json(502, { error: (err as Error).message }, origin)
    }
  }

  if (body.type === "broadcast") {
    const campaign = String(body.campaign ?? "")
    const audience = String(body.audience ?? "") as Audience
    const sendAt = body.sendAt ? String(body.sendAt) : undefined
    const testTo = body.testTo ? String(body.testTo).trim().toLowerCase() : ""
    const build = CAMPAIGNS[campaign]
    if (!build || !DELAYS[audience] || audience === "brand") {
      return json(400, { error: "Unknown campaign or audience." }, origin)
    }
    // A test goes to one @clickclick.video inbox only and is not recorded.
    if (testTo) {
      // Our own inbox, or mail-tester's throwaway spam-score sink. Both are
      // places we control the content of, so neither can be used to post a
      // ClickClick-branded email to a stranger.
      const testOk = testTo.endsWith("@clickclick.video") || testTo.endsWith("@srv1.mail-tester.com")
      if (!testOk) return json(400, { error: "Tests only go to @clickclick.video." }, origin)
      // testLead: a meta_leads row that is itself a test inbox, so the test
      // carries a real signed one-tap link. Never a real lead's id.
      let link = courseLink(audience === "creator-us")
      if (body.testLead) {
        const { data: t } = await admin.from("meta_leads").select("email").eq("leadgen_id", String(body.testLead)).limit(1)
        const te = String(t?.[0]?.email ?? "").toLowerCase()
        if (!(te.endsWith("@clickclick.video") || te.endsWith("@srv1.mail-tester.com"))) {
          return json(400, { error: "testLead must be a test inbox." }, origin)
        }
        link = await leadCourseLink(audience === "creator-us", String(body.testLead))
      }
      const b = build(audience === "creator-us", "Sarah", "https://www.clickclick.video/unsubscribe/", link)
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Kathryn at ClickClick <hello@clickclick.video>", to: [testTo], subject: `[TEST] ${b.subject}`, text: b.text, html: b.html }),
      })
      return json(res.ok ? 200 : 502, { ok: res.ok }, origin)
    }
    try {
      const max = body.max === undefined ? undefined : Number(body.max)
      const result = await sendBroadcast({ admin, campaign, audience, sendAt, dryRun: body.dryRun !== false, max })
      return json(200, result, origin)
    } catch (err) {
      return json(500, { error: (err as Error).message }, origin)
    }
  }

  // sendOne {key, to, subject, text, sendAt?} -> one email from hello@, as
  // Kathryn would write it herself.
  //
  // Lark has no send-later, and some emails have to land at a civilised hour
  // rather than whenever the work got finished. Key-gated exactly like the
  // broadcasts, and deliberately plain text: this is for a note to one person,
  // never a campaign. Campaigns go through CAMPAIGNS so the wording stays in
  // version control.
  // campaigns {key} -> id, name, status of every campaign on the ad account
  // campaignStatus {key, id, status: "PAUSED" | "ACTIVE"} -> switch one
  //
  // Ads Manager locks up in the browser when a campaign toggle is clicked, and
  // "pause the ads" is not something that should depend on a web page loading.
  // Switching on is allowed too, but only ever because Kathryn asked.
  if (body.type === "campaigns" || body.type === "campaignStatus") {
    const token = Deno.env.get("META_LEADS_TOKEN")
    if (!token) return json(503, { error: "No token." }, origin)
    const account = `act_${Deno.env.get("META_AD_ACCOUNT_ID") ?? "1122147610145033"}`
    try {
      if (body.type === "campaigns") {
        const data = await graph(`${account}/campaigns`, token, {
          fields: "id,name,status,effective_status,daily_budget",
          limit: "50",
        })
        return json(200, { campaigns: data.data ?? [] }, origin)
      }
      const id = String(body.id ?? "")
      const status = String(body.status ?? "")
      if (!/^\d+$/.test(id) || !["PAUSED", "ACTIVE"].includes(status)) {
        return json(400, { error: "Needs a campaign id and PAUSED or ACTIVE." }, origin)
      }
      const res = await fetch(`${GRAPH}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status, access_token: token }),
      })
      const out = await res.json()
      if (!res.ok || out.error) {
        return json(502, { error: out.error?.message ?? `Meta said ${res.status}` }, origin)
      }
      return json(200, { ok: true, id, status }, origin)
    } catch (e) {
      return json(502, { error: (e as Error).message }, origin)
    }
  }

  // cancelScheduled {key, id} -> {ok}: calls off a sendOne booked with sendAt.
  if (body.type === "cancelScheduled") {
    const id = String(body.id ?? "")
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Bad id." }, origin)
    const res = await fetch(`https://api.resend.com/emails/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}` },
    })
    return json(res.ok ? 200 : 502, { ok: res.ok, detail: res.ok ? undefined : await res.text() }, origin)
  }

  if (body.type === "sendOne") {
    const to = String(body.to ?? "").trim().toLowerCase()
    const subject = String(body.subject ?? "").trim().slice(0, 200)
    const text = String(body.text ?? "")
    const sendAt = body.sendAt ? String(body.sendAt) : ""
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: "That address does not look right." }, origin)
    if (!subject || !text) return json(400, { error: "Needs a subject and a body." }, origin)

    const apiKey = Deno.env.get("RESEND_API_KEY")
    if (!apiKey) return json(503, { error: "No RESEND_API_KEY." }, origin)

    const payload: Record<string, unknown> = {
      from: "Kathryn at ClickClick <hello@clickclick.video>",
      to: [to],
      reply_to: "hello@clickclick.video",
      subject,
      text,
    }
    if (sendAt) payload.scheduled_at = sendAt

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) return json(502, { error: "Resend refused it.", detail: out }, origin)
    return json(200, { ok: true, id: out.id ?? null, scheduledFor: sendAt || "now" }, origin)
  }

  if (body.type === "run") {
    const result: Record<string, unknown> = {}
    const token = Deno.env.get("META_LEADS_TOKEN")
    if (token) {
      try {
        Object.assign(result, await fetchLeads(admin, token))
      } catch (err) {
        // Still send what is already due. A Meta outage should not also hold
        // back the emails of people who signed up yesterday.
        console.error("fetching leads failed:", (err as Error).message)
        result.fetchError = (err as Error).message
      }
    } else {
      result.fetch = "skipped, META_LEADS_TOKEN is not set"
    }
    Object.assign(result, await sendDue(admin))
    try {
      Object.assign(result, await sendResumes(admin))
    } catch (err) {
      console.error("resumes failed:", (err as Error).message)
    }
    // Everyone who never came from a lead form: DMs, Facebook groups, the
    // website. Kept separate so a failure here cannot hold up the lead emails.
    try {
      Object.assign(result, await sendStudentFollowUps(admin))
    } catch (err) {
      console.error("student follow-ups failed:", (err as Error).message)
    }
    return json(result.fetchError ? 502 : 200, result, origin)
  }

  return json(400, { error: "Unknown action." }, origin)
})
