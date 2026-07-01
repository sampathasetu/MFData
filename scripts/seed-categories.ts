import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to parse date
function parseDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) throw new Error(`Invalid date: ${dateStr}`)
  const day = parts[0].padStart(2, '0')
  let month = parts[1].toLowerCase()
  const year = parts[2]
  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  }
  if (monthMap[month]) month = monthMap[month]
  else if (month.length === 2) { /* numeric month */ }
  else throw new Error(`Unknown month: ${month}`)
  return `${year}-${month}-${day}`
}

// Category keywords to filter
const categoryFilters = [
  { name: 'Midcap', keywords: ['MIDCAP', 'MID CAP', 'MID-CAP'] },
  { name: 'Smallcap', keywords: ['SMALLCAP', 'SMALL CAP', 'SMALL-CAP'] },
  { name: 'Flexicap', keywords: ['FLEXICAP', 'FLEXI CAP'] },
  { name: 'Arbitrage', keywords: ['ARBITRAGE'] },
  { name: 'Hybrid', keywords: ['HYBRID', 'BALANCED', 'EQUITY SAVINGS'] },
]

function getCategory(name: string): string | null {
  for (const cat of categoryFilters) {
    for (const kw of cat.keywords) {
      if (name.toUpperCase().includes(kw)) return cat.name
    }
  }
  return null
}

function getAmcName(schemeName: string): string {
  // Extract AMC name: e.g., "SBI MIDCAP..." -> "SBI"
  const parts = schemeName.split(' ')
  // Try to get first 1-3 words as AMC
  let amc = parts.slice(0, 2).join(' ')
  if (amc.length < 3) amc = parts[0]
  return amc.trim()
}

async function fetchAMFIData() {
  const url = 'https://www.amfiindia.com/spages/NAVAll.txt'
  console.log('Fetching AMFI data...')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  console.log(`Total lines: ${lines.length}`)

  const schemes = []
  let started = false
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(';')
    if (parts.length < 6) continue
    if (!started && isNaN(parseInt(parts[0].trim()))) {
      started = true
      continue
    }
    const code = parts[0].trim()
    const name = parts[3]?.trim() || 'Unknown'
    const nav = parts[4]?.trim()
    const dateRaw = parts[5]?.trim()
    if (!nav || !dateRaw) continue
    if (isNaN(parseFloat(nav))) continue
    try {
      const formattedDate = parseDate(dateRaw)
      schemes.push({ schemeCode: code, schemeName: name, nav: parseFloat(nav), date: formattedDate })
    } catch (err) {
      // skip invalid dates
    }
  }
  console.log(`Parsed ${schemes.length} schemes`)
  return schemes
}

async function seed() {
  try {
    const schemes = await fetchAMFIData()
    console.log(`Total schemes parsed: ${schemes.length}`)

    // Filter by categories
    const filtered = schemes.filter(s => getCategory(s.schemeName) !== null)
    console.log(`Matched ${filtered.length} schemes in target categories`)

    if (filtered.length === 0) {
      console.log('No matching categories found. Exiting.')
      return
    }

    // Build unique AMCs
    const amcMap = new Map<string, string>()
    for (const s of filtered) {
      const amcName = getAmcName(s.schemeName)
      if (!amcMap.has(amcName)) {
        amcMap.set(amcName, crypto.randomUUID())
      }
    }
    console.log(`Creating ${amcMap.size} AMCs...`)

    // Insert AMCs (upsert)
    const amcEntries = Array.from(amcMap.entries()).map(([name, id]) => ({
      id,
      amc_code: name.toUpperCase().replace(/\s/g, '_'),
      amc_name: name,
      status: 'active',
    }))
    for (let i = 0; i < amcEntries.length; i += 500) {
      const chunk = amcEntries.slice(i, i + 500)
      const { error } = await supabase.from('amc_master').upsert(chunk, { onConflict: 'amc_code' })
      if (error) console.error('AMC upsert error:', error)
    }

    // Insert schemes & plans
    console.log('Inserting schemes and plans...')
    let inserted = 0
    const batchSize = 500
    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize)
      const schemeInserts = []
      const planInserts = []
      const mappingInserts = []

      for (const s of batch) {
        const category = getCategory(s.schemeName)
        const amcName = getAmcName(s.schemeName)
        const amcId = amcMap.get(amcName)!
        const schemeId = crypto.randomUUID()
        const planId = crypto.randomUUID()
        const planType = s.schemeName.toUpperCase().includes('DIRECT') ? 'Direct' : 'Regular'
        const optionType = s.schemeName.toUpperCase().includes('IDCW') ? 'IDCW' : 'Growth'

        schemeInserts.push({
          id: schemeId,
          amc_id: amcId,
          scheme_code: `AMFI_${s.schemeCode}`,
          scheme_name: s.schemeName,
          category: category,
          is_active: true,
        })

        planInserts.push({
          id: planId,
          scheme_id: schemeId,
          plan_type: planType,
          option_type: optionType,
          plan_code: s.schemeCode, // use AMFI code as plan_code
          expense_ratio: 0,
          min_sip: 0,
          min_lumpsum: 0,
        })

        mappingInserts.push({
          amfi_code: s.schemeCode,
          scheme_plan_id: planId,
        })
      }

      // Upsert schemes
      const { error: schemeErr } = await supabase
        .from('scheme_master')
        .upsert(schemeInserts, { onConflict: 'scheme_code' })
      if (schemeErr) console.error('Scheme error:', schemeErr)

      // Upsert plans
      const { error: planErr } = await supabase
        .from('scheme_plan')
        .upsert(planInserts, { onConflict: 'plan_code' })
      if (planErr) console.error('Plan error:', planErr)

      // Upsert mappings
      const { error: mapErr } = await supabase
        .from('amfi_mapping')
        .upsert(mappingInserts, { onConflict: 'amfi_code' })
      if (mapErr) console.error('Mapping error:', mapErr)

      inserted += batch.length
      console.log(`Inserted ${inserted} / ${filtered.length} schemes`)
    }

    console.log(`✅ Successfully seeded ${inserted} schemes!`)
  } catch (err) {
    console.error('Error during seeding:', err)
  }
}

seed()
