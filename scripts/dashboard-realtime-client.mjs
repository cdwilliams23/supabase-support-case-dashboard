import { createClient } from '@supabase/supabase-js'

const url = process.env.API_URL ?? process.env.SUPABASE_URL
const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const email = process.env.DASHBOARD_EMAIL
const password = process.env.DASHBOARD_PASSWORD

if (!url || !anonKey || !email || !password) {
  throw new Error(
    'Set API_URL, ANON_KEY, DASHBOARD_EMAIL, and DASHBOARD_PASSWORD before running.'
  )
}

const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

let channel
let refreshInProgress = false
let refreshQueued = false

function renderDashboard(cases, updatesByCase, reason) {
  console.log(`\nDashboard reconciled from PostgreSQL (${reason})`)

  if (cases.length === 0) {
    console.log('No support cases are visible to this signed-in user.')
    return
  }

  for (const supportCase of cases) {
    console.log(
      `- [${supportCase.status}] ${supportCase.subject} (${supportCase.id})`
    )

    const updates = updatesByCase.get(supportCase.id) ?? []

    for (const update of updates) {
      const visibility = update.is_internal ? 'internal' : 'customer-visible'
      const text = update.body ?? `Status changed to ${update.new_status}`

      console.log(`  - ${visibility}: ${text}`)
    }
  }
}

export async function loadDashboardData(reason = 'initial reconciliation') {
  const { data: cases, error: casesError } = await client
    .from('support_cases')
    .select('id, subject, description, status, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (casesError) {
    throw new Error(`Could not load support cases: ${casesError.message}`)
  }

  const caseIds = cases.map((supportCase) => supportCase.id)
  const updatesByCase = new Map()

  if (caseIds.length > 0) {
    const { data: updates, error: updatesError } = await client
      .from('case_updates')
      .select('id, case_id, body, previous_status, new_status, is_internal, created_at')
      .in('case_id', caseIds)
      .order('created_at', { ascending: true })

    if (updatesError) {
      throw new Error(`Could not load case updates: ${updatesError.message}`)
    }

    for (const update of updates) {
      const caseUpdates = updatesByCase.get(update.case_id) ?? []
      caseUpdates.push(update)
      updatesByCase.set(update.case_id, caseUpdates)
    }
  }

  renderDashboard(cases, updatesByCase, reason)

  return { cases, updatesByCase }
}

async function refreshDashboard(reason) {
  if (refreshInProgress) {
    refreshQueued = true
    return
  }

  refreshInProgress = true

  try {
    await loadDashboardData(reason)
  } catch (error) {
    console.error('\nDashboard refresh failed:', error)
  } finally {
    refreshInProgress = false

    if (refreshQueued) {
      refreshQueued = false
      void refreshDashboard('queued Realtime refresh')
    }
  }
}

function waitForSubscription(activeChannel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for the Realtime subscription.'))
    }, 8000)

    activeChannel.subscribe((status, error) => {
      console.log(`Realtime subscription status: ${status}`)

      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout)
        resolve()
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout)
        reject(error ?? new Error(`Realtime status: ${status}`))
      }
    })
  })
}

async function main() {
  const {
    data: { session },
    error: signInError
  } = await client.auth.signInWithPassword({ email, password })

  if (signInError) throw signInError
  if (!session) throw new Error('Expected a signed-in session.')

  await client.realtime.setAuth(session.access_token)

  channel = client
    .channel('support-case-dashboard')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'support_cases' },
      () => void refreshDashboard('support_cases Realtime event')
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'case_updates' },
      () => void refreshDashboard('case_updates Realtime event')
    )

  await waitForSubscription(channel)

  // Production resilience: query the RLS-scoped source of truth after subscribing.
  // Unlike the controlled demo, normal dashboard loading has no artificial delay.
  await loadDashboardData()

  console.log('\nDashboard is live. Press Ctrl+C to stop.')

  process.on('SIGINT', async () => {
    if (channel) await client.removeChannel(channel)
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('\nDashboard startup failed:')
  console.error(error)
  process.exitCode = 1
})