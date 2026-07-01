import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseDate(dateStr: string): string {
  // Handle formats like "30-Jun-2026" or "30-06-2026"
  const parts = dateStr.split('-')
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`)
  }
  const day = parts[0].padStart(2, '0')
  let month = parts[1].toLowerCase()
  const year = parts[2]

  // Convert month abbreviation to numeric
  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  }

  if (monthMap[month]) {
    month = monthMap[month]
  } else if (month.length === 2) {
    // Already numeric month
    month = month
  } else {
    throw new Error(`Unknown month: ${month}`)
  }

  return `${year}-${month}-${day}`
}

async function fetchAMFIData() {
  const url = 'https://www.amfiindia.com/spages/NAVAll.txt'
  console.log('Fetching AMFI data from official source...')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  console.log(`Total lines: ${lines.length}`)

  const schemes = []
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(';')
    // We expect 6 fields: Code, ISIN1, ISIN2, Name, NAV, Date
    if (parts.length < 6) continue
    // Skip header row
    if (isNaN(parseInt(parts[0].trim()))) continue
    // Skip lines that have "IDCW" or other non-standard? We'll trust the structure.
    const schemeCode = parts[0].trim()
    const schemeName = parts[3].trim()
    const nav = parts[4].trim()
    const date = parts[5].trim()

    // Validate NAV
    const navValue = parseFloat(nav)
    if (isNaN(navValue)) continue

    // Parse date
    try {
      const formattedDate = parseDate(date)
      schemes.push({ schemeCode, schemeName, nav: nav, date: formattedDate })
    } catch (err) {
      console.warn(`Skipping scheme ${schemeCode}: invalid date "${date}"`)
    }
  }

  console.log(`Parsed ${schemes.length} schemes`)
  return schemes
}

async function getPlanId(amfiCode: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('amfi_mapping')
    .select('scheme_plan_id')
    .eq('amfi_code', amfiCode)
    .maybeSingle()
  if (error) {
    console.warn(`Lookup error for ${amfiCode}:`, error.message)
    return null
  }
  return data?.scheme_plan_id || null
}

async function ingest() {
  try {
    const schemes = await fetchAMFIData()
    console.log(`Fetched ${schemes.length} schemes`)

    const payload = []
    for (const scheme of schemes) {
      const planId = await getPlanId(scheme.schemeCode)
      if (!planId) continue
      try {
        const navValue = parseFloat(scheme.nav)
        if (isNaN(navValue)) continue
        payload.push({
          scheme_plan_id: planId,
          nav_date: scheme.date,
          nav_value: navValue
        })
      } catch (err) {
        console.warn(`Skipping scheme ${scheme.schemeCode}: ${err}`)
      }
    }

    if (payload.length === 0) {
      console.log('No matching schemes – nothing to ingest.')
      return
    }

    const { error } = await supabase
      .from('nav_history')
      .upsert(payload, { onConflict: 'scheme_plan_id, nav_date' })

    if (error) {
      console.error('Upsert error:', error)
      process.exit(1)
    }
    console.log(`Successfully upserted ${payload.length} NAV records`)
  } catch (err) {
    console.error('Error during ingestion:', err)
    process.exit(1)
  }
}

ingest()
