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
//   creator-uk / creator-us  day 0 the code, day 2 the usage point, day 5 the
//                            paid course, skipped if they have already bought
//   brand                    day 0 the score link, day 3 an offer to talk
//
// Actions (POST, JSON):
//   run          {type, key}                        from the scheduled job
//   preview      {type, key, to, audience, step}    sends one email to a
//                                                   @clickclick.video inbox
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

// Days after the lead came in that each step goes out.
const DELAYS: Record<Audience, number[]> = {
  "creator-uk": [0, 2, 5],
  "creator-us": [0, 2, 5],
  brand: [0, 3],
}

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

function creatorEmail(step: number, us: boolean): Email {
  const code = us ? "GOLDENQUARTERUS" : "GOLDENQUARTER"
  const price = us ? "$199" : "£149"
  // The group is UK and Ireland only and screens on where people are based,
  // so US leads are never invited. They would only be declined.
  const group = us ? [] : [
    `Free mini course on reading your first brand brief. Join the group to get it: ${GROUP}`,
  ]

  if (step === 0) {
    return {
      subject: `Your code: ${code}`,
      paras: [
        `Your code for The Golden Quarter is ${code}.`,
        "Open the Academy, type the code in, then put your name and this email address in once. That is what saves your progress.",
      ],
      button: { label: "Open the course", href: ACADEMY },
      after: [
        "Five short lessons. Start with the first one: it explains why the Black Friday work you see in November was booked in September.",
        ...group,
      ],
    }
  }

  if (step === 1) {
    return {
      subject: "The Black Friday video that is still running in January",
      paras: [
        "A video made for Black Friday rarely stops on Black Friday. It runs through December, and often into the January sales. That is three campaigns, and most creators are paid for one.",
        `The fix is one line on your invoice: usage, paid social, ${us ? "US" : "UK"}, with an end date. Lesson three of the course walks through it.`,
        ...(us ? [] : ["What to charge for it, with the exact words to use when a brand asks: https://www.clickclick.video/creators/usage-rates/"]),
        `Not opened the course yet? Your code is ${code}.`,
      ],
      button: { label: "Open the course", href: ACADEMY },
      after: group.length ? [`P.S. ${group[0]}`] : [],
    }
  }

  return {
    subject: "If you want the rest of it",
    paras: [
      "The Golden Quarter was five lessons. The full UGC Content Creator Certification is 32: hooks and scripting, filming and editing on a phone, pricing and usage, and invoices.",
      `It comes with a ${us ? "US" : "UK"} client contract you can use as it is, and a certificate with its own credential ID.`,
      `${price}, one payment, 12 months. No live calls and no start date. Your Golden Quarter progress stays saved to your email.`,
    ],
    button: { label: "See the full course", href: "https://www.clickclick.video/creators/#price" },
    after: ["If it is not for you, no problem. This is the last email about it."],
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

async function sendStep(lead: Pick<Lead, "leadgen_id" | "audience" | "email" | "name">, step: number, to = lead.email): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey || !lead.audience) return "retry"
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "reject"

  const email = lead.audience === "brand" ? brandEmail(step) : creatorEmail(step, lead.audience === "creator-us")
  const firstName = String(lead.name ?? "").trim().split(/\s+/)[0] || "there"
  const why = lead.audience === "brand"
    ? "You are getting this because you asked for the readiness score on Facebook or Instagram."
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
    const step = lead.steps_sent
    if (!delays || step >= delays.length) continue
    if (now < new Date(lead.created_time).getTime() + delays[step] * 86400000) continue
    if (lead.last_sent_at && now - new Date(lead.last_sent_at).getTime() < MIN_GAP_HOURS * 3600000) continue

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
      .eq("steps_sent", step)
      .select("leadgen_id")
    if (claimErr) throw claimErr
    if (!claimed || claimed.length === 0) continue

    const result = await sendStep(lead, step)
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
        .update({ steps_sent: step, last_sent_at: lead.last_sent_at })
        .eq("leadgen_id", lead.leadgen_id)
        .eq("steps_sent", step + 1)
    }
  }
  return { sent, failed }
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

  if (body.type === "preview") {
    const to = String(body.to ?? "").trim().toLowerCase()
    if (!to.endsWith("@clickclick.video")) return json(400, { error: "Previews only go to @clickclick.video." }, origin)
    const audience = String(body.audience ?? "") as Audience
    if (!DELAYS[audience]) return json(400, { error: "Unknown audience." }, origin)
    const step = Number(body.step ?? 0)
    if (!(step >= 0 && step < DELAYS[audience].length)) return json(400, { error: "Unknown step." }, origin)
    const result = await sendStep({ leadgen_id: "preview", audience, email: to, name: "Sarah" }, step, to)
    return json(result === "ok" ? 200 : 502, { ok: result === "ok", result }, origin)
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
    return json(result.fetchError ? 502 : 200, result, origin)
  }

  return json(400, { error: "Unknown action." }, origin)
})
