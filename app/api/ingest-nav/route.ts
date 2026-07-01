import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

console.log('Loading route file...')
console.log('SUPABASE_URL exists?', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
console.log('SERVICE_ROLE_KEY exists?', !!process.env.SUPABASE_SERVICE_ROLE_KEY)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  console.log('POST request received')
  try {
    const payload = await request.json()
    console.log('Payload:', JSON.stringify(payload, null, 2))

    if (!Array.isArray(payload) || payload.length === 0) {
      console.log('Invalid payload – returning 400')
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    console.log('Upserting...')
    const results = await Promise.all(
      payload.map((item) => {
        console.log('  Upserting:', item.schemePlanId, item.navDate, item.navValue)
        return supabaseAdmin.from('nav_history').upsert(
          {
            scheme_plan_id: item.schemePlanId,
            nav_date: item.navDate,
            nav_value: item.navValue,
          },
          { onConflict: 'scheme_plan_id, nav_date' }
        )
      })
    )

    const errors = results.filter((r) => r.error)
    if (errors.length) {
      console.log('Errors in upsert:', errors.map(e => e.error.message))
      throw new Error(errors.map((e) => e.error?.message).join(', '))
    }

    console.log('Success – returning 200')
    return NextResponse.json({ success: true, inserted: payload.length })
  } catch (err: any) {
    console.error('ERROR in POST handler:', err)
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 })
  }
}