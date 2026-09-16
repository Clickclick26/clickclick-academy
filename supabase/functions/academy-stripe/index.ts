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
// And RUN-THIS-buyer-codes.sql run once.
//
// Verify JWT must be OFF for this function. Stripe will not send a Supabase
// anon key with its webhooks, and the thank-you page is on a different site.
// The webhook is protected by Stripe's own signature; claim is protected by
// the fact that a session id is useless without a real paid session behind it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import Stripe from "npm:stripe@17.7.0"

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
}

// Falls back to what was actually paid if the payment link is ever replaced
// and this file has not caught up. Better a right tier from the wrong signal
// than a buyer locked out because a link id changed.
function tierFromAmount(amount: number | null | undefined) {
  if (typeof amount === "number" && amount >= 20000) return LINK_TIERS.plink_1UGMiS2YYPNSFgcI2CISoeZx
  return LINK_TIERS.plink_1UGLlO2YYPNSFgcILXoOuuA6
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
    .select("code, tier, pack, email, name, revoked, issued_at, consent")
    .eq("stripe_session_id", session.id)
    .limit(1)
  if (findErr) throw findErr
  if (already && already.length > 0) return { row: already[0], created: false }

  const linkId = idOf(session.payment_link)
  const tier = LINK_TIERS[linkId] ?? tierFromAmount(session.amount_total)
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
      .select("code, tier, pack, email, name, revoked, issued_at, consent")
      .single()
    if (!insErr) return { row: created, created: true }

    // 23505 is a unique violation. Either the code collided, or the other
    // path minted this session's code while we were working. Read it back.
    if (insErr.code === "23505") {
      const { data: raced } = await admin
        .from("academy_access_codes")
        .select("code, tier, pack, email, name, revoked, issued_at, consent")
        .eq("stripe_session_id", session.id)
        .limit(1)
      if (raced && raced.length > 0) return { row: raced[0], created: false }
      continue
    }
    throw insErr
  }
  throw new Error("Could not mint a unique access code.")
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

function consentGiven(consent: unknown): boolean {
  return String(consent ?? "").trim().toLowerCase().startsWith("i agree")
}

function heldUntil(issuedAt: unknown): string {
  const start = new Date(String(issuedAt ?? "") || Date.now())
  start.setDate(start.getDate() + COOLING_OFF_DAYS)
  return start.toISOString()
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
}) {
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
    "When you paid you asked for access straight away and gave up the 14-day cancellation right. That is why you can open it now.",
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
<p style="color:#5c5c5c;font-size:14px">When you paid you asked for access straight away and gave up the 14-day cancellation right. That is why you can open it now.</p>
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
          // Only ever email on the insert that actually created the row, so a
          // webhook retry or the thank-you page racing it cannot send twice.
          if (created && consentGiven(row.consent)) await sendCodeEmail(row)
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

    // --- The thank-you page asking for its code ---------------------------
    const body = await req.json()
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

    const { row, created } = await mintCode(admin, session as unknown as SessionLike)
    const tierInfo = LINK_TIERS[idOf((session as unknown as SessionLike).payment_link)] ??
      tierFromAmount(session.amount_total)

    // Kept their cancellation right, so the course cannot be handed over yet.
    // The row still exists and the payment is recorded; only the code waits.
    if (!consentGiven(row.consent)) {
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

    if (created) await sendCodeEmail(row)

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
