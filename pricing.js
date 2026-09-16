/**
 * ClickClick Academy pricing — single source of truth.
 *
 * Enzo's call, 16 Sep 2026. One headline price, plus a decoy tier above it
 * whose extras are all database flags, so the upgrade costs Kathryn no
 * delivery work at all. No cheap tier: it steals sales from the main price
 * far more than it wins new ones, and it brings in the buyer most likely to
 * refund and charge back.
 *
 * GBP is the real price. Everything else is a rounded, charm-priced
 * equivalent, NOT a live conversion: a price that moves with the exchange
 * rate looks broken, and a checkout that quotes 187.43 reads as a machine
 * rather than a decision. Re-check these against the rate once or twice a
 * year, and change them deliberately.
 *
 * Treat every figure as VAT-inclusive. ClickClick Ltd is under the £90,000
 * registration threshold today, but if it registers, £149 becomes £124.17
 * net plus £24.83 VAT rather than £149 plus VAT. Planning for the net number
 * from day one means never having to put the headline price up in a panic.
 */
(function (root) {
  var PRICING = {
    currencies: ['GBP', 'EUR', 'USD'],

    // Rates the equivalents were set from, recorded so the next person can
    // see how stale they are rather than guessing.
    ratesSetOn: '2026-09-16',
    ratesUsed: { EUR: 1.17, USD: 1.27 },

    tiers: [
      {
        id: 'certification',
        name: 'Certification',
        featured: true,
        price: { GBP: 149, EUR: 175, USD: 189 },
        includes: [
          'All 8 modules and 32 lessons',
          'All 32 interactive activities',
          'Five templates: invoice, 30 hook openers, portfolio page, rate card, UK client contract',
          'Final exam',
          'Certificate with a unique credential ID',
          'Listed in the directory ClickClick uses to match brands with creators',
          '12 months of access',
        ],
      },
      {
        id: 'priority',
        name: 'Certification + Priority',
        featured: false,
        price: { GBP: 249, EUR: 289, USD: 315 },
        includes: [
          'Everything in Certification',
          'Lifetime access, including future updates',
          'Priority position in the brand-matching directory',
          'A public credential page a brand can check',
          'Free exam re-sits',
        ],
      },
    ],

    // Two payments 30 days apart. The extra is the cost of paying late, not a
    // discount, and the certificate stays locked until both clear.
    paymentPlan: {
      appliesTo: 'certification',
      instalments: 2,
      each: { GBP: 79, EUR: 92, USD: 99 },
      gapDays: 30,
    },

    // Runs once and dies. The reason is real and says so out loud, which is
    // why it does not train anyone to wait for the next sale.
    launchOffer: {
      code: 'FOUNDING50',
      appliesTo: 'certification',
      price: { GBP: 99, EUR: 116, USD: 125 },
      maxUses: 50,
      reason:
        'First fifty. You go into the brand directory first, and your feedback shapes version two.',
    },

    symbols: { GBP: '£', EUR: '€', USD: '$' },
  };

  // Best guess at which currency to show first. Language region only: no IP
  // lookup, no third-party geo service, nothing that needs a cookie banner.
  // Always overridable, and GBP is the fallback because that is the real price.
  PRICING.guessCurrency = function (locale) {
    var l = String(locale || (typeof navigator !== 'undefined' ? navigator.language : '') || '');
    var region = (l.split('-')[1] || '').toUpperCase();
    if (region === 'US' || region === 'CA' || region === 'AU' || region === 'NZ') return 'USD';
    var eurozone = [
      'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'AT', 'PT', 'FI', 'GR',
      'SK', 'SI', 'EE', 'LV', 'LT', 'LU', 'CY', 'MT', 'HR',
    ];
    if (eurozone.indexOf(region) > -1) return 'EUR';
    return 'GBP';
  };

  PRICING.format = function (amount, currency) {
    var cur = PRICING.symbols[currency] ? currency : 'GBP';
    return PRICING.symbols[cur] + amount;
  };

  PRICING.tier = function (id) {
    for (var i = 0; i < PRICING.tiers.length; i++) {
      if (PRICING.tiers[i].id === id) return PRICING.tiers[i];
    }
    return null;
  };

  root.CLICKCLICK_PRICING = PRICING;
})(typeof window !== 'undefined' ? window : globalThis);
