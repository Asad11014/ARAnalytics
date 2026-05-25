// ─── client/src/pages/Quotations.jsx ─────────────────────────────────────────
// International shipping quote calculator.
// Clients see the marked-up (20% surcharge) price only.
// Warehouse users see both the base rate and the client-facing rate.

import { useState, useMemo } from 'react'
import { useSession } from '../context/SessionContext'

// ── Royal Mail format limits & rate bands ─────────────────────────────────────
// Dimensions in mm, weight in grams.
// Rates: Royal Mail 2024 published rate card (International Standard and
// International Tracked & Signed). Verify at royalmail.com before quoting.

const RM_FORMATS = [
  {
    id: 'letter',
    name: 'Letter',
    maxL: 240, maxW: 165, maxD: 5, maxG: 100,
    services: {
      standard: [
        { maxG: 100, europe: 1.85, wz1: 2.20, wz2: 2.20 },
      ],
      tracked: [
        { maxG: 100, europe: 4.15, wz1: 5.50, wz2: 6.50 },
      ],
    },
  },
  {
    id: 'large-letter',
    name: 'Large Letter',
    maxL: 353, maxW: 250, maxD: 25, maxG: 750,
    services: {
      standard: [
        { maxG: 100, europe: 2.55, wz1:  3.50, wz2:  3.90 },
        { maxG: 250, europe: 3.20, wz1:  4.75, wz2:  5.50 },
        { maxG: 500, europe: 4.15, wz1:  6.25, wz2:  7.20 },
        { maxG: 750, europe: 5.10, wz1:  7.75, wz2:  9.10 },
      ],
      tracked: [
        { maxG: 100, europe: 5.60, wz1:  7.00, wz2:  8.50 },
        { maxG: 250, europe: 6.45, wz1:  8.60, wz2: 10.50 },
        { maxG: 500, europe: 7.60, wz1: 10.20, wz2: 12.70 },
        { maxG: 750, europe: 8.75, wz1: 11.80, wz2: 14.90 },
      ],
    },
  },
  {
    id: 'small-parcel',
    name: 'Small Parcel',
    maxL: 450, maxW: 350, maxD: 160, maxG: 2000,
    services: {
      standard: [
        { maxG:  100, europe:  8.50, wz1: 11.00, wz2: 13.00 },
        { maxG:  250, europe:  9.20, wz1: 12.50, wz2: 15.00 },
        { maxG:  500, europe: 10.50, wz1: 15.00, wz2: 18.00 },
        { maxG:  750, europe: 11.80, wz1: 17.50, wz2: 21.00 },
        { maxG: 1000, europe: 13.10, wz1: 20.00, wz2: 24.50 },
        { maxG: 1250, europe: 14.40, wz1: 22.50, wz2: 28.00 },
        { maxG: 1500, europe: 15.70, wz1: 25.00, wz2: 31.50 },
        { maxG: 2000, europe: 18.30, wz1: 30.00, wz2: 38.50 },
      ],
      tracked: [
        { maxG:  100, europe: 11.85, wz1: 14.00, wz2: 17.00 },
        { maxG:  250, europe: 12.55, wz1: 15.50, wz2: 19.00 },
        { maxG:  500, europe: 13.85, wz1: 18.00, wz2: 22.00 },
        { maxG:  750, europe: 15.15, wz1: 20.50, wz2: 25.00 },
        { maxG: 1000, europe: 16.45, wz1: 23.00, wz2: 28.50 },
        { maxG: 1250, europe: 17.75, wz1: 25.50, wz2: 32.00 },
        { maxG: 1500, europe: 19.05, wz1: 28.00, wz2: 35.50 },
        { maxG: 2000, europe: 21.65, wz1: 33.00, wz2: 42.50 },
      ],
    },
  },
  {
    id: 'medium-parcel',
    name: 'Medium Parcel',
    maxL: 610, maxW: 460, maxD: 460, maxG: 20000,
    services: {
      standard: [
        { maxG:  1000, europe: 19.00, wz1:  28.00, wz2:  35.00 },
        { maxG:  2000, europe: 21.00, wz1:  33.00, wz2:  43.00 },
        { maxG:  3000, europe: 23.00, wz1:  38.00, wz2:  51.00 },
        { maxG:  5000, europe: 27.00, wz1:  48.00, wz2:  67.00 },
        { maxG: 10000, europe: 35.00, wz1:  68.00, wz2:  99.00 },
        { maxG: 20000, europe: 51.00, wz1: 108.00, wz2: 159.00 },
      ],
      tracked: [
        { maxG:  1000, europe: 22.35, wz1:  31.00, wz2:  39.00 },
        { maxG:  2000, europe: 24.35, wz1:  36.00, wz2:  47.00 },
        { maxG:  3000, europe: 26.35, wz1:  41.00, wz2:  55.00 },
        { maxG:  5000, europe: 30.35, wz1:  51.00, wz2:  71.00 },
        { maxG: 10000, europe: 38.35, wz1:  71.00, wz2: 103.00 },
        { maxG: 20000, europe: 54.35, wz1: 111.00, wz2: 163.00 },
      ],
    },
  },
]

// ── Country data, grouped by Royal Mail zone ──────────────────────────────────

const COUNTRIES_BY_ZONE = {
  europe: [
    'Albania','Andorra','Armenia','Austria','Azerbaijan','Belarus','Belgium',
    'Bosnia and Herzegovina','Bulgaria','Croatia','Cyprus','Czech Republic',
    'Denmark','Estonia','Faroe Islands','Finland','France','Georgia','Germany',
    'Gibraltar','Greece','Greenland','Hungary','Iceland','Ireland','Italy',
    'Kosovo','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Moldova',
    'Monaco','Montenegro','Netherlands','North Macedonia','Norway','Poland',
    'Portugal','Romania','Russia','San Marino','Serbia','Slovakia','Slovenia',
    'Spain','Sweden','Switzerland','Turkey','Ukraine','Vatican City',
  ].sort(),
  wz1: [
    'Australia','Bahrain','Bangladesh','Canada','China','Hong Kong','India',
    'Indonesia','Israel','Japan','Jordan','Kuwait','Lebanon','Macau','Malaysia',
    'Maldives','Mongolia','Myanmar','Nepal','New Zealand','Oman','Pakistan',
    'Philippines','Qatar','Saudi Arabia','Singapore','South Korea','Sri Lanka',
    'Taiwan','Thailand','United Arab Emirates','United States','Vietnam',
  ].sort(),
  wz2: [
    'Afghanistan','Algeria','Angola','Antigua and Barbuda','Argentina','Barbados',
    'Belize','Benin','Bhutan','Bolivia','Botswana','Brazil','Brunei',
    'Burkina Faso','Burundi','Cambodia','Cameroon','Cape Verde',
    'Central African Republic','Chad','Chile','Colombia','Comoros','Congo',
    'Costa Rica','Cuba','Djibouti','Dominica','Dominican Republic','DR Congo',
    'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Ethiopia',
    'Fiji','Gabon','Gambia','Ghana','Grenada','Guatemala','Guinea',
    'Guinea-Bissau','Guyana','Haiti','Honduras','Iran','Iraq','Ivory Coast',
    'Jamaica','Kenya','Kiribati','Laos','Lesotho','Liberia','Libya',
    'Madagascar','Malawi','Mali','Marshall Islands','Mauritania','Mauritius',
    'Mexico','Micronesia','Morocco','Mozambique','Namibia','Nauru','Nicaragua',
    'Niger','Nigeria','North Korea','Palau','Panama','Papua New Guinea',
    'Paraguay','Peru','Rwanda','Saint Kitts and Nevis','Saint Lucia',
    'Saint Vincent and the Grenadines','Samoa','Sao Tome and Principe',
    'Senegal','Seychelles','Sierra Leone','Solomon Islands','Somalia',
    'South Africa','South Sudan','Sudan','Suriname','Syria','Tanzania',
    'Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Tuvalu',
    'Uganda','Uruguay','Vanuatu','Venezuela','Yemen','Zambia','Zimbabwe',
  ].sort(),
}

const ZONE_LABELS = { europe: 'Europe', wz1: 'World Zone 1', wz2: 'World Zone 2' }
const SURCHARGE   = 0.20

function getZone(country) {
  if (COUNTRIES_BY_ZONE.europe.includes(country)) return 'europe'
  if (COUNTRIES_BY_ZONE.wz1.includes(country))    return 'wz1'
  return 'wz2'
}

function determineFormat(lMm, wMm, dMm, weightG) {
  const [d1, d2, d3] = [lMm, wMm, dMm].sort((a, b) => b - a)
  for (const fmt of RM_FORMATS) {
    if (d1 <= fmt.maxL && d2 <= fmt.maxW && d3 <= fmt.maxD && weightG <= fmt.maxG) return fmt
  }
  return null
}

function getRateForBand(bands, weightG, zone) {
  const band = bands.find(b => weightG <= b.maxG)
  return band ? band[zone] : null
}

function round2(n) { return Math.round(n * 100) / 100 }
function fmtGBP(v) { return v != null ? `£${v.toFixed(2)}` : '—' }
function fmtWeight(g) {
  return g >= 1000
    ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 3).replace(/\.?0+$/, '')} kg`
    : `${g} g`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InputField({ label, value, onChange, placeholder, unit, hint, min = '0', step = '1' }) {
  return (
    <div>
      <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={min}
          step={step}
          className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-primary transition-colors"
        />
        {unit && <span className="font-mono text-xs text-ink-muted flex-shrink-0 w-8">{unit}</span>}
      </div>
      {hint && <div className="font-mono text-[10px] text-ink-dim mt-1">{hint}</div>}
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-1">
      <span className="font-mono text-xs text-ink-muted">{label}</span>
      <span className="font-mono text-xs text-ink font-semibold">{value}</span>
    </div>
  )
}

function ServiceCard({ serviceKey, title, subtitle, baseRate, qty, isWarehouse, onSave, saved, highlight }) {
  const clientRate  = round2(baseRate * (1 + SURCHARGE))
  const clientTotal = round2(clientRate * qty)
  const baseTotal   = round2(baseRate * qty)

  return (
    <div className={`rounded-lg p-4 border ${highlight ? 'border-primary/40 bg-primary/5' : 'border-brand-border bg-brand-surface2'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className={`font-sans font-semibold text-sm ${highlight ? 'text-primary' : 'text-ink'}`}>{title}</div>
          <div className="font-mono text-[10px] text-ink-muted mt-0.5">{subtitle}</div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className={`font-sans font-bold text-xl leading-none ${highlight ? 'text-primary' : 'text-ink'}`}>
            {fmtGBP(clientTotal)}
          </div>
          {qty > 1 && (
            <div className="font-mono text-[10px] text-ink-muted mt-0.5">{fmtGBP(clientRate)} × {qty}</div>
          )}
        </div>
      </div>

      {/* Warehouse sees cost breakdown */}
      {isWarehouse && (
        <div className="mb-3 pt-2 border-t border-brand-border/50 grid grid-cols-2 gap-x-4 gap-y-0.5">
          <div className="font-mono text-[10px] text-ink-dim">RM cost (per item)</div>
          <div className="font-mono text-[10px] text-ink text-right">{fmtGBP(baseRate)}</div>
          <div className="font-mono text-[10px] text-ink-dim">RM cost (total)</div>
          <div className="font-mono text-[10px] text-ink text-right">{fmtGBP(baseTotal)}</div>
          <div className="font-mono text-[10px] text-ink-dim">Client price (20% mark-up)</div>
          <div className="font-mono text-[10px] text-primary text-right font-semibold">{fmtGBP(clientTotal)}</div>
        </div>
      )}

      {/* Save button / confirmation */}
      {saved ? (
        <div className="flex items-center gap-2 pt-1">
          <span className="font-mono text-[10px] text-success font-semibold">✓ Saved</span>
          <span className="font-mono text-[10px] text-ink-dim">{saved}</span>
        </div>
      ) : (
        <button
          onClick={() => onSave(serviceKey, baseRate)}
          className="w-full mt-1 font-mono text-[11px] font-semibold rounded py-1.5 border transition-colors bg-brand-bg border-brand-border text-ink hover:border-primary hover:text-primary"
        >
          Save Quote
        </button>
      )}
    </div>
  )
}

function FormatCard({ fmt, isMatch }) {
  return (
    <div className={`rounded-lg p-4 border transition-colors ${isMatch ? 'border-primary bg-primary/5' : 'border-brand-border bg-brand-surface'}`}>
      <div className={`font-sans font-semibold text-sm mb-1.5 flex items-center gap-2 ${isMatch ? 'text-primary' : 'text-ink'}`}>
        {fmt.name}
        {isMatch && <span className="font-mono text-[8px] bg-primary text-white px-1.5 py-0.5 rounded uppercase tracking-wide">Match</span>}
      </div>
      <div className="space-y-0.5 font-mono text-[10px] text-ink-muted">
        <div>Max {fmt.maxL} × {fmt.maxW} × {fmt.maxD} mm</div>
        <div>Max {fmt.maxG >= 1000 ? `${fmt.maxG / 1000} kg` : `${fmt.maxG} g`}</div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Quotations() {
  const { session } = useSession()
  const isWarehouse = session?.isWarehouse ?? false

  const [length,  setLength]  = useState('')
  const [width,   setWidth]   = useState('')
  const [depth,   setDepth]   = useState('')
  const [weight,  setWeight]  = useState('')
  const [country, setCountry] = useState('')
  const [qty,     setQty]     = useState('1')

  // { standard: 'Q-2024-0001', tracked: null } — tracks which services have been saved
  const [saved, setSaved]   = useState({})
  const [saving, setSaving] = useState({})
  const [saveErr, setSaveErr] = useState(null)

  const weightG = parseFloat(weight) || 0

  const result = useMemo(() => {
    const lMm = parseFloat(length) * 10
    const wMm = parseFloat(width)  * 10
    const dMm = parseFloat(depth)  * 10
    const g   = parseFloat(weight)
    const q   = Math.max(1, parseInt(qty) || 1)

    if (!lMm || !wMm || !dMm || !g || !country) return null
    if (lMm <= 0 || wMm <= 0 || dMm <= 0 || g <= 0) return null

    const zone   = getZone(country)
    const format = determineFormat(lMm, wMm, dMm, g)

    if (!format) return { oversize: true, zone, country, weightG: g, qty: q }

    const stdRate = getRateForBand(format.services.standard, g, zone)
    const trkRate = getRateForBand(format.services.tracked,  g, zone)

    return {
      oversize: false,
      format,
      zone,
      country,
      weightG: g,
      qty: q,
      standard: stdRate != null ? stdRate : null,
      tracked:  trkRate != null ? trkRate : null,
    }
  }, [length, width, depth, weight, country, qty])

  // Reset saved state when form inputs change
  const resetSaved = () => { setSaved({}); setSaveErr(null) }

  async function handleSave(serviceKey, baseRate) {
    if (!result || result.oversize) return
    setSaving(s => ({ ...s, [serviceKey]: true }))
    setSaveErr(null)
    try {
      const resp = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lengthCm:   parseFloat(length),
          widthCm:    parseFloat(width),
          depthCm:    parseFloat(depth),
          weightG:    result.weightG,
          country:    result.country,
          zone:       result.zone,
          quantity:   result.qty,
          carrier:    'royal_mail',
          formatName: result.format.name,
          service:    serviceKey,
          baseRate,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Failed to save')
      setSaved(s => ({ ...s, [serviceKey]: data.reference }))
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(s => ({ ...s, [serviceKey]: false }))
    }
  }

  const matchedFormatId = result && !result.oversize ? result.format.id : null

  return (
    <div className="flex-1 overflow-y-auto">

      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Quotations</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            International shipping estimates — Royal Mail
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-6 max-w-5xl">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* ── Form ─────────────────────────────────────────────────────── */}
          <div className="bg-brand-surface border border-brand-border rounded-lg p-6 space-y-5">
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Package Details</div>

            <div>
              <div className="font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-3">Dimensions</div>
              <div className="grid grid-cols-3 gap-3">
                <InputField label="Length" value={length} onChange={v => { setLength(v); resetSaved() }} placeholder="30" unit="cm" />
                <InputField label="Width"  value={width}  onChange={v => { setWidth(v);  resetSaved() }} placeholder="20" unit="cm" />
                <InputField label="Depth"  value={depth}  onChange={v => { setDepth(v);  resetSaved() }} placeholder="10" unit="cm" />
              </div>
            </div>

            <InputField
              label="Weight"
              value={weight}
              onChange={v => { setWeight(v); resetSaved() }}
              placeholder="500"
              unit="g"
              hint={weightG >= 1000 ? `= ${fmtWeight(weightG)}` : null}
            />

            <div>
              <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1.5">
                Destination Country
              </label>
              <select
                value={country}
                onChange={e => { setCountry(e.target.value); resetSaved() }}
                className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Select a country…</option>
                <optgroup label="Europe">
                  {COUNTRIES_BY_ZONE.europe.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                <optgroup label="World Zone 1">
                  {COUNTRIES_BY_ZONE.wz1.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                <optgroup label="World Zone 2 — Rest of World">
                  {COUNTRIES_BY_ZONE.wz2.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              </select>
              {country && (
                <div className="font-mono text-[10px] text-ink-dim mt-1">
                  Zone: {ZONE_LABELS[getZone(country)]}
                </div>
              )}
            </div>

            <InputField
              label="Number of Packages"
              value={qty}
              onChange={v => { setQty(v); resetSaved() }}
              placeholder="1"
              min="1"
              step="1"
            />

            {saveErr && (
              <div className="font-mono text-[10px] text-danger bg-danger/10 border border-danger/20 rounded px-3 py-2">
                {saveErr}
              </div>
            )}

            <p className="font-mono text-[9px] text-ink-dim leading-relaxed pt-3 border-t border-brand-border">
              Rates: Royal Mail 2024 published rate card. Verify at royalmail.com before issuing
              a final quote. Excludes VAT, customs duties, and surcharges.
            </p>
          </div>

          {/* ── Result ───────────────────────────────────────────────────── */}
          <div>
            {!result && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-8 flex flex-col items-center justify-center min-h-[320px] text-center">
                <div className="text-5xl mb-4">📦</div>
                <div className="font-sans font-semibold text-ink mb-1">Enter package details</div>
                <div className="font-mono text-xs text-ink-muted max-w-xs">
                  Fill in dimensions, weight, and destination to get an instant estimate.
                </div>
              </div>
            )}

            {result?.oversize && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-6 space-y-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Carrier Routing</div>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                  <div className="font-sans font-bold text-warning text-sm mb-1">Exceeds Royal Mail limits</div>
                  <div className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    This shipment is too large or heavy for Royal Mail (max 610 × 460 × 460 mm, 20 kg).
                    An Inxpress quote is required for this consignment.
                  </div>
                </div>
                <div className="border-t border-brand-border pt-3 space-y-0">
                  <InfoRow label="Destination" value={result.country} />
                  <InfoRow label="Zone"        value={ZONE_LABELS[result.zone]} />
                  <InfoRow label="Weight"      value={fmtWeight(result.weightG)} />
                  <InfoRow label="Quantity"    value={`${result.qty} package${result.qty > 1 ? 's' : ''}`} />
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-1">Next Step</div>
                  <div className="font-mono text-[11px] text-ink-muted">
                    Contact us and we'll arrange an Inxpress quote for this shipment.
                  </div>
                </div>
              </div>
            )}

            {result && !result.oversize && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim">Routing</span>
                  <span className="bg-[#e9f5eb] text-[#15803d] font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
                    Royal Mail
                  </span>
                  <span className="bg-primary/10 text-primary font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
                    {result.format.name}
                  </span>
                  <span className="bg-brand-surface2 text-ink-muted font-mono text-[9px] px-2 py-0.5 rounded">
                    {ZONE_LABELS[result.zone]}
                  </span>
                </div>

                <div className="border-b border-brand-border pb-4 space-y-0">
                  <InfoRow label="Destination" value={result.country} />
                  <InfoRow label="Weight"      value={fmtWeight(result.weightG)} />
                  <InfoRow label="Quantity"    value={`${result.qty} package${result.qty > 1 ? 's' : ''}`} />
                </div>

                <div className="space-y-3">
                  <div className="font-mono text-[9px] text-ink-dim uppercase tracking-widest">Service Options</div>

                  {result.standard != null && (
                    <ServiceCard
                      serviceKey="standard"
                      title="International Standard"
                      subtitle="Economy · No live tracking"
                      baseRate={result.standard}
                      qty={result.qty}
                      isWarehouse={isWarehouse}
                      onSave={handleSave}
                      saved={saved.standard}
                      highlight={false}
                    />
                  )}

                  {result.tracked != null && (
                    <ServiceCard
                      serviceKey="tracked"
                      title="International Tracked & Signed"
                      subtitle="Full tracking · Signature on delivery"
                      baseRate={result.tracked}
                      qty={result.qty}
                      isWarehouse={isWarehouse}
                      onSave={handleSave}
                      saved={saved.tracked}
                      highlight
                    />
                  )}
                </div>

                {result.qty > 1 && (
                  <div className="text-[10px] font-mono text-ink-dim bg-brand-surface2 rounded px-3 py-2">
                    Totals shown for {result.qty} identical packages shipped individually.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Format reference ──────────────────────────────────────────────── */}
        <div>
          <div className="font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-3">
            ▸ Royal Mail Format Reference
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {RM_FORMATS.map(fmt => (
              <FormatCard key={fmt.id} fmt={fmt} isMatch={matchedFormatId === fmt.id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
