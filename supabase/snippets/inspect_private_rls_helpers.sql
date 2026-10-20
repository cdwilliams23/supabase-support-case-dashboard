SELECT
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n
    ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname IN (
      'is_support_agent_for_case',
      'is_current_user_customer_for_case'
  )
ORDER BY p.proname;