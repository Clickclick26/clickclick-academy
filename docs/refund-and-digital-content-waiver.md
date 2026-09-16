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

| Thing | Must be visible? | Why |
|---|---|---|
| The checkout tick box | **Yes, plainly** | Void otherwise. This is the whole point. |
| The refund policy page | Reachable | A quiet footer link is normal and fine. |
| The 7-day goodwill refund | No | Not a legal requirement at all. Shrink it or bin it. |

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

## What is deliberately NOT prominent

The 7-day goodwill refund. It is on the policy page, it is honoured, and it
is not advertised on the sales page. That is entirely Kathryn's call and
entirely legal, because nothing obliges her to offer it.

## Out of scope

- The CLocal Creator Programme. Free, no payment, nothing to refund.
- Stripe chargebacks and disputes. Separate process, Stripe's own rules.
- Non-UK buyers. EU and US rules differ. Revisit if that becomes real.

## Sources (not legal advice)

- Which?, [Consumer Contracts Regulations](https://www.which.co.uk/consumer-rights/regulation/consumer-contracts-regulations-ajWHC8m21cAk)
- Rocket Lawyer UK, [consumer rights when purchasing digital content](https://www.rocketlawyer.com/gb/en/family-and-personal/buy-and-sell-goods/legal-guide/consumer-rights-when-purchasing-digital-content)
