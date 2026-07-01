import { createServerClient } from '@/utils/supabase/server'

export default async function SchemesList() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('scheme_plan')
    .select(`
      id,
      plan_code,
      scheme_id,
      scheme_master (
        scheme_name,
        category,
        amc_id,
        amc_master ( amc_name )
      ),
      nav_history (
        nav_date,
        nav_value
      )
    `)
    .order('nav_date', { foreignTable: 'nav_history', ascending: false })

  if (error) {
    console.error(error)
    return <div className="p-8 text-red-600">Error loading schemes: {error.message}</div>
  }

  const rows = data?.map((plan) => ({
    ...plan,
    latestNav: plan.nav_history?.[0] || null,
  }))

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Mutual Fund Schemes</h1>
      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">Scheme</th>
            <th className="border p-2">AMC</th>
            <th className="border p-2">Plan</th>
            <th className="border p-2">Latest NAV</th>
            <th className="border p-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((plan) => (
            <tr key={plan.id}>
              <td className="border p-2">{plan.scheme_master?.scheme_name}</td>
              <td className="border p-2">{plan.scheme_master?.amc_master?.amc_name}</td>
              <td className="border p-2">{plan.plan_code}</td>
              <td className="border p-2">{plan.latestNav?.nav_value ?? '—'}</td>
              <td className="border p-2">{plan.latestNav?.nav_date ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}