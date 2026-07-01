import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchAMFIData() {
  const url = 'https://www.amfiindia.com/spages/NAVAll.txt'
  console.log('Fetching AMFI data from official source...')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  console.log(`Total lines: ${lines.length}`)

  // Print first 10 raw lines
  console.log('=== First 10 raw lines ===')
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    console.log(`Line ${i+1}: "${lines[i]}"`)
  }

  // Auto-detect separator
  let separator = ';'
  for (const line of lines) {
    if (line.trim()) {
      if (line.includes('|')) { separator = '|'; break }
      if (line.includes('\t')) { separator = '\t'; break }
      break
    }
  }
  console.log(`Using separator: "${separator}"`)

  // Parse with detected separator and print first few lines with parts
  const schemes = []
  let headerSkipped = false
  let sampleCount = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(separator)
    // Print first 5 data lines with parts
    if (sampleCount < 5 && !headerSkipped) {
      console.log(`Sample line parts (${parts.length}):`, parts)
      sampleCount++
    }
    if (parts.length < 5) continue

    // Skip header row (if first field is not numeric)
    if (!headerSkipped && isNaN(parseInt(parts[0].trim()))) {
      headerSkipped = true
      console.log(`Header skipped: "${line}"`)
      continue
    }

    // Now we assume standard format: Code;ISIN;Name;NAV;Date;...
    // But we need to find which field is numeric NAV and which is date.
    // We'll look for a field that contains a date (DD-MM-YYYY) and a numeric NAV.
    const possibleNavIndex = parts.findIndex(p => !isNaN(parseFloat(p.trim())) && p.trim() !== '')
    const possibleDateIndex = parts.findIndex(p => /^\d{2}-\d{2}-\d{4}$/.test(p.trim()))
    
    if (possibleNavIndex === -1 || possibleDateIndex === -1) {
      console.warn(`Could not find NAV or date in line: "${line}"`)
      continue
    }

    const schemeCode = parts[0].trim()
    const schemeName = parts[2]?.trim() || 'Unknown'
    const nav = parts[possibleNavIndex].trim()
    const date = parts[possibleDateIndex].trim()

    const dateParts = date.split('-')
    if (dateParts.length !== 3) {
      console.warn(`Invalid date format: "${date}"`)
      continue
    }
    const day = dateParts[0].padStart(2, '0')
    const month = dateParts[1].padStart(2, '0')
    const year = dateParts[2]
    const formattedDate = `${year}-${month}-${day}`
    schemes.push({ schemeCode, schemeName, nav, date: formattedDate })
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
