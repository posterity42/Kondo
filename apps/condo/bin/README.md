# HowTo run ?

Use `yarn workspace @app/condo node ./bin/test-sbbol-oauth-by-hands.js` command

# SBBOL change-client-secret examples #

Use: `yarn workspace @app/condo node ./bin/sbbol/credentials.js change-client-secret`

# Create OIDC client #

Use: `yarn workspace @app/condo node ./bin/create-oidc-client.js client1 secret1 http://localhost:3001/oidc/callback postLogoutRedirectUri [--native-application-type]`

- --native-application-type - allows OIDC working on localhost without https

# HowTo organise ?

Try to avoid to use common scripts. It's better to group the scripts by tasks, like `sbbol`.

# Deleting Meters with MeterReadings in certain Property

Use: `yarn workspace @app/condo node ./bin/delete-meters-by-property-ids.js propertyId1 propertyId2` command

# Remove legacy tables and columns

Use: `yarn workspace @app/condo node ./bin/fix-database-migration-state.js` command

# Paystack verification smoke

Use: `yarn workspace @app/condo paystack:verify:smoke -- <paystack_reference>`

Verification-only env vars:
- `PAYSTACK_SECRET_KEY` - required, used only for the `/transaction/verify/:reference` API call
- `PAYSTACK_SMOKE_REFERENCE` - optional when `<paystack_reference>` is passed on the CLI, otherwise required
- `PAYSTACK_API_URL` - optional override for the Paystack API base URL, defaults to `https://api.paystack.co`
- `PAYSTACK_SMOKE_PAYMENT_METHOD` - optional label forwarded into the normalized smoke output

When `PAYSTACK_SECRET_KEY` or a reference is absent, the smoke script exits successfully and prints a `status: "skipped"` payload instead of failing.

# Changing Organization inn

Use: `yarn workspace @app/condo node ./bin/change-organization-inn.js <org_id> <new_inn>` command
