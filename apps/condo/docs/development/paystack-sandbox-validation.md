# Paystack Sandbox Validation Runbook

This runbook is for the final Paystack sandbox check after the controlled initiation and verification implementation landed.

Current phase freeze:
- Do not change business logic.
- Do not add new provider code.
- Do not add production webhook route wiring in this phase.
- Do not change Hubtel behavior in this phase.

## Required environment

Set these in `apps/condo/.env` or export them in the shell before running commands:

- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_INITIATION_ENABLED=true`
- `PAYSTACK_CALLBACK_URL` (optional)
- `PAYSTACK_SMOKE_REFERENCE` for verification-only smoke

If you use shell exports:

```bash
export PAYSTACK_SECRET_KEY='sk_test_xxx'
export PAYSTACK_INITIATION_ENABLED='true'
export PAYSTACK_CALLBACK_URL='http://localhost:3000/payments/paystack/callback'
export PAYSTACK_SMOKE_REFERENCE='paystack-sandbox-reference'
```

Start the app with the Paystack flags enabled:

```bash
yarn workspace @app/condo dev
```

Use `http://localhost:4006/admin/api` unless your local `.env` assigns a different port.

## Commands

Verification-only smoke:

```bash
PAYSTACK_SECRET_KEY='sk_test_xxx' \
PAYSTACK_SMOKE_REFERENCE='paystack-sandbox-reference' \
yarn workspace @app/condo paystack:verify:smoke
```

Controlled initiation test:

```bash
curl -sS 'http://localhost:4006/admin/api' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CONDO_TOKEN" \
    --data-raw "{\"query\":\"mutation InitiateRentPayment(\\$data: InitiateRentPaymentInput!) { result: initiateRentPayment(data: \\$data) { paymentId provider providerReference amount currency status authorizationUrl paymentUrl actionTaken } }\",\"variables\":{\"data\":{\"dv\":1,\"sender\":{\"dv\":1,\"fingerprint\":\"paystack-sandbox-runbook\"},\"organization\":{\"id\":\"$ORG_ID\"},\"tenant\":{\"id\":\"$TENANT_ID\"},\"amount\":\"150.00\",\"currency\":\"NGN\",\"providerCode\":\"paystack\",\"reference\":\"$PAYSTACK_REFERENCE\",\"payerContact\":{\"email\":\"$PAYER_EMAIL\",\"phone\":\"$PAYER_PHONE\"},\"rentContext\":{\"id\":\"$RENT_CONTEXT_ID\"}}}}"
```

Post-payment verification:

```bash
curl -sS 'http://localhost:4006/admin/api' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CONDO_TOKEN" \
    --data-raw "{\"query\":\"mutation VerifyPendingPayment(\\$data: VerifyPendingPaymentInput!) { result: verifyPendingPayment(data: \\$data) { paymentId provider providerReference amount currency status authorizationUrl paymentUrl actionTaken } }\",\"variables\":{\"data\":{\"dv\":1,\"sender\":{\"dv\":1,\"fingerprint\":\"paystack-sandbox-runbook\"},\"providerCode\":\"paystack\",\"providerReference\":\"$PAYSTACK_REFERENCE\"}}}"
```

Optional focused test anchors for local confidence:

```bash
yarn workspace @app/condo test apps/condo/domains/acquiring/utils/serverSchema/publicRentPaymentApi.spec.js -t "returns the safe Paystack initiation response shape"
```

```bash
yarn workspace @app/condo test apps/condo/domains/acquiring/utils/serverSchema/verifyPendingPayment.spec.js -t "confirmed Paystack verification confirms existing pending payment"
```

## Expected public DTO

Public responses must expose only this shape:

```json
{
  "paymentId": "Payment-1",
  "provider": "paystack",
  "providerReference": "paystack-ref-1",
  "amount": "150.00",
  "currency": "NGN",
  "status": "PROCESSING",
  "authorizationUrl": "https://checkout.paystack.com/...",
  "paymentUrl": "https://checkout.paystack.com/...",
  "actionTaken": null
}
```

After successful verification, expect the same public shape with:

- `status: "DONE"`
- `authorizationUrl: null`
- `paymentUrl: null`
- `actionTaken: "confirmed"`

## Expected internal result

Expected payment status transition:

```text
PROCESSING -> DONE
```

Expected accounting side effects after successful verification:

- `PaymentAllocation` created
- `PaymentReceipt` created
- `LedgerEntry` created

## Must Not Happen

- No raw provider payload in the public API.
- No Paystack secret in logs or surfaced errors.
- No production webhook route wiring in this phase.
- No Hubtel changes in this phase.

## Troubleshooting

Missing env vars:
- `PAYSTACK_SECRET_KEY` missing blocks both initiation and verification.
- `PAYSTACK_SMOKE_REFERENCE` missing makes the verification smoke skip.

`PAYSTACK_INITIATION_ENABLED` not exactly `'true'`:
- Initiation stays disabled unless the value is boolean `true` or the exact string `'true'`.

Network unavailable:
- Sandbox initiation and verification require outbound access to Paystack.
- Retry only after confirming network egress is available from the running app environment.

Invalid or expired reference:
- Verification fails or returns a non-confirming provider status when `providerReference` no longer exists in Paystack sandbox or was never created.

Amount mismatch:
- Paystack uses subunits while Condo stores major units.
- Example: `150.00 NGN` in Condo must be sent and verified as `15000` at the provider boundary.
