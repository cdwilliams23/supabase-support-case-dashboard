import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const url = process.env.API_URL ?? process.env.SUPABASE_URL
const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY
const serviceRoleKey =
  process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    'Missing local Supabase credentials. Set API_URL, ANON_KEY, and SERVICE_ROLE_KEY before running.'
  )
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const makeUserClient = async (email, password) => {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error

  return client
}

const assert = (condition, message) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
  console.log(`✓ ${message}`)
}

const runId = randomUUID().slice(0, 8)
const password = 'Local-test-password-123!'
const tenantA = randomUUID()
const tenantB = randomUUID()
const userIds = []
const caseIds = []

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

async function main() {
  try {
    const customerA = await createUser('customer-a')
    const customerB = await createUser('customer-b')
    const agentA = await createUser('agent-a')
    const agentB = await createUser('agent-b')

    const { error: profileError } = await admin.from('profiles').insert([
      {
        id: customerA.id,
        tenant_id: tenantA,
        role: 'customer',
        display_name: 'Customer A'
      },
      {
        id: customerB.id,
        tenant_id: tenantB,
        role: 'customer',
        display_name: 'Customer B'
      },
      {
        id: agentA.id,
        tenant_id: tenantA,
        role: 'support_agent',
        display_name: 'Agent A'
      },
      {
        id: agentB.id,
        tenant_id: tenantB,
        role: 'support_agent',
        display_name: 'Agent B'
      }
    ])

    if (profileError) throw profileError

    const customerAClient = await makeUserClient(customerA.email, password)
    const customerBClient = await makeUserClient(customerB.email, password)
    const agentAClient = await makeUserClient(agentA.email, password)
    const agentBClient = await makeUserClient(agentB.email, password)

    const { data: supportCase, error: createCaseError } = await customerAClient
      .from('support_cases')
      .insert({
        tenant_id: tenantA,
        customer_id: customerA.id,
        subject: 'Unable to sign in',
        description: 'My local test account cannot sign in.'
      })
      .select()
      .single()

    if (createCaseError) throw createCaseError

    caseIds.push(supportCase.id)

    assert(
      supportCase.customer_id === customerA.id,
      'Customer A can create a case in their tenant'
    )

    const { data: hiddenCases, error: crossTenantReadError } =
      await customerBClient
        .from('support_cases')
        .select('id')
        .eq('id', supportCase.id)

    if (crossTenantReadError) throw crossTenantReadError

    assert(
      hiddenCases.length === 0,
      'Customer B cannot read Customer A’s tenant case'
    )

    const { error: crossTenantInsertError } = await customerBClient
      .from('support_cases')
      .insert({
        tenant_id: tenantA,
        customer_id: customerB.id,
        subject: 'Unauthorized tenant attempt',
        description: 'This should be rejected by the insert policy.'
      })

    assert(
      crossTenantInsertError,
      'Customer B cannot create a case in another tenant'
    )

    const { data: otherAgentUpdate, error: otherAgentUpdateError } =
      await agentBClient
        .from('support_cases')
        .update({ status: 'in_progress' })
        .eq('id', supportCase.id)
        .select()

    if (otherAgentUpdateError) throw otherAgentUpdateError

    assert(
      otherAgentUpdate.length === 0,
      'Agent B cannot update a case outside their tenant'
    )

    const { data: updatedCase, error: agentUpdateError } = await agentAClient
      .from('support_cases')
      .update({ status: 'in_progress' })
      .eq('id', supportCase.id)
      .select()
      .single()

    if (agentUpdateError) throw agentUpdateError

    assert(
      updatedCase.status === 'in_progress',
      'Agent A can update a case in their tenant'
    )

    const { error: internalUpdateError } = await agentAClient
      .from('case_updates')
      .insert({
        case_id: supportCase.id,
        author_id: agentA.id,
        body: 'Internal triage note',
        previous_status: 'open',
        new_status: 'in_progress',
        is_internal: true
      })

    if (internalUpdateError) throw internalUpdateError

    assert(true, 'Agent A can add an internal update')

    const { data: customerVisibleUpdates, error: customerUpdatesError } =
      await customerAClient
        .from('case_updates')
        .select('id')
        .eq('case_id', supportCase.id)

    if (customerUpdatesError) throw customerUpdatesError

    assert(
      customerVisibleUpdates.length === 0,
      'Customer A cannot read internal case updates'
    )
    } finally {
    console.log('\nCleaning up temporary test data...')

    if (caseIds.length > 0) {
      const { error: caseCleanupError } = await admin
        .from('support_cases')
        .delete()
        .in('id', caseIds)

      if (caseCleanupError) {
        console.error('Could not delete temporary test cases:', caseCleanupError)
      }
    }

    for (const userId of userIds) {
      const { error: userCleanupError } = await admin.auth.admin.deleteUser(userId)

      if (userCleanupError) {
        console.error('Could not delete temporary test user:', userCleanupError)
      }
    }

    console.log('Temporary test data cleanup finished.')
  }
}

main().catch((error) => {
  console.error('\nAuthorization test failed:')
  console.error(error)
  process.exitCode = 1
})