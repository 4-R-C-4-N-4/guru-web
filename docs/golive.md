Yes — clear it. The test-mode rows become unreachable after the flip and just pollute admin views. Here's the
  actual situation and the right move.                  
                                                                                                                    
  Why the test data becomes unreachable       
                                                                                                                    
  Clerk's test and live instances are completely separate identity providers. Test-mode user IDs (user_2NZxxx) don't
   exist in live mode — anyone signing up after the flip gets a brand-new ID in a different namespace. Your users   
  table joins on Clerk's ID, so:                                  
                                                                                                                    
  - Existing rows: never match a live-mode auth().userId → requireUser() returns 401 → those records are
  inaccessible                                                                                                      
  - New live signups: lazy-upsert via the new code → fresh rows with live-mode IDs
                                                                                                                    
  Functionally, leaving the data is harmless. Practically, it pollutes /admin/users, distorts spend/usage rollups,
  and means the stripe_customer_id column has dangling refs to test-mode Stripe customers (which also don't exist in
   live Stripe).                                                                                                    
                                                                                                                    
  What cascades when you delete                                                                                     
                                                                                                                    
  Verified the FK chain — every user-keyed table cascades from users:

  ┌──────────────────────┬───────────────────────┐
  │        Table         │       Migration       │
  ├──────────────────────┼───────────────────────┤
  │ sessions             │ 002 ON DELETE CASCADE │
  ├──────────────────────┼───────────────────────┤
  │ queries              │ 002 ON DELETE CASCADE │
  ├──────────────────────┼───────────────────────┤
  │ user_preferences     │ 003 ON DELETE CASCADE │
  ├──────────────────────┼───────────────────────┤
  │ quota_usage (legacy) │ 004 ON DELETE CASCADE │
  ├──────────────────────┼───────────────────────┤
  │ rate_limits          │ 005 ON DELETE CASCADE │
  ├──────────────────────┼───────────────────────┤
  │ user_budgets         │ 006 ON DELETE CASCADE │
  └──────────────────────┴───────────────────────┘

  So one DELETE FROM users wipes all six tables consistently.

  Do this before the flip                     
                                          
  # Sanity check first — see what you're about to nuke
  psql "$DATABASE_URL" -c "SELECT id, email, tier, created_at FROM users ORDER BY created_at"                       
                                              
  # If only test data, clear it                                                                                     
  psql "$DATABASE_URL" -c "DELETE FROM users"                                                                       
                                                                                                                    
  # Verify cascades took out everything user-keyed                                                                  
  psql "$DATABASE_URL" -c "                                                                                         
    SELECT 'users' AS t, count(*) FROM users                                                                        
    UNION ALL SELECT 'sessions',         count(*) FROM sessions                                                     
    UNION ALL SELECT 'queries',          count(*) FROM queries                                                      
    UNION ALL SELECT 'user_preferences', count(*) FROM user_preferences                                             
    UNION ALL SELECT 'user_budgets',     count(*) FROM user_budgets                                                 
    UNION ALL SELECT 'rate_limits',      count(*) FROM rate_limits                                                  
  "                                                                                                                 
  # expect: all zeros                                                                                               
                                                                                                                    
  TRUNCATE users CASCADE is faster but DELETE keeps the option of WHERE if you want to selectively keep something   
  (e.g., your own test account that you'll re-sign-up with the same email).                                         
                                                                                                                    
  What you also need to update (separate from the DB)                                                               
                                          
  1. ADMIN_USER_IDS env var: contains comma-separated Clerk user IDs for admin allowlist. The test-mode IDs in there
   now will match nobody in live mode → no one will be admin. Sign in once via live Clerk, copy your new user_xxx ID
   from the Clerk dashboard, update /etc/guru-web.env (or wherever), restart.
  2. Stripe: switching STRIPE_SECRET_KEY to live also flips you to a separate Stripe environment. Test customers    
  stay in test mode (you can leave them or delete from the Stripe test dashboard — your call, doesn't affect prod).
                                                                                                                    
  Order of operations for the flip                                
                                                                                                                    
  1. Stop the app (or just don't worry — sessions on test keys break gracefully)
  2. DELETE FROM users (wipes everything user-keyed via CASCADE)                                                    
  3. Update env file: rotate Clerk + Stripe keys to live, blank out ADMIN_USER_IDS for now
  4. systemctl restart guru-web — boot will succeed (webhook secrets now REQUIRED, confirm they're set)             
  5. Sign up via your live Clerk on /sign-up to seed the first user
  6. Copy your new live-mode user ID into ADMIN_USER_IDS                                                            
  7. systemctl restart guru-web again to pick up the admin allowlist                                                
  8. Verify /admin works for you                                                                                    
                                                                                                                    
  You only need step 7's restart because the admin allowlist is read at boot. Everything else can be a single       
  restart.                                                                                                          
                                                                                                                    
  What you keep across the flip                                                                                     
                                                                                                                    
  The corpus tables (corpus.chunks, corpus.corpus_metadata, etc) and model_pricing are user-independent and stay    
  as-is. So is stripe_webhook_events if/when you add it. Only the user-keyed data gets reset.
