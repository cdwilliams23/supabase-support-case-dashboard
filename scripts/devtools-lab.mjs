
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'

const action = process.argv[2]

if (!['setup', 'cleanup'].includes(action)) {
  console.error('Usage: node scripts/devtools-lab.mjs setup|cleanup')
  process.exit(1)
}

const url = process.env.API_URL ?? process.env.SUPABASE_URL
const serviceKey =
  process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Load local Supabase credentials first.')
}

const parsed = new URL(url)

if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
  throw new Error('Safety check: this lab only runs against localhost Supabase.')
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

const statePath = new URL('../.devtools-lab-state.json', import.meta.url)

async function cleanup(state) {
  for (const id of state.caseIds ?? []) {
    const { error } = await admin
      .from('support_cases')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  for (const id of state.userIds ?? []) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw error
  }
}

if (action === 'cleanup') {
  const state = JSON.parse(await readFile(statePath, 'utf8'))

  await cleanup(state)
  await unlink(statePath)

  console.log('DevTools lab cases and users removed.')
} else {
  try {
    await readFile(statePath, 'utf8')
    throw new Error('Lab already exists. Run cleanup before setup again.')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  const runId = randomUUID().slice(0, 8)
  const password = `Local-${randomUUID()}!aA1`
  const state = { userIds: [], caseIds: [] }

  try {
    for (const label of ['customer-a', 'customer-b']) {
      const email = `devtools-${label}-${runId}@example.test`

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

      if (error) throw error

      state.userIds.push(data.user.id)

      const tenantId = randomUUID()

      const { error: profileError } = await admin
        .from('profiles')
        .insert({
          id: data.user.id,
          tenant_id: tenantId,
          role: 'customer',
          display_name: `DevTools ${label}`
        })

      if (profileError) throw profileError

      const { data: supportCase, error: caseError } = await admin
        .from('support_cases')
        .insert({
          customer_id: data.user.id,
          tenant_id: tenantId,
          subject: `DevTools lab case for ${label}`,
          description: 'Temporary case for practicing RLS using Chrome DevTools.'
        })
        .select('id')
        .single()

      if (caseError) throw caseError

      state.caseIds.push(supportCase.id)

      state[label] = {
        email,
        userId: data.user.id,
        caseId: supportCase.id
      }
    }

    await writeFile(
      statePath,
      JSON.stringify(state, null, 2),
      { flag: 'wx', mode: 0o600 }
    )

    console.log('\nLOCAL DEVTOOLS LAB READY')
    console.log('Customer A:', state['customer-a'])
    console.log('Customer B:', state['customer-b'])
    console.log('Both customers password:', password)
    console.log('Save password privately; it is not written to disk.')
    console.log('After practice: node scripts/devtools-lab.mjs cleanup')
  } catch (error) {
    console.error('Setup failed:', error.message)

    try {
      await cleanup(state)
    } catch (cleanupError) {
      console.error('Partial cleanup failed:', cleanupError.message)
    }

    process.exitCode = 1
  }
}
