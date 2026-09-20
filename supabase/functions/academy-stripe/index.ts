// The bit between Stripe taking the money and the buyer being able to open
// anything. Before this existed a payment went through and nothing happened:
// no page, no code, no record of who had bought which tier.
//
// Two ways in, one outcome:
//
//   Stripe webhook  POST with a stripe-signature header
//     checkout.session.completed  -> mint this buyer's code
//     charge.refunded             -> revoke it
//     charge.dispute.created      -> revoke it
//     charge.refund.updated       -> revoke it if the refund succeeded
//
//   release  {adminKey}  once a day from GitHub Actions
//     Sends the codes of anyone who kept their 14-day cancellation right and
//     whose 14 days are now up. Without this the thank-you page's promise
//     that "we will send it on <date>" was never kept by anything.
//
//   claim  {sessionId}  from the thank-you page on clickclick.video
//     Retrieves the session from Stripe, checks it is actually paid, and
//     mints the same code. Deliberately not dependent on the webhook: the
//     buyer is staring at the page the second they pay, and a webhook that
//     is slow, misconfigured or replaying must not leave them with nothing.
//
// Both paths write the same row and the unique constraint on
// stripe_session_id is what stops one payment ever minting two codes.
//
// Needs these secrets set on the project (Edge Functions -> Secrets):
//   STRIPE_SECRET_KEY       required, this reads sessions back from Stripe
//   STRIPE_WEBHOOK_SECRET   required only for refunds and chargebacks
//   RESEND_API_KEY          optional, emails the code as well as showing it
//   ACADEMY_ADMIN_KEY       release by hand, same key academy-progress uses
//   CRON_KEY                release from the scheduled job, shared with meta-leads
// And RUN-THIS-buyer-codes.sql then RUN-THIS-release-held-codes.sql run once.
//
// Verify JWT must be OFF for this function. Stripe will not send a Supabase
// anon key with its webhooks, and the thank-you page is on a different site.
// The webhook is protected by Stripe's own signature; claim is protected by
// the fact that a session id is useless without a real paid session behind it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import Stripe from "npm:stripe@17.7.0"
import { addToList, BOUGHT_LIST, upsertContact } from "../_shared/crm.ts"

const ALLOWED_ORIGINS = new Set([
  "https://www.clickclick.video",
  "https://clickclick.video",
  "https://academy.clickclick.video",
  "https://clickclick26.github.io",
  "http://localhost:5199",
  "http://127.0.0.1:5199",
])

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.clickclick.video"
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

// Which payment link bought which tier. Read from the link rather than the
// amount, because a promotion code changes the amount and FOUNDING50 exists.
const LINK_TIERS: Record<string, { tier: string; pack: string; label: string }> = {
  plink_1UGLlO2YYPNSFgcILXoOuuA6: {
    tier: "certification",
    pack: "creator-ugc",
    label: "UGC Content Creator Certification",
  },
  plink_1UGMiS2YYPNSFgcI2CISoeZx: {
    tier: "priority",
    pack: "creator-ugc-priority",
    label: "UGC Content Creator Certification + Priority",
  },
  // The Ireland and EU pair. Same products and same price to the buyer, but
  // sold through Stripe's Managed Payments, so Stripe is the merchant of
  // record and owns the VAT. What the buyer gets is identical, which is why
  // they map to the same packs.
  plink_1UGQvK2YYPNSFgcIjXEnBcKY: {
    tier: "certification",
    pack: "creator-ugc",
    label: "UGC Content Creator Certification",
  },
  plink_1UGQyv2YYPNSFgcIQ7k8IBlq: {
    tier: "priority",
    pack: "creator-ugc-priority",
    label: "UGC Content Creator Certification + Priority",
  },
  // The US edition. Dollar prices, and a course with US contracts, FTC rules
  // and US rates, so it opens different packs from the UK pair.
  plink_1UH0U42YYPNSFgcIbPfF6E7V: {
    tier: "certification",
    pack: "creator-ugc-us",
    label: "UGC Content Creator Certification (US)",
  },
  plink_1UH0Xe2YYPNSFgcIVTiI585T: {
    tier: "priority",
    pack: "creator-ugc-us-priority",
    label: "UGC Content Creator Certification + Priority (US)",
  },
  // The business course, "Make Your Own Videos", £199, added 20 Sep 2026.
  // A different audience from everything above: a shop filming its own front
  // door, not a creator chasing brand work. Same pair-of-links shape as the
  // certification — a UK link where we are the seller, and a Managed Payments
  // link where Stripe is merchant of record and owns the VAT, which is what
  // makes an Irish or EU sale legal without registering for VAT there. A UK
  // seller gets no threshold on B2C digital services into the EU: the VAT is
  // due from the first sale, so an EU buyer must never go through the UK link.
  plink_1UHpx72YYPNSFgcITi6Eu55j: {
    tier: "business",
    pack: "business-video",
    label: "Make Your Own Videos",
  },
  plink_1UHpuP2YYPNSFgcIGRirwPH6: {
    tier: "business",
    pack: "business-video",
    label: "Make Your Own Videos",
  },
}

// Falls back to what was actually paid if the payment link is ever replaced
// and this file has not caught up. Better a right tier from the wrong signal
// than a buyer locked out because a link id changed.
//
// This only works because the amounts do not collide:
//   GBP   9900 creator FOUNDING50 · 13900 business FIRSTFORTY · 14900 creator
//        19900 business · 24900 creator priority
//   USD  19900 US creator · 32900 US creator priority
//
// Note 19900 means the BUSINESS course in pounds and the US CERTIFICATION in
// dollars, so the currency branch has to come first. Before the two links
// above existed, £199 fell through to the cheapest GBP tier and would have
// handed a business buyer the creator certification.
//
// If a new price is ever added that collides with one of these, this function
// stops being safe and the collision has to be resolved here first.
const BUSINESS_AMOUNTS_GBP = new Set([13900, 19900])

function tierFromAmount(amount: number | null | undefined, currency?: string | null) {
  if (currency === "usd") {
    const priority = typeof amount === "number" && amount >= 26000
    return priority ? LINK_TIERS.plink_1UH0Xe2YYPNSFgcIVTiI585T : LINK_TIERS.plink_1UH0U42YYPNSFgcIbPfF6E7V
  }
  if (typeof amount === "number" && BUSINESS_AMOUNTS_GBP.has(amount)) {
    return LINK_TIERS.plink_1UHpx72YYPNSFgcITi6Eu55j
  }
  const priority = typeof amount === "number" && amount >= 20000
  return priority ? LINK_TIERS.plink_1UGMiS2YYPNSFgcI2CISoeZx : LINK_TIERS.plink_1UGLlO2YYPNSFgcILXoOuuA6
}

// No 0/O/1/I. These get read down a phone and typed in by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function randomBlock(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

// deno-lint-ignore no-explicit-any
type AdminClient = any

type SessionLike = {
  id: string
  payment_status?: string | null
  status?: string | null
  amount_total?: number | null
  currency?: string | null
  payment_link?: string | { id: string } | null
  payment_intent?: string | { id: string } | null
  customer_details?: { email?: string | null; name?: string | null } | null
  customer_email?: string | null
  custom_fields?: Array<{ dropdown?: { value?: string | null } | null }> | null
}

function idOf(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value
  const obj = value as { id?: string }
  return obj.id ?? ""
}

// Idempotent. Both the webhook and the thank-you page call this for the same
// payment, sometimes within the same second, so it reads before it writes and
// treats a unique violation as "the other one got there first".
async function mintCode(admin: AdminClient, session: SessionLike) {
  const { data: already, error: findErr } = await admin
    .from("academy_access_codes")
    .select("code, tier, pack, email, name, revoked, issued_at, consent, code_sent_at")
    .eq("stripe_session_id", session.id)
    .limit(1)
  if (findErr) throw findErr
  if (already && already.length > 0) return { row: already[0], created: false }

  const linkId = idOf(session.payment_link)
  const tier = LINK_TIERS[linkId] ?? tierFromAmount(session.amount_total, session.currency)
  const email = String(session.customer_details?.email ?? session.customer_email ?? "")
    .trim()
    .toLowerCase()
  const name = String(session.customer_details?.name ?? "").trim()
  const consent = String(session.custom_fields?.[0]?.dropdown?.value ?? "")

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `CC-${randomBlock(4)}-${randomBlock(4)}`
    const { data: created, error: insErr } = await admin
      .from("academy_access_codes")
      .insert({
        code,
        pack: tier.pack,
        tier: tier.tier,
        email,
        name,
        stripe_session_id: session.id,
        stripe_payment_intent: idOf(session.payment_intent) || null,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        consent,
      })
      .select("code, tier, pack, email, name, revoked, issued_at, consent, code_sent_at, amount_total, currency")
      .single()
    if (!insErr) {
      // Only on the first mint for this payment, so the alert and the CRM
      // entry happen once however many times the webhook or the thank-you
      // page call in.
      await onNewSale(admin, created as SaleRow, tier.label)
      return { row: created, created: true }
    }

    // 23505 is a unique violation. Either the code collided, or the other
    // path minted this session's code while we were working. Read it back.
    if (insErr.code === "23505") {
      const { data: raced } = await admin
        .from("academy_access_codes")
        .select("code, tier, pack, email, name, revoked, issued_at, consent, code_sent_at")
        .eq("stripe_session_id", session.id)
        .limit(1)
      if (raced && raced.length > 0) return { row: raced[0], created: false }
      continue
    }
    throw insErr
  }
  throw new Error("Could not mint a unique access code.")
}


type SaleRow = {
  code: string
  email: string
  name?: string
  pack: string
  tier: string
  consent?: string
  amount_total?: number | null
  currency?: string | null
}

function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (typeof amount !== "number") return "unknown amount"
  const cur = (currency ?? "gbp").toUpperCase()
  try {
    return new Intl.NumberFormat(cur === "USD" ? "en-US" : "en-GB", { style: "currency", currency: cur }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ${cur}`
  }
}

// What happens once per new sale, on top of the buyer's own code email:
// Kathryn hears about it, and the buyer lands in the CRM on the "Bought a
// course" list so they can be upsold later. Both best effort: neither may
// ever get in the way of the buyer receiving what they paid for.
async function onNewSale(admin: AdminClient, row: SaleRow, label: string) {
  const price = money(row.amount_total, row.currency)
  const us = row.pack.includes("-us")

  try {
    const contactId = await upsertContact(admin, {
      email: row.email,
      name: row.name,
      source: "academy",
      stage: "won",
      tags: ["academy", "creator", "bought", row.pack, us ? "us" : "uk"],
      note: `Bought ${label} for ${price} (code ${row.code})`,
    })
    if (contactId) await addToList(admin, BOUGHT_LIST, contactId)
  } catch (err) {
    console.error("buyer -> crm failed:", (err as Error).message)
  }

  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) return
  const held = !consentGiven(row.consent)
  const lines = [
    `${price}: ${label}`,
    `Buyer: ${row.name || "(no name)"} <${row.email}>`,
    `Code: ${row.code}`,
    held
      ? "They kept their 14-day cancellation right, so the code goes out automatically when the 14 days are up."
      : "They asked for access now, so they already have their code.",
    "They are in the CRM on the \"Bought a course\" list.",
  ]
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ClickClick Academy <hello@clickclick.video>",
        to: ["hello@clickclick.video"],
        subject: `New sale: ${price} ${label}`,
        text: lines.join("\n\n"),
      }),
    })
    if (!res.ok) console.error("sale alert rejected:", res.status, await res.text())
  } catch (err) {
    console.error("sale alert failed:", (err as Error).message)
  }
}

// The 14-day cancellation right. At checkout the buyer picks one of two
// answers, and the answer decides whether the code goes out now.
//
// "I agree..." means they asked for it straight away and gave the right up,
// which is what the Consumer Contracts Regulations require before digital
// content can be handed over inside the cooling-off period. Anyone who picks
// the other answer keeps the right, so the code is held for 14 days rather
// than sent. In practice almost nobody picks it, and holding it is cheaper
// than arguing about a refund later.
const COOLING_OFF_DAYS = 14

// Stripe hands back the dropdown's VALUE, not the label the buyer read. It
// derives that value by lowercasing the label and stripping everything that
// is not a letter or a digit, so "I agree. Give me access now..." arrives as
// "iagreegivemeaccessnow...". Matching on the readable label silently failed
// and told everyone who agreed that they had chosen to wait 14 days. Compare
// like for like: flatten both sides the same way.
function consentGiven(consent: unknown): boolean {
  const flat = String(consent ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
  return flat.startsWith("iagree")
}

function heldUntil(issuedAt: unknown): string {
  const start = new Date(String(issuedAt ?? "") || Date.now())
  start.setDate(start.getDate() + COOLING_OFF_DAYS)
  return start.toISOString()
}

// The 14 days are up, so the right to cancel has expired and the course can
// be handed over. An unparseable issued_at reads as "not yet" rather than
// "release it", because the wrong answer here gives away a refundable course.
function coolingOffOver(issuedAt: unknown): boolean {
  const due = new Date(heldUntil(issuedAt)).getTime()
  return Number.isFinite(due) && due <= Date.now()
}

// Same compare as academy-progress uses for its admin actions. Length first,
// then every character, so a wrong key cannot be found a byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

// Best effort and deliberately so: a mail failure must never stop a buyer
// getting their code. The thank-you page has already shown it, and it is in
// the database either way, so the worst case is Kathryn sending it by hand.
async function sendCodeEmail(row: {
  code: string
  email: string
  name?: string
  tier?: string
}, released = false) {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) {
    console.error("no RESEND_API_KEY, skipping code email for", row.code)
    return false
  }
  if (!row.email) return false

  const firstName = String(row.name ?? "").trim().split(/\s+/)[0] || "there"
  const isPriority = row.tier === "priority"
  const academy = "https://academy.clickclick.video/"

  const lines = [
    `Hi ${firstName},`,
    "",
    `Your access code is ${row.code}`,
    "",
    `Open ${academy} and put that code in. Then put your name and this email address in once. That is what saves your progress, so use the same email every time.`,
    "",
    isPriority
      ? "Your portfolio page is in there too, under \"Your portfolio page\". Fill it in whenever you have something worth showing."
      : "",
    "Your progress is saved against your email rather than the device you are on, so nothing is lost if you clear your browser or move to a different phone.",
    "",
    released
      ? "At checkout you chose to keep your 14-day cancellation right, so we held this back rather than sending it. That period has now passed, so here it is."
      : "When you paid you asked for access straight away and gave up the 14-day cancellation right. That is why you can open it now.",
    "",
    "Lost this email? Reply to it and we will find your code.",
    "",
    "ClickClick Video Marketing Ltd",
  ].filter((l) => l !== "")

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#141414;max-width:520px">
<p>Hi ${escapeHtml(firstName)},</p>
<p style="margin:0 0 6px">Your access code is</p>
<p style="font-size:30px;font-weight:700;letter-spacing:.06em;margin:0 0 20px">${escapeHtml(row.code)}</p>
<p><a href="${academy}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#141414;color:#F0EAD6;text-decoration:none;font-weight:500">Open the Academy</a></p>
<p>Put that code in, then put your name and this email address in once. That is what saves your progress, so use the same email every time.</p>
${isPriority ? '<p>Your portfolio page is in there too, under "Your portfolio page". Fill it in whenever you have something worth showing.</p>' : ""}
<p>Your progress is saved against your email rather than the device you are on, so nothing is lost if you clear your browser or move to a different phone.</p>
<p style="color:#5c5c5c;font-size:14px">${
    released
      ? "At checkout you chose to keep your 14-day cancellation right, so we held this back rather than sending it. That period has now passed, so here it is."
      : "When you paid you asked for access straight away and gave up the 14-day cancellation right. That is why you can open it now."
  }</p>
<p style="color:#5c5c5c;font-size:14px">Lost this email? Reply to it and we will find your code.</p>
<p style="color:#5c5c5c;font-size:14px">ClickClick Video Marketing Ltd</p>
</div>`

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ClickClick Academy <hello@clickclick.video>",
        to: [row.email],
        subject: `Your access code: ${row.code}`,
        text: lines.join("\n"),
        html,
      }),
    })
    if (!res.ok) {
      console.error("resend rejected the code email:", res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error("code email failed:", (err as Error).message)
    return false
  }
}

// Claims the send before making it. code_sent_at is set with a conditional
// update, so of two callers racing on the same code exactly one gets the row
// back and the other stops; the daily release and a buyer refreshing the
// thank-you page cannot both email. A send that then fails puts the stamp
// back to null, because a buyer with no code must stay on the retry list.
async function deliverCode(admin: AdminClient, row: {
  code: string
  email: string
  name?: string
  tier?: string
  code_sent_at?: string | null
}, released = false): Promise<boolean> {
  if (row.code_sent_at) return false
  if (!row.email) return false

  const { data: claimed, error } = await admin
    .from("academy_access_codes")
    .update({ code_sent_at: new Date().toISOString() })
    .eq("code", row.code)
    .is("code_sent_at", null)
    .select("code")
  if (error) throw error
  if (!claimed || claimed.length === 0) return false

  const ok = await sendCodeEmail(row, released)
  if (!ok) {
    await admin
      .from("academy_access_codes")
      .update({ code_sent_at: null })
      .eq("code", row.code)
    console.error("code email failed, left", row.code, "on the retry list")
  }
  return ok
}

// A refund or a chargeback should take back what was bought. Revoking the
// code is what actually does it: every other action resolves a student's
// access through their code, so a revoked one closes the course, the
// portfolio page and any future certificate in one go. Certificates already
// issued are marked unapproved so a revoked buyer cannot keep waving one.
async function revokeByPaymentIntent(admin: AdminClient, intentId: string, reason: string) {
  if (!intentId) return 0
  const { data: rows, error } = await admin
    .from("academy_access_codes")
    .update({ revoked: true, revoked_reason: reason })
    .eq("stripe_payment_intent", intentId)
    .select("code, email")
  if (error) throw error

  for (const row of rows ?? []) {
    const { data: students } = await admin
      .from("academy_students")
      .select("id")
      .eq("access_code", row.code)
    for (const student of students ?? []) {
      await admin
        .from("academy_certificates")
        .update({ approved: false })
        .eq("student_id", student.id)
    }
  }
  return (rows ?? []).length
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
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Server not configured." }, origin)
  if (!stripeKey) {
    return json(503, { error: "Payments not connected yet. Set STRIPE_SECRET_KEY." }, origin)
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" })
  const signature = req.headers.get("stripe-signature")

  try {
    // --- Stripe webhook ---------------------------------------------------
    if (signature) {
      const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")
      if (!webhookSecret) return json(503, { error: "No webhook secret set." }, origin)

      const raw = await req.text()
      let event: Stripe.Event
      try {
        event = await stripe.webhooks.constructEventAsync(raw, signature, webhookSecret)
      } catch (err) {
        // A bad signature is someone posting at the endpoint, not Stripe.
        console.error("stripe signature rejected:", (err as Error).message)
        return json(400, { error: "Bad signature." }, origin)
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as unknown as SessionLike
        if (session.payment_status === "paid") {
          const { row, created } = await mintCode(admin, session)
          console.log("minted", row.code, "for", row.email, created ? "(new)" : "(already had one)")
          // deliverCode decides whether this one has already gone out, so a
          // webhook retry or the thank-you page racing it cannot send twice.
          if (consentGiven(row.consent)) await deliverCode(admin, row)
        }
        return json(200, { received: true }, origin)
      }

      if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
        const obj = event.data.object as unknown as { payment_intent?: string | { id: string } }
        const n = await revokeByPaymentIntent(admin, idOf(obj.payment_intent), event.type)
        console.log("revoked", n, "code(s) for", event.type)
        return json(200, { received: true, revoked: n }, origin)
      }

      if (event.type === "charge.refund.updated") {
        const refund = event.data.object as unknown as {
          status?: string
          payment_intent?: string | { id: string }
        }
        if (refund.status === "succeeded") {
          await revokeByPaymentIntent(admin, idOf(refund.payment_intent), "refund")
        }
        return json(200, { received: true }, origin)
      }

      return json(200, { received: true, ignored: event.type }, origin)
    }

    const body = await req.json()

    // --- Send the codes whose 14 days are up ------------------------------
    // Called twice a day by .github/workflows/release-held-codes.yml with
    // CRON_KEY, the key the scheduled jobs share. The admin key still works
    // for running it by hand. Either way it is locked: this reads buyers'
    // names and emails, and a stranger triggering it could time an email at
    // someone.
    if (body?.type === "release") {
      const keys = [Deno.env.get("ACADEMY_ADMIN_KEY"), Deno.env.get("CRON_KEY")].filter(Boolean) as string[]
      if (keys.length === 0) return json(500, { error: "Release not configured." }, origin)
      const given = String(body.adminKey ?? "")
      if (!keys.some((k) => timingSafeEqual(given, k))) {
        return json(401, { error: "Not authorised." }, origin)
      }

      const dueBefore = new Date(Date.now() - COOLING_OFF_DAYS * 86400000).toISOString()
      const { data: waiting, error: waitErr } = await admin
        .from("academy_access_codes")
        .select("code, tier, pack, email, name, revoked, issued_at, consent, code_sent_at")
        .is("code_sent_at", null)
        .eq("revoked", false)
        .lte("issued_at", dueBefore)
        .limit(200)
      if (waitErr) throw waitErr

      let sent = 0
      for (const row of waiting ?? []) {
        // A row here is usually someone who kept their cancellation right,
        // but it can also be a send that failed earlier. Only the first kind
        // should be told their waiting period is over.
        if (await deliverCode(admin, row, !consentGiven(row.consent))) sent++
      }
      console.log("release:", sent, "sent of", (waiting ?? []).length, "due")
      return json(200, { sent, due: (waiting ?? []).length }, origin)
    }

    // --- The thank-you page asking for its code ---------------------------
    if (body?.type !== "claim") return json(400, { error: "Unknown request type." }, origin)

    const sessionId = String(body.sessionId ?? "").trim()
    // Stripe's own id format. Anything else is not worth a round trip.
    if (!/^cs_[A-Za-z0-9_]{10,120}$/.test(sessionId)) {
      return json(400, { error: "That does not look like a payment." }, origin)
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId)
    } catch (_err) {
      return json(404, { error: "We cannot find that payment." }, origin)
    }

    if (session.payment_status !== "paid") {
      return json(402, { error: "That payment has not gone through." }, origin)
    }

    const { row } = await mintCode(admin, session as unknown as SessionLike)
    const tierInfo = LINK_TIERS[idOf((session as unknown as SessionLike).payment_link)] ??
      tierFromAmount(session.amount_total, session.currency)

    // Kept their cancellation right, so the course cannot be handed over yet
    // -- unless the 14 days have since run out, in which case the right has
    // expired and this page hands it straight over. The row still exists and
    // the payment is recorded either way; only the code waits.
    const waived = consentGiven(row.consent)
    if (!waived && !coolingOffOver(row.issued_at)) {
      return json(
        200,
        {
          code: "",
          held: true,
          availableFrom: heldUntil(row.issued_at),
          email: row.email,
          name: row.name,
        },
        origin,
      )
    }

    // Not gated on `created`: a webhook that minted the row and then failed
    // to send is exactly the case this needs to cover.
    if (!row.revoked) await deliverCode(admin, row, !waived)

    return json(
      200,
      {
        code: row.revoked ? "" : row.code,
        revoked: row.revoked === true,
        tier: row.tier,
        label: tierInfo.label,
        email: row.email,
        name: row.name,
        portfolio: row.tier === "priority",
      },
      origin,
    )
  } catch (err) {
    console.error("academy-stripe error:", err)
    return json(500, { error: "Something went wrong." }, origin)
  }
})
