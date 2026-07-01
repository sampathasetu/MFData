'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/utils/supabase/client'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer
} from 'recharts'

export default function ComparePage() {
  const [plans, setPlans] = useState<any[]>([])
  const [plan1, setPlan1] = useState('')
  const [plan2, setPlan2] = useState('')
  const [chartData, setChartData] = useState<any[]>([])

  useEffect(() => {
    supabase
      .from('scheme_plan')
      .select('id, plan_code, scheme_master(scheme_name)')
      .then(({ data }) => setPlans(data || []))
  }, [])

  const handleCompare = async () => {
    if (!plan1 || !plan2) return

    const { data: navData } = await supabase
      .from('nav_history')
      .select('scheme_plan_id, nav_date, nav_value')
      .in('scheme_plan_id', [plan1, plan2])
      .order('nav_date', { ascending: true })

    const map: Record<string, any> = {}
    navData?.forEach((item) => {
      const date = item.nav_date
      if (!map[date]) map[date] = { date }
      const key = item.scheme_plan_id === plan1 ? 'nav1' : 'nav2'
      map[date][key] = item.nav_value
    })
    setChartData(Object.values(map))
  }

  const getPlanLabel = (id: string) => {
    const p = plans.find((pl) => pl.id === id)
    if (p) {
      return p.plan_code + ' (' + p.scheme_master?.scheme_name + ')'
    }
    return id
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Compare Schemes</h1>
      <div className="flex flex-wrap gap-4 mb-6">
        <select
          className="border p-2 rounded"
          value={plan1}
          onChange={(e) => setPlan1(e.target.value)}
        >
          <option value="">Select Plan 1</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.plan_code} - {p.scheme_master?.scheme_name}
            </option>
          ))}
        </select>
        <select
          className="border p-2 rounded"
          value={plan2}
          onChange={(e) => setPlan2(e.target.value)}
        >
          <option value="">Select Plan 2</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.plan_code} - {p.scheme_master?.scheme_name}
            </option>
          ))}
        </select>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={handleCompare}
        >
          Compare
        </button>
      </div>

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="nav1"
              stroke="#8884d8"
              name={getPlanLabel(plan1)}
            />
            <Line
              type="monotone"
              dataKey="nav2"
              stroke="#82ca9d"
              name={getPlanLabel(plan2)}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}