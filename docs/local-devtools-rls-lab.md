# Local DevTools RLS Lab

This local-only fixture tool creates two test customers in separate tenants, each with one support case. Use it to inspect tenant isolation through browser DevTools, the Supabase Data API, and PostgreSQL. It is separate from the automated authorization and Realtime demos.

## Safety boundary

- Setup refuses to run unless the Supabase URL hostname is `localhost` or `127.0.0.1`.
- The local service-role key is used **only** for fixture setup and cleanup. Never paste it into browser DevTools.
- Browser requests use the local anon/publishable key plus a customer's JWT, so normal RLS policies apply.
- Fixture IDs are stored in the gitignored `.devtools-lab-state.json`; the shared password is printed once, not saved to disk.
- Fixtures persist until explicitly cleaned up. Keep the password and access tokens private.

## Start and set up fixtures

From this repository in Git Bash, with Docker Desktop running:

```bash
npx supabase start
eval "$(npx supabase status -o env | sed -E 's/^([A-Z0-9_]+)=/export \\1=/')"
npm run lab:devtools:setup
```

If setup reports that the lab already exists, **do not recreate it immediately**. Inspect the existing fixture IDs:

```bash
node -e "const s=require('./.devtools-lab-state.json'); for(const k of ['customer-a','customer-b']) console.log(k,s[k])"
```

Keep the password printed by the original setup. The fixtures must still exist in the current local database for the test to work.

## Browser DevTools helper

Open local Supabase Studio at `http://127.0.0.1:55323`, then open Chrome DevTools → Console. Use only your **local anon key**, not the service-role key. In Git Bash, `printf '%s' "$ANON_KEY" | clip` copies the anon key to your Windows clipboard.

Paste this helper into the Console once. Replace the placeholder key with your local anon key; enter the password when prompted by the browser (it will not be saved in the script). You can use the email addresses and case IDs printed from `.devtools-lab-state.json`.

```javascript
var labApi = 'http://127.0.0.1:55321';
var labAnonKey = 'YOUR_LOCAL_ANON_KEY';

async function labSignIn(email) {
  const password = prompt('Local test password for ' + email);
  if (!password) throw new Error('Password required');

  const response = await fetch(`${labApi}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: labAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Sign-in failed (HTTP ${response.status}): ${JSON.stringify(data)}`);
  }
  console.log('Signed in:', email, 'HTTP', response.status);
  return data.access_token;
}

async function labCases(token, caseId = null) {
  const params = new URLSearchParams({ select: 'id,subject,status' });
  if (caseId) params.set('id', `eq.${caseId}`);

  const response = await fetch(`${labApi}/rest/v1/support_cases?${params}`, {
    headers: { apikey: labAnonKey, Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  console.log('HTTP status:', response.status);
  console.log('Rows returned:', Array.isArray(data) ? data.length : 'error');
  console.table(data);
  return { status: response.status, data };
}
```

Sign in as each customer, storing their tokens only in this DevTools session:

```javascript
var tokenA = await labSignIn('EMAIL_FROM_customer-a');
var tokenB = await labSignIn('EMAIL_FROM_customer-b');
```

Now compare the results (replace the case-ID placeholders using the local state file):

```javascript
await labCases(tokenA);                  // Customer A sees their own case
await labCases(tokenA, 'CUSTOMER_B_CASE_ID'); // Customer A cannot see B's case
await labCases(tokenB);                  // Customer B sees their own case
await labCases(tokenB, 'CUSTOMER_A_CASE_ID'); // Customer B cannot see A's case
```

Expected for an unauthorized row: **HTTP 200 with an empty array (`[]`)**. A successful SELECT request can return zero rows because PostgreSQL RLS filters out rows the authenticated user is not permitted to read.

### Optional negative write test

This helper attempts a status update using the customer's JWT. **Only use it against local lab fixtures.**

```javascript
async function labTryStatusUpdate(token, caseId, status = 'in_progress') {
  const params = new URLSearchParams({ id: `eq.${caseId}` });
  const response = await fetch(`${labApi}/rest/v1/support_cases?${params}`, {
    method: 'PATCH',
    headers: {
      apikey: labAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ status })
  });
  const data = await response.json();
  console.log('HTTP status:', response.status, 'Response:', data);
  return { status: response.status, data };
}

// Customer B attempts to update Customer A's case:
await labTryStatusUpdate(tokenB, 'CUSTOMER_A_CASE_ID');

// Verify the case's status through Customer A's authorized session:
await labCases(tokenA, 'CUSTOMER_A_CASE_ID');
```

The existing customer policies do not permit case status updates. An HTTP 200 with `[]` can indicate that no rows were eligible for UPDATE. Always verify the stored status afterward.

## Cleanup

When finished, remove the fixture users and cases:

```bash
npm run lab:devtools:cleanup
```

The helper variables and tokens live only in the current browser JavaScript context. Don't share tokens, passwords, or Console screenshots containing secrets. Reloading the page clears the variables, and access tokens can expire.
