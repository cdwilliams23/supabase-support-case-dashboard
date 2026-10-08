import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const url = process.env.API_URL ?? process.env.SUPABASE_URL
const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const serviceRoleKey =
  process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    'Missing local Supabase credentials. Load them with `npx supabase status -o env` first.'
  )
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const assert = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
  console.log(`✓ ${message}`)
}

const runId = randomUUID().slice(0, 8)
const password = 'Local-realtime-password-123!'
const tenantId = randomUUID()
const userIds = []
let caseId
let subscriber
let channel

async function createUser(label) {
  const email = `${label}-${runId}@example.test`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })

  if (error) throw error

  userIds.push(data.user.id)
  return { id: data.user.id, email }
}

async function signIn(email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const {
    data: { session },
    error
  } = await client.auth.signInWithPassword({ email, password })

  if (error) throw error
  if (!session) throw new Error('Expected a signed-in session.')

  await client.realtime.setAuth(session.access_token)

  return client
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function waitForSubscription(activeChannel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Realtime subscription.'))
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

function waitForEvent(eventPromise) {
  return Promise.race([
    eventPromise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out waiting for the status-change event.')),
        8000
      )
    })
  ])
}

async function main() {
  try {
    const customer = await createUser('realtime-customer')
    const agent = await createUser('realtime-agent')

    const { error: profileError } = await admin.from('profiles').insert([
      {
        id: customer.id,
        tenant_id: tenantId,
        role: 'customer',
        display_name: 'Realtime Customer'
      },
      {
        id: agent.id,
        tenant_id: tenantId,
        role: 'support_agent',
        display_name: 'Realtime Agent'
      }
    ])

    if (profileError) throw profileError

    subscriber = await signIn(customer.email)
    const agentClient = await signIn(agent.email)

    const { data: supportCase, error: createCaseError } = await subscriber
      .from('support_cases')
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        subject: 'Realtime status demo',
        description: 'A temporary case used by the Realtime subscriber.'
      })
      .select()
      .single()

    if (createCaseError) throw createCaseError

    caseId = supportCase.id
    assert(true, 'Customer created a case visible to their JWT')

    let receiveEvent

    const eventPromise = new Promise((resolve) => {
      receiveEvent = resolve
    })

    channel = subscriber
      .channel(`case-status-${runId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_cases'
        },
        (payload) => {
          if (payload.new.id !== caseId) return

          console.log('Received Realtime event:', payload.eventType, payload.new.status)
          receiveEvent(payload)
        }
      )

    await waitForSubscription(channel)
    await wait(3000)

    const { data: updatedCase, error: updateError } = await agentClient
      .from('support_cases')
      .update({ status: 'in_progress' })
      .eq('id', caseId)
      .select()
      .single()

    if (updateError) throw updateError

    assert(
      updatedCase.status === 'in_progress',
      'Agent updated the case in the same tenant'
    )

    const { data: persistedCase, error: persistedCaseError } = await admin
      .from('support_cases')
      .select('id, status')
      .eq('id', caseId)
      .single()

    if (persistedCaseError) throw persistedCaseError

    assert(
      persistedCase.id === caseId && persistedCase.status === 'in_progress',
      'Updated case row exists in PostgreSQL with status in_progress'
    )

    const event = await waitForEvent(eventPromise)

    assert(
      event.new.id === caseId && event.new.status === 'in_progress',
      'Customer received the permitted Realtime status-change event'
    )
  } finally {
    console.log('\nCleaning up temporary Realtime demo data...')

    if (channel && subscriber) {
      await subscriber.removeChannel(channel)
    }

    if (caseId) {
      await admin.from('support_cases').delete().eq('id', caseId)
    }

    for (const userId of userIds) {
      await admin.auth.admin.deleteUser(userId)
    }

    console.log('Temporary Realtime demo data cleanup finished.')
  }
}

main().catch((error) => {
  console.error('\nRealtime demo failed:')
  console.error(error)
  process.exitCode = 1
})