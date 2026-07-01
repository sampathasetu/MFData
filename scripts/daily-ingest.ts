import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
  else if (month.length === 2) { /* already numeric */ }
  else throw new Error(`Unknown month: ${month}`)
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
    const navNum = parseFloat(nav)
    if (isNaN(navNum)) continue
    try {
      const formattedDate = parseDate(dateRaw)
      schemes.push({ schemeCode: code, schemeName: name, nav: String(navNum), date: formattedDate })
    } catch (err) {
      // skip invalid dates
    }
  }
  console.log(`Parsed ${schemes.length} schemes`)
  return schemes
}

async function ingest() {
  try {
    // 1. Fetch all mappings from Supabase into a Map
    console.log('Fetching mapping table...')
    const { data: mappings, error: mapError } = await supabase
      .from('amfi_mapping')
      .select('amfi_code, scheme_plan_id')
    if (mapError) {
      console.error('Error fetching mapping:', mapError)
      process.exit(1)
    }
    const mappingMap = new Map<string, string>()
    for (const row of mappings || []) {
      mappingMap.set(row.amfi_code, row.scheme_plan_id)
    }
    console.log(`Loaded ${mappingMap.size} mappings`)

    // 2. Fetch and parse AMFI data
    const schemes = await fetchAMFIData()
    console.log(`Fetched ${schemes.length} schemes`)

    // 3. Build payload using the Map (no per‑scheme DB queries)
    const payload = []
    for (const scheme of schemes) {
      const planId = mappingMap.get(scheme.schemeCode)
      if (planId) {
        payload.push({
          scheme_plan_id: planId,
          nav_date: scheme.date,
          nav_value: parseFloat(scheme.nav)
        })
      }
    }

    if (payload.length === 0) {
      console.log('No matching schemes – nothing to ingest.')
      return
    }

    // 4. Upsert all in one go
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
