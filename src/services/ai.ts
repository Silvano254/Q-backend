import { DBState } from '../types.js';

export function generateBusinessAnalysis(db: DBState): string {
  const totalInvoiced = db.invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalPaid = db.invoices.reduce((sum, inv) => sum + inv.payments.reduce((ps, p) => ps + p.amountPaid, 0), 0);
  const totalOutstanding = db.invoices.reduce((sum, inv) => sum + inv.balanceRemaining, 0);
  const recoveryRate = totalInvoiced > 0 ? ((totalPaid / totalInvoiced) * 100).toFixed(1) : '0.0';
  const overdueInvoices = db.invoices.filter(inv => inv.status === 'overdue');
  const activeClients = db.clients.filter(c => c.status === 'active');
  const convertedQuotes = db.quotes.filter(q => q.status === 'converted').length;
  const conversionRate = db.quotes.length > 0 ? ((convertedQuotes / db.quotes.length) * 100).toFixed(1) : '0.0';
  const avgInvoiceValue = db.invoices.length > 0 ? (totalInvoiced / db.invoices.length) : 0;
  
  const topClient = [...db.clients].sort((a, b) => b.revenue - a.revenue)[0];
  
  const categoryRevenue: Record<string, number> = {};
  db.invoices.forEach(inv => {
    inv.items.forEach(item => {
      const product = db.products.find(p => item.description.toLowerCase().includes(p.name.toLowerCase().split(' ')[0].toLowerCase()));
      const category = product?.category || 'Decor';
      categoryRevenue[category] = (categoryRevenue[category] || 0) + item.amount;
    });
  });
  const topCategory = Object.entries(categoryRevenue).sort((a, b) => b[1] - a[1])[0];
  
  const fmt = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
  
  return `## 📊 FINANCIAL HEALTH ASSESSMENT

**Total Invoiced Value:** ${fmt(totalInvoiced)}
**Total Revenue Collected:** ${fmt(totalPaid)}
**Outstanding Receivables:** ${fmt(totalOutstanding)}
**Cash Recovery Rate:** ${recoveryRate}%
**Average Invoice Value:** ${fmt(Math.round(avgInvoiceValue))}

Binti Events has invoiced a total of ${fmt(totalInvoiced)} across ${db.invoices.length} invoice(s). Of this, ${fmt(totalPaid)} (${recoveryRate}%) has been collected, leaving ${fmt(totalOutstanding)} in outstanding receivables. ${overdueInvoices.length > 0 ? `⚠️ There are currently ${overdueInvoices.length} overdue invoice(s) totaling ${fmt(overdueInvoices.reduce((s, i) => s + i.balanceRemaining, 0))} that require immediate attention.` : '✅ There are no overdue invoices at this time.'}

---

## 🏆 KEY PERFORMANCE HIGHLIGHTS

**Active Client Base:** ${activeClients.length} active client(s)
**Quote-to-Invoice Conversion Rate:** ${conversionRate}% (${convertedQuotes} of ${db.quotes.length} quotes converted)
${topClient ? `**Top Revenue Client:** ${topClient.name} — ${fmt(topClient.revenue)} in total payments received` : ''}
${topCategory ? `**Highest Revenue Category:** ${topCategory[0]} — ${fmt(Math.round(topCategory[1]))} in billed value` : ''}
**Product Catalog:** ${db.products.length} active service(s) across ${new Set(db.products.map(p => p.category)).size} categories

---

## ⚠️ POTENTIAL RISKS & OPPORTUNITIES

${overdueInvoices.length > 0 ? overdueInvoices.map(inv => `• **${inv.clientName}** — Invoice ${inv.invoiceNumber} is overdue with ${fmt(inv.balanceRemaining)} outstanding (due ${inv.dueDate})`).join('\n') : '• No overdue invoices detected — excellent cash flow discipline.'}

${db.quotes.filter(q => q.status === 'sent').length > 0 ? `• **${db.quotes.filter(q => q.status === 'sent').length} pending quote(s)** awaiting client response — total potential value: ${fmt(db.quotes.filter(q => q.status === 'sent').reduce((s, q) => s + q.grandTotal, 0))}` : ''}

${(() => { const underused = db.products.filter(p => !db.invoices.some(inv => inv.items.some(item => item.description.toLowerCase().includes(p.name.toLowerCase().split('(')[0].trim().toLowerCase())))); return underused.length > 0 ? `• **Underutilized assets:** ${underused.slice(0, 3).map(p => p.name).join(', ')} — consider promotional packages to drive bookings` : '• All product categories are actively generating revenue.'; })()}

---

## 💡 ACTIONABLE RECOMMENDATIONS

1. **${overdueInvoices.length > 0 ? 'Accelerate Collections' : 'Maintain Payment Discipline'}** — ${overdueInvoices.length > 0 ? `Prioritize follow-up on ${overdueInvoices.length} overdue invoice(s). Consider offering a 2-3% early settlement discount to incentivize prompt payment from repeat corporate clients.` : 'Continue the current collection practices that are delivering a strong recovery rate.'}

2. **Maximize Conversion Rate** — ${Number(conversionRate) < 70 ? `Current conversion rate of ${conversionRate}% has room for improvement. Implement a 48-hour follow-up protocol for sent quotes and consider time-limited pricing to create urgency.` : `Conversion rate of ${conversionRate}% is strong. Maintain momentum by ensuring prompt quote delivery and professional follow-up.`}

3. **Premium Upselling Strategy** — Bundle high-margin services (Decor, Floral, Consultation) with core tent hire packages to increase average invoice value beyond the current ${fmt(Math.round(avgInvoiceValue))}. Target a 15-20% uplift through curated "Luxury Experience" packages.`;
}

export function generateEmailDraft(params: {
  type: string;
  number: string;
  clientName: string;
  amount: number;
  dueDate: string;
  notes?: string;
  currency?: string;
}): string {
  const { type, number, clientName, amount, dueDate, notes, currency = 'KES' } = params;
  const fmt = (n: number) => `${currency} ${n.toLocaleString('en-KE')}`;
  const isInvoice = type?.toLowerCase().includes('invoice');
  const firstName = clientName.split(' ')[0];
  
  if (isInvoice) {
    return `Dear ${firstName},

Warm greetings from Binti Events.

We trust this message finds you well and that anticipation is building for your upcoming event. We are delighted to be part of bringing your vision to life.

Please find below the details for ${type} ${number}:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Document: ${type} ${number}
💰 Amount Due: ${fmt(amount)}
📅 Payment Due By: ${dueDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${notes ? `\n📝 Note: ${notes}\n` : ''}
To ensure seamless preparation for your event, we kindly request that payment be processed by the due date above. Payments can be made via:

• Bank Transfer — Details on the attached invoice
• M-Pesa Paybill — Available on request
• Cheque — Payable to "Binti Events"

Should you have any questions regarding this invoice or require any adjustments, please do not hesitate to reach out. We are here to ensure every detail is perfect.

Thank you for choosing Binti Events to curate your luxury experience.

With warm regards,

—
Binti Events Billing Team
📧 billing@bintievents.co.ke
📞 +254 712 345678
🏢 Sura Office Suites, Nairobi, Kenya`;
  } else {
    return `Dear ${firstName},

Warm greetings from Binti Events.

Thank you for considering us for your upcoming event. It is our privilege to present this bespoke quotation, crafted with care to reflect the luxury and elegance your occasion deserves.

Please find below the details for ${type} ${number}:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Document: ${type} ${number}
💰 Quoted Amount: ${fmt(amount)}
📅 Valid Until: ${dueDate}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${notes ? `\n📝 Note: ${notes}\n` : ''}
This quotation has been tailored to your specific requirements. To secure your preferred dates and lock in the pricing above, we recommend confirming at your earliest convenience with a 50% deposit.

We would be happy to arrange a consultation call to walk you through the details, discuss any customisations, or answer questions.

Thank you for choosing Binti Events — where every moment is a masterpiece.

With warm regards,

—
Binti Events Team
📧 billing@bintievents.co.ke
📞 +254 712 345678
🏢 Sura Office Suites, Nairobi, Kenya`;
  }
}

export function generateContractTerms(params: {
  clientName: string;
  items: Array<{ description: string; quantity: number }>;
}): string {
  const { items } = params;
  
  const termsLibrary: Record<string, string[]> = {
    'Tents': [
      'All tent structures must be erected on level ground with adequate drainage. Binti Events reserves the right to delay setup if ground conditions pose a safety risk. Tent pegging areas must be free of underground utilities — the client is responsible for confirming ground safety clearance prior to setup day.',
      'In the event of sustained winds exceeding 45 km/h, Binti Events reserves the right to lower or partially disassemble tent structures as a safety precaution. The client will be notified immediately, and adjustments will be made to restore the setup once conditions are safe.',
      'No open flames, sky lanterns, or unattended candles are permitted inside or within 3 metres of any tent structure. All heating equipment must be pre-approved by the Binti Events site manager.',
      'The client shall ensure that the tent setup area is accessible for heavy vehicle delivery at least 4 hours prior to the scheduled installation time. Any delays caused by restricted access may result in additional labour charges.'
    ],
    'Structures': [
      'Pergola and structural installations are rated for a maximum evenly distributed load as specified during the design consultation. The client must not suspend, attach, or hang items exceeding the communicated weight limit without prior written approval from Binti Events.',
      'All wooden structures must be protected from direct exposure to sustained rainfall exceeding 4 hours. Binti Events will provide weather covers where applicable, but the client is responsible for communicating any changes to the event timeline that may extend outdoor exposure.',
      'Structural installations require a minimum setup time of 6 hours. The client shall ensure venue access is granted accordingly and that the installation area is cleared of all third-party equipment prior to the Binti Events crew arrival.',
      'Any modifications to the pre-approved structural layout requested on-site will be accommodated where possible but may incur additional charges and require an extended setup window.'
    ],
    'Lighting': [
      'All electrical installations will be performed by Binti Events\' certified technicians. The client must ensure a reliable power source (minimum 15A supply) is available within 30 metres of the installation area. Generator hire can be arranged at additional cost.',
      'Fairy lights and uplighting installations include setup, testing, and removal. Any lighting left in place beyond the contracted event period will incur daily extension fees. Binti Events is not liable for power outages caused by venue electrical failures.',
      'Outdoor lighting installations are weather-rated to IP44 standard. However, in the event of severe electrical storms, Binti Events reserves the right to disconnect lighting systems as a safety measure until conditions improve.'
    ],
    'Furniture': [
      'All hired furniture must be returned in the same condition as delivered. The client will be charged replacement cost for any items that are broken, stained beyond normal use, or missing at the time of collection. An inventory checklist will be provided at delivery.',
      'Chiavari chairs and premium furniture items are intended for indoor or covered outdoor use only. Use of premium furniture on wet grass, sand, or uneven surfaces without protective mats (available on request) is at the client\'s risk and may void damage liability coverage.'
    ],
    'Decor': [
      'Bespoke décor elements, including floral arrangements and fabric installations, are designed for single-event use. Binti Events retains ownership of all reusable décor hardware (arches, frames, vases) and will collect these within 24 hours of event conclusion.',
      'Fresh floral installations are prepared within 24 hours of the event to ensure peak presentation. Any changes to colour palette, flower species, or arrangement style must be communicated at least 72 hours prior to the event. Late changes may be subject to availability and additional charges.'
    ],
    'Logistics': [
      'Transport and logistics pricing is based on the Nairobi metropolitan area. Events outside a 50 km radius of Nairobi CBD will incur a per-kilometre surcharge as quoted during the consultation phase. The client must confirm the final venue address at least 7 days before the event.',
      'Binti Events will provide a dedicated site manager for setup and teardown coordination. The client shall designate a point of contact who is authorised to approve on-site decisions and is reachable by phone throughout the event day.'
    ],
    'Consultation': [
      'Event design consultation fees are non-refundable once the initial 3D venue mapping session has been delivered. Subsequent revision rounds (up to 2 included) will be scheduled within 5 business days of client feedback. Additional revision rounds may be billed at the hourly consultation rate.',
      'All creative designs, mood boards, and 3D renderings produced by Binti Events remain the intellectual property of Binti Events unless a separate licensing agreement is executed. The client is granted a single-use licence for the contracted event only.'
    ]
  };
  
  const defaultTerms = [
    'A non-refundable deposit of 50% of the total quoted amount is required to confirm the booking. The remaining balance must be settled no later than 7 days prior to the event date.',
    'Cancellations made more than 30 days before the event will forfeit the deposit only. Cancellations within 14 days of the event are subject to the full contract value. Rescheduling is permitted once, subject to availability, with no additional charge if requested more than 21 days in advance.',
    'Binti Events maintains comprehensive public liability insurance for all events. However, the client is responsible for obtaining event-specific insurance where required by the venue or local regulations.',
    'Force majeure: Neither party shall be liable for failure to perform obligations due to circumstances beyond reasonable control, including but not limited to natural disasters, government restrictions, or pandemic-related directives.'
  ];
  
  const detectedCategories = new Set<string>();
  const itemDescriptions = (items || []).map(i => i.description.toLowerCase());
  
  const categoryKeywords: Record<string, string[]> = {
    'Tents': ['tent', 'stretch', 'cheese tent', 'marquee', 'canopy'],
    'Structures': ['pergola', 'structure', 'wooden', 'gazebo', 'arch frame'],
    'Lighting': ['light', 'fairy', 'uplighting', 'led', 'chandelier', 'ambient'],
    'Furniture': ['chair', 'chiavari', 'table', 'sofa', 'lounge', 'furniture', 'stool'],
    'Decor': ['decor', 'floral', 'flower', 'backdrop', 'draping', 'styling', 'tabletop', 'centerpiece'],
    'Logistics': ['transport', 'logistics', 'delivery', 'rigging', 'setup crew'],
    'Consultation': ['consultation', 'design', 'coordination', 'planning', '3d mapping']
  };
  
  for (const desc of itemDescriptions) {
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(kw => desc.includes(kw))) {
        detectedCategories.add(category);
      }
    }
  }
  
  const selectedTerms: string[] = [];
  
  for (const category of detectedCategories) {
    const categoryTerms = termsLibrary[category];
    if (categoryTerms && categoryTerms.length > 0) {
      selectedTerms.push(categoryTerms[0]);
    }
  }
  
  let defaultIndex = 0;
  while (selectedTerms.length < 4 && defaultIndex < defaultTerms.length) {
    selectedTerms.push(defaultTerms[defaultIndex]);
    defaultIndex++;
  }
  
  return selectedTerms.slice(0, 4).map((term, i) => `${i + 1}. ${term}`).join('\n\n');
}
