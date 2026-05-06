const {
    runPaystackVerificationSmoke,
} = require('./PaystackVerificationSmoke')

function createJsonResponse (payload, overrides = {}) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(payload),
        ...overrides,
    }
}

describe('runPaystackVerificationSmoke', () => {
    test('skips cleanly when verification credentials are absent', async () => {
        const result = await runPaystackVerificationSmoke({
            env: {},
        })

        expect(result).toEqual({
            skipped: true,
            provider: 'paystack',
            reason: 'PAYSTACK_SECRET_KEY is not configured',
            configuration: {
                secretKeyConfigured: false,
                providerReferenceConfigured: false,
                baseUrlConfigured: false,
                paymentMethodConfigured: false,
            },
        })
    })

    test('skips cleanly when provider reference is absent', async () => {
        const result = await runPaystackVerificationSmoke({
            env: {
                PAYSTACK_SECRET_KEY: 'sk_test_paystack',
            },
        })

        expect(result).toEqual({
            skipped: true,
            provider: 'paystack',
            reason: 'PAYSTACK_SMOKE_REFERENCE is not configured',
            configuration: {
                secretKeyConfigured: true,
                providerReferenceConfigured: false,
                baseUrlConfigured: false,
                paymentMethodConfigured: false,
            },
        })
    })

    test('returns a sanitized verification-only payload with amount conversion details', async () => {
        const fetch = jest.fn().mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                status: 'success',
                amount: '5015',
                currency: 'GHS',
                paid_at: '2026-05-05T00:00:00.000Z',
                reference: 'paystack-live-ref-001',
            },
        }))

        const result = await runPaystackVerificationSmoke({
            env: {
                PAYSTACK_SECRET_KEY: 'sk_test_paystack',
                PAYSTACK_SMOKE_REFERENCE: 'paystack-live-ref-001',
                PAYSTACK_SMOKE_PAYMENT_METHOD: 'mobile_money',
            },
            fetch,
        })

        expect(result).toEqual({
            skipped: false,
            provider: 'paystack',
            providerReference: 'paystack-live-ref-001',
            externalTransactionId: 'paystack-live-ref-001',
            paymentMethod: 'mobile_money',
            confirmed: true,
            confirmedAt: '2026-05-05T00:00:00.000Z',
            status: 'DONE',
            internalStatus: 'confirmed',
            providerStatus: 'success',
            amount: '50.15',
            currencyCode: 'GHS',
            amountConvention: {
                internal: {
                    amount: '50.15',
                    unit: 'major',
                },
                provider: {
                    amount: '5015',
                    unit: 'subunit',
                },
                currencyCode: 'GHS',
            },
            verification: {
                endpoint: '/transaction/verify/:reference',
            },
        })
        expect(result.paymentData).toBeUndefined()
        expect(result.metadata).toBeUndefined()
        expect(JSON.stringify(result)).not.toContain('sk_test_paystack')
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    test('allows an explicit CLI reference to override env reference', async () => {
        const fetch = jest.fn().mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                status: 'pending',
                amount: '100',
                currency: 'NGN',
                reference: 'paystack-cli-ref-001',
            },
        }))

        const result = await runPaystackVerificationSmoke({
            env: {
                PAYSTACK_SECRET_KEY: 'sk_test_paystack',
                PAYSTACK_SMOKE_REFERENCE: 'paystack-env-ref-001',
            },
            providerReference: 'paystack-cli-ref-001',
            fetch,
        })

        expect(result.providerReference).toBe('paystack-cli-ref-001')
        expect(result.externalTransactionId).toBe('paystack-cli-ref-001')
        expect(result.confirmed).toBe(false)
        expect(result.status).toBe('PROCESSING')
    })
})
