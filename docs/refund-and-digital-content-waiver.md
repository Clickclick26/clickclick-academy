# Refunds and the digital content waiver

The customer-facing page is live at `refund-policy.html`, linked quietly from
the Academy footer. This file is the spec for the checkout half, which cannot
be built until a checkout exists.

**Get a solicitor to check the wording before you take a single payment.**
This is real consumer-protection law (Consumer Contracts (Information,
Cancellation and Additional Charges) Regulations 2013, and the Consumer
Rights Act 2015). The shape here is right. The final wording is not Claude's
to sign off.

---

## The one rule that decides everything

UK consumers get 14 days to cancel an online purchase and get a full refund,
even after using it. For digital content delivered immediately there is an
exception, but it only applies if **all three** of these happened:

1. The buyer gave **express consent** to getting access before the 14 days
   were up, and
2. The buyer **acknowledged** that doing so loses them the cancellation
   right, and
3. The trader gave them **confirmation of that consent and acknowledgement**
   on a durable medium (the order confirmation email counts).

Miss any one and the waiver is void. The buyer keeps the full 14-day right,
finishes all 32 lessons, and is legally entitled to their money back.

## Why "hide it" does not work

Kathryn asked whether the wording could be hard to find. On the goodwill
refund, yes, freely. On the waiver, no, and not for squeamish reasons: a
buried consent is not express consent, so burying it **destroys the
protection it exists to give**. A hidden waiver is worse than no waiver,
because you think you are covered and you are not. It is also a misleading
omission under the Consumer Protection from Unfair Trading Regulations 2008.

So the split is:

| Thing | Status | Why |
|---|---|---|
| The checkout tick box | **Must be plainly visible** | Void otherwise. This is the whole point. |
| Telling them the 14-day right exists and how it is lost | **Required** | CCRs 2013 pre-contract information. |
| Trader contact details | **Required** | CCRs 2013 pre-contract information. |
| "Does not affect your statutory rights" line | **Keep** | Not strictly mandatory, but a refund policy silent on the Consumer Rights Act reads as an attempt to exclude it, which is an unfair term under the CRA 2015. Cheap insurance. |
| The refund policy page itself | Reachable | A quiet footer link is normal and fine. |
| ~~7-day goodwill refund~~ | **Removed 16 Sep 2026** | Never a legal requirement, and the only thing on the page that actively generated refunds. |
| ~~"Wait 14 days for access instead" option~~ | **Removed 16 Sep 2026** | Not required. The law needs express consent, not an alternative offer. |

## The checkout tick box (required)

Directly above the pay button. **Never pre-ticked.** The buyer cannot pay
until it is ticked.

```html
<label class="checkout-consent">
  <input type="checkbox" id="consent-waiver" name="consent-waiver" required />
  <span>
    I want access straight away, and I understand that once the course is
    made available to me I lose my 14-day right to cancel for a refund.
  </span>
</label>
<p class="checkout-consent-link">
  <a href="/refund-policy.html" target="_blank" rel="noopener">Refunds and cancellation</a>
</p>
```

One sentence, plain, no scare block. That is as light as it can legally be.

## After payment

The order confirmation email must repeat the consent back to them. This is
point 3 above and it is the one people forget.

> You told us at checkout that you wanted access straight away, and that you
> understood this means you no longer have the 14-day right to cancel for a
> refund. You still have your rights if anything is faulty or not as
> described.

Store the consent against the order: timestamp, the exact wording shown, and
the fact it was ticked. If a chargeback ever comes in, that record is the
evidence.

## Policy position: legal minimum, nothing extra

Kathryn's instruction (16 Sep 2026) is to keep only what the law requires, to
hold refunds down. The page is now exactly that.

There is no advertised refund window and no promise of a goodwill refund.
That is legal: outside the statutory rights above, a trader is not obliged to
refund a digital course the buyer simply changed their mind about, once the
waiver is validly taken.

She can still refund anyone she wants, case by case. The difference is that
she is no longer promising it in writing, so nobody can hold her to it.

Two things worth knowing about the trade-off, neither of which changes the
legal position:

- Some buyers check the refund policy before purchasing. A page with no
  goodwill window converts slightly worse than one with a visible guarantee.
  That is a pricing and marketing decision, not a legal one.
- A flat refusal to an unhappy buyer is the most common trigger for a Stripe
  chargeback, which costs the fee plus admin whether or not she wins. Quietly
  refunding a determined complainer is usually cheaper than fighting one.

## Out of scope

- The CLocal Creator Programme. Free, no payment, nothing to refund.
- Stripe chargebacks and disputes. Separate process, Stripe's own rules.
- Non-UK buyers. EU and US rules differ. Revisit if that becomes real.

## Sources (not legal advice)

- Which?, [Consumer Contracts Regulations](https://www.which.co.uk/consumer-rights/regulation/consumer-contracts-regulations-ajWHC8m21cAk)
- Rocket Lawyer UK, [consumer rights when purchasing digital content](https://www.rocketlawyer.com/gb/en/family-and-personal/buy-and-sell-goods/legal-guide/consumer-rights-when-purchasing-digital-content)

## Payment rail: Stripe, and do not sell to the EU yet

Decided 16 Sep 2026 on Enzo's advice, after both he and Elena landed on Stripe
independently.

**Not a merchant of record.** Lemon Squeezy or Paddle would handle EU VAT, but
they are VAT registered everywhere including the UK, so the moment one becomes
the seller, UK VAT is charged on UK sales. About 80% of sales are UK, so that
trades away the under-threshold advantage on the bulk of the revenue to solve a
problem worth a handful of Irish sales. Roughly £336 a year in Stripe fees
versus £1,300 to £3,700 all in.

**Revised the same day: Lemon Squeezy for Irish and EU consumers only.** The
objection above holds for using a merchant of record for *everything*, and it
still does. It does not hold for a second button used only by EU buyers. UK and
rest-of-world sales stay on Stripe and stay under the UK threshold; Ireland and
the EU go through Lemon Squeezy, which becomes the legal seller and carries the
Irish VAT. No Irish VAT registration, no non-Union OSS, no quarterly returns.
Costs roughly 5 to 7% on those sales only, about £6 on a £99 course.

Why it is needed at all: Kathryn is not VAT registered, and the EU has no
threshold, so a single sale to an Irish consumer creates an Irish VAT liability
immediately. Northern Ireland's post-Brexit status does not help, because the
Windsor Framework covers goods and a course is a service, so Belfast is treated
as plain UK for this.

Sales to *businesses* in the Republic holding a VAT number are fine on Stripe
today under reverse charge. It is only Irish consumers that need the other rail.

Invest NI: checked against the Ambition to Grow FAQs. The external-sales
exclusion names *Northern Ireland based* distributors, and Lemon Squeezy is a
payment merchant rather than a distributor, so these still count as cross-border
sales. Worth one line to the adviser in writing before claiming against targets.

**Status 16 Sep 2026: decided, not built.** No Lemon Squeezy account exists and
nothing is wired on the site. Until it is, there is no euro route, and creating
a euro Stripe link instead would create exactly the Irish VAT liability this
avoids.

**Not Revolut.** It is an acquirer, so it fixes nothing on tax, and its
checkout cannot cap a discount code by uses, which FOUNDING50 needs. It also
carries a real risk of a rolling reserve on an intangible digital product.

**Block EU buyers at checkout**, since the EU is the only place with no
threshold at all: one sale to Dublin means Irish VAT at 23% and non-Union OSS.
Everywhere else has a floor nowhere near being crossed (US ~$100k, Canada
CAD 30,000, Australia AUD 75,000, Norway NOK 50,000, Switzerland CHF 100,000).

**Revisit when EU demand passes about £4,000 in a rolling year**: add a second,
EU-only buy button on a merchant of record. That leaves the UK VAT position
untouched. Not a rebuild, not an OSS registration.

## Legal jobs before the first payment

In order. The first four cost real money if skipped.

1. **Block EU sales at the front end.** Country question moves BEFORE the pay
   button. Backstop with a Stripe Radar rule on EU card countries. Refund
   anyone who slips through on a VPN rather than serving them.
2. **Open the Stripe account.** ClickClick Ltd, company number, Arthur House
   Belfast, business bank account, director ID. Start first, verification
   queues.
3. **Consent tick box and confirmation email.** Spec is above and unchanged.
   Miss any part and every buyer keeps a full 14-day refund right after
   finishing all 32 lessons. The stripped-back refund page makes this MORE
   important, not less: it is now the only thing standing between ClickClick
   and a valid refund demand from someone who read the lot.
4. **Pre-contract information on the sales page.** Trader name, company number,
   registered address, contact email, total price including tax, what they get,
   how long access lasts, how to complain. Same regulations. Ten minutes.
5. **ICO data protection fee.** Holding student names, emails, countries,
   progress and certificates makes ClickClick Ltd a data controller. The annual
   fee is a legal obligation with a fine attached, not a subscription. Check
   whether the company is already registered. Add a privacy notice while there.
6. **Wire payment to access.** Stripe webhook, access code, email. Decide now
   that a refund or chargeback revokes the code and the certificate. Store the
   consent record against the order.
7. **Launch single payment only.** Add 2 x £79 in week two.
8. **45 minutes with an accountant**, two questions: does gating the EU keep
   ClickClick outside non-Union OSS, and when does course income take the
   company over the £90,000 rolling threshold once added to everything else.

## Bookkeeping note

Record the gross £149 as turnover and the Stripe fee as a cost. Netting it off
understates turnover and therefore mistracks the VAT threshold, which is the
one number that cannot be wrong here.
