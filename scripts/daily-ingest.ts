import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function parseDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`)
  }
  const day = parts[0].padStart(2, '0')
  let month = parts[1].toLowerCase()
  let year = parts[2]

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  }

  if (monthMap[month]) {
    month = monthMap[month]
  } else if (month.length !== 2) {
    throw new Error(`Invalid month format: ${month}`)
  }

  if (year.length === 2) {
    const fullYear = parseInt(year)
    year = fullYear >= 70 ? `19${year}` : `20${year}`
  }

  return `${year}-${month}-${day}`
}

async function fetchAMFIData() {
  console.log('Fetching AMFI data...')
  const res = await fetch('https://api.mfapi.in/mf')
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
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
        const navDate = parseDate(scheme.date)
        payload.push({
          scheme_plan_id: planId,
          nav_date: navDate,
          nav_value: parseFloat(scheme.nav)
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
