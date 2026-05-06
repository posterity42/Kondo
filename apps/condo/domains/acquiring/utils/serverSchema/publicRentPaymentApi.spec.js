/**
 * @jest-environment node
 */

const crypto = require('crypto')

const stores = {}
const counters = {}

function resetStores () {
    for (const listKey of ['Organization', 'Payment', 'PaymentProviderCredential', 'TenantLedger', 'LedgerEntry', 'PaymentAllocation', 'PaymentReceipt', 'RentCharge']) {
        stores[listKey] = []
        counters[listKey] = 0
    }
}

function getRelationId (value) {
    return value && value.id ? value.id : value
}

function flattenRelations (data) {
    const result = { ...data }

    for (const [key, value] of Object.entries(result)) {
        if (value && value.connect && value.connect.id) {
            result[key] = value.connect.id
        }
    }

    return result
}

function matchesWhere (item, where) {
    return Object.entries(where).every(([key, value]) => {
        if (key === 'deletedAt') return item.deletedAt === value
        if (key.endsWith('_not')) return item[key.slice(0, -4)] !== value
        if (value && typeof value === 'object' && value.id) return getRelationId(item[key]) === value.id
        return item[key] === value
    })
}

const mockFind = jest.fn(async (listKey, where) => stores[listKey].filter(item => matchesWhere(item, where)))
const mockGetById = jest.fn(async (listKey, id) => stores[listKey].find(item => item.id === id) || null)

jest.mock('@open-condo/keystone/schema', () => ({
    find: mockFind,
    getById: mockGetById,
}))

jest.mock('@open-condo/codegen/generate.server.utils', () => ({
    execGqlWithoutAccess: jest.fn(),
    generateServerUtils: jest.fn((listKey) => ({
        create: jest.fn(async (context, data) => {
            counters[listKey] += 1
            const item = {
                id: `${listKey}-${counters[listKey]}`,
                ...flattenRelations(data),
                deletedAt: null,
            }
            stores[listKey].push(item)
            return item
        }),
        update: jest.fn(async (context, id, data) => {
            const item = stores[listKey].find(item => item.id === id)
            Object.assign(item, flattenRelations(data))

            if (listKey === 'Payment' && item.status === 'DONE' && item.tenant) {
                const { processConfirmedRentPayment } = require('@condo/domains/billing/utils/serverSchema/paymentAllocation')
                await processConfirmedRentPayment(context, item)
            }

            return item
        }),
        getOne: jest.fn(),
    })),
}))

const {
    PAYMENT_DONE_STATUS,
    PAYMENT_ERROR_STATUS,
    PAYMENT_PROCESSING_STATUS,
} = require('@condo/domains/acquiring/constants/payment')
const {
    RENT_PAYMENT_PROVIDER_HUBTEL,
    RENT_PAYMENT_PROVIDER_MANUAL,
    RENT_PAYMENT_PROVIDER_PAYSTACK,
} = require('@condo/domains/acquiring/constants/rentPayment')
const {
    buildPublicRentPaymentResponse,
    handleProviderWebhookRequestPublic,
    initiateRentPaymentPublic,
    verifyPendingPaymentPublic,
} = require('./index')
const { UnknownPaymentProviderError } = require('./paymentProviders')

const sender = { dv: 1, fingerprint: 'test' }
const baseInitiationData = {
    dv: 1,
    sender,
    organization: { id: 'organization-1' },
    tenant: { id: 'tenant-1' },
    amount: '125.50',
    currency: 'GHS',
    payerContact: {
        email: 'resident@example.com',
        phone: '+233000000000',
    },
    rentContext: {
        id: 'rent-context-1',
    },
}

function createJsonResponse (payload, overrides = {}) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(payload),
        ...overrides,
    }
}

function addPendingPayment (attrs = {}) {
    const payment = {
        id: `payment-${stores.Payment.length + 1}`,
        dv: 1,
        sender,
        organization: 'organization-1',
        tenant: 'tenant-1',
        occupancy: 'occupancy-1',
        property: 'property-1',
        rentalUnit: 'rental-unit-1',
        amount: '150',
        currencyCode: 'GHS',
        provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        providerReference: 'paystack-ref-1',
        externalTransactionId: 'paystack-ref-1',
        status: PAYMENT_PROCESSING_STATUS,
        confirmedAt: null,
        advancedAt: null,
        deletedAt: null,
        ...attrs,
    }

    stores.Payment.push(payment)
    return payment
}

function addRentCharge (attrs = {}) {
    const index = stores.RentCharge.length + 1
    const rentCharge = {
        id: `charge-${index}`,
        organization: 'organization-1',
        tenant: 'tenant-1',
        property: 'property-1',
        rentalUnit: 'rental-unit-1',
        occupancy: 'occupancy-1',
        amount: '100',
        currencyCode: 'GHS',
        status: 'invoiced',
        dueDate: `2026-0${index}-01`,
        billingMonth: `2026-0${index}-01`,
        sender,
        deletedAt: null,
        ...attrs,
    }
    stores.RentCharge.push(rentCharge)
    return rentCharge
}

function expectOnlyPublicFields (result) {
    expect(Object.keys(result).sort()).toEqual([
        'actionTaken',
        'amount',
        'authorizationUrl',
        'currency',
        'paymentId',
        'paymentUrl',
        'provider',
        'providerReference',
        'status',
    ])
}

describe('public rent payment API wrappers', () => {
    const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY
    const originalPaystackInitiationEnabled = process.env.PAYSTACK_INITIATION_ENABLED
    const originalPaystackAllowFallback = process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK
    const originalHubtelSecret = process.env.HUBTEL_SECRET_KEY
    const originalHubtelApiKey = process.env.HUBTEL_API_KEY
    const originalFetch = global.fetch

    beforeEach(() => {
        resetStores()
        jest.clearAllMocks()
        delete process.env.PAYSTACK_SECRET_KEY
        delete process.env.PAYSTACK_INITIATION_ENABLED
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'true'
        delete process.env.HUBTEL_SECRET_KEY
        delete process.env.HUBTEL_API_KEY
        global.fetch = jest.fn()
        stores.Organization.push({ id: 'organization-1', receiptCode: 'KONDO', deletedAt: null })
    })

    afterAll(() => {
        process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret
        process.env.PAYSTACK_INITIATION_ENABLED = originalPaystackInitiationEnabled
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = originalPaystackAllowFallback
        process.env.HUBTEL_SECRET_KEY = originalHubtelSecret
        process.env.HUBTEL_API_KEY = originalHubtelApiKey
        global.fetch = originalFetch
    })

    test('returns the safe Paystack initiation response shape', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                authorization_url: 'https://checkout.paystack.com/paystack-init-ref-1',
                access_code: 'access-paystack-init-ref-1',
                reference: 'paystack-init-ref-1',
            },
        }))

        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-1' },
            reference: 'paystack-init-ref-1',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'Payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-init-ref-1',
            amount: '125.50',
            currency: 'GHS',
            status: PAYMENT_PROCESSING_STATUS,
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            paymentUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            actionTaken: null,
        })
        expect(result.providerInitResponse).toBeUndefined()
        expect(stores.Payment[0].providerInitResponse).toEqual({
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerStatus: 'initialized',
            providerReference: 'paystack-init-ref-1',
            providerEnvironment: 'test',
            externalTransactionId: 'paystack-init-ref-1',
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            paymentUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            metadata: {
                amountConvention: {
                    internal: {
                        amount: '125.50',
                        unit: 'major',
                    },
                    provider: {
                        amount: '12550',
                        unit: 'subunit',
                    },
                    currencyCode: 'GHS',
                },
                initialization: {
                    endpoint: '/transaction/initialize',
                },
            },
        })
    })

    test('falls back to PROCESSING in the public initiation DTO when the transient payment object omits status', () => {
        const result = buildPublicRentPaymentResponse({
            payment: {
                id: 'Payment-1',
                provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
                providerReference: 'paystack-init-ref-1',
                amount: '125.50',
                currencyCode: 'GHS',
                status: null,
            },
            initiation: {
                status: 'init',
                authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
                paymentUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            },
        })

        expect(result.status).toBe(PAYMENT_PROCESSING_STATUS)
        expect(result.authorizationUrl).toBe('https://checkout.paystack.com/paystack-init-ref-1')
        expect(result.paymentUrl).toBe('https://checkout.paystack.com/paystack-init-ref-1')
    })

    test('returns duplicate_noop when the public initiation wrapper reuses an existing pending payment', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-duplicate',
                    access_code: 'access-paystack-init-ref-duplicate',
                    reference: 'paystack-init-ref-duplicate',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-duplicate-fresh',
                    access_code: 'access-paystack-init-ref-duplicate-fresh',
                    reference: 'paystack-init-ref-duplicate',
                },
            }))

        await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-1' },
            reference: 'paystack-init-ref-duplicate',
        })
        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-1' },
            reference: 'paystack-init-ref-duplicate',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'Payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-init-ref-duplicate',
            amount: '125.50',
            currency: 'GHS',
            status: PAYMENT_PROCESSING_STATUS,
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-duplicate',
            paymentUrl: 'https://checkout.paystack.com/paystack-init-ref-duplicate',
            actionTaken: 'duplicate_noop',
        })
    })

    test('hides stale checkout links when the existing pending payment is still uncertain after verification retry', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        addPendingPayment({
            providerReference: 'paystack-stale-ref-1',
            externalTransactionId: 'paystack-stale-ref-1',
            occupancy: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
            providerInitResponse: {
                authorizationUrl: 'https://checkout.paystack.com/paystack-stale-ref-1',
                paymentUrl: 'https://checkout.paystack.com/paystack-stale-ref-1',
            },
        })
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-stale-ref-1-fresh',
                    access_code: 'access-paystack-stale-ref-1-fresh',
                    reference: 'paystack-stale-ref-1',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    status: 'pending',
                    reference: 'paystack-stale-ref-1',
                },
            }))

        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            amount: '150',
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-stale-1' },
            reference: 'paystack-stale-ref-1',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-stale-ref-1',
            amount: '150',
            currency: 'GHS',
            status: PAYMENT_PROCESSING_STATUS,
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: 'pending_noop',
        })
        expect(result.providerInitResponse).toBeUndefined()
        expect(result.verification).toBeUndefined()
    })

    test('creates a new initiation when stale pending payment verification fails', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        addPendingPayment({
            providerReference: 'paystack-stale-ref-2',
            externalTransactionId: 'paystack-stale-ref-2',
            occupancy: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
            providerInitResponse: {
                authorizationUrl: 'https://checkout.paystack.com/paystack-stale-ref-2',
                paymentUrl: 'https://checkout.paystack.com/paystack-stale-ref-2',
            },
        })
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-stale-ref-2-fresh',
                    access_code: 'access-paystack-stale-ref-2-fresh',
                    reference: 'paystack-stale-ref-2',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    status: 'failed',
                    reference: 'paystack-stale-ref-2',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-recovered-ref-2',
                    access_code: 'access-paystack-recovered-ref-2',
                    reference: 'paystack-recovered-ref-2',
                },
            }))

        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            amount: '150',
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-stale-2' },
            reference: 'paystack-stale-ref-2',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'Payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-recovered-ref-2',
            amount: '150',
            currency: 'GHS',
            status: PAYMENT_PROCESSING_STATUS,
            authorizationUrl: 'https://checkout.paystack.com/paystack-recovered-ref-2',
            paymentUrl: 'https://checkout.paystack.com/paystack-recovered-ref-2',
            actionTaken: 'recovered_retry',
        })
        expect(stores.Payment).toHaveLength(2)
        expect(stores.Payment[0].status).toBe(PAYMENT_ERROR_STATUS)
        expect(result.providerInitResponse).toBeUndefined()
    })

    test('returns confirmed when verification retry resolves an uncertain pending payment during initiation', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        addRentCharge({ amount: '150' })
        addPendingPayment({
            occupancy: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
            providerInitResponse: {
                authorizationUrl: 'https://checkout.paystack.com/paystack-ref-1',
                paymentUrl: 'https://checkout.paystack.com/paystack-ref-1',
            },
        })
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-ref-1-fresh',
                    access_code: 'access-paystack-ref-1-fresh',
                    reference: 'paystack-ref-1',
                },
            }))
            .mockResolvedValueOnce(createJsonResponse({
                status: true,
                data: {
                    status: 'success',
                    amount: '15000',
                    currency: 'GHS',
                    paid_at: '2026-05-05T00:00:00.000Z',
                    reference: 'paystack-ref-1',
                },
            }))

        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            amount: '150',
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-stale-3' },
            reference: 'paystack-ref-1',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-ref-1',
            amount: '150',
            currency: 'GHS',
            status: PAYMENT_DONE_STATUS,
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: 'confirmed',
        })
        expect(result.confirmation).toBeUndefined()
        expect(result.verification).toBeUndefined()
    })

    test('returns the safe Hubtel initiation response shape', async () => {
        process.env.HUBTEL_SECRET_KEY = 'hubtel_test_secret'

        const result = await initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            occupancy: { id: 'occupancy-1' },
            tenant: null,
            providerCode: RENT_PAYMENT_PROVIDER_HUBTEL,
            paymentContext: { id: 'payment-context-2' },
            reference: 'hubtel-init-ref-1',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'Payment-1',
            provider: RENT_PAYMENT_PROVIDER_HUBTEL,
            providerReference: 'hubtel-init-ref-1',
            amount: '125.50',
            currency: 'GHS',
            status: PAYMENT_PROCESSING_STATUS,
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: null,
        })
    })

    test('rejects manual provider initiation through the public wrapper', async () => {
        await expect(initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            providerCode: RENT_PAYMENT_PROVIDER_MANUAL,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_ONLINE',
            provider: RENT_PAYMENT_PROVIDER_MANUAL,
        })
    })

    test('rejects unknown provider initiation through the public wrapper', async () => {
        await expect(initiateRentPaymentPublic({}, {
            ...baseInitiationData,
            providerCode: 'unknown-provider',
        })).rejects.toBeInstanceOf(UnknownPaymentProviderError)
    })

    test('returns the safe verification response shape', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        addRentCharge({ amount: '150' })
        addPendingPayment()
        const fetch = jest.fn().mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                status: 'success',
                amount: '15000',
                currency: 'GHS',
                paid_at: '2026-05-05T00:00:00.000Z',
                reference: 'paystack-ref-1',
            },
        }))

        const result = await verifyPendingPaymentPublic({}, {
            dv: 1,
            sender,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-ref-1',
        }, { fetch })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-ref-1',
            amount: '150',
            currency: 'GHS',
            status: PAYMENT_DONE_STATUS,
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: 'confirmed',
        })
        expect(result.verification).toBeUndefined()
        expect(result.confirmation).toBeUndefined()
    })

    test('returns the safe webhook ingress response shape', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        addRentCharge({ amount: '150' })
        addPendingPayment()

        const rawBody = JSON.stringify({
            event: 'charge.success',
            data: {
                status: 'success',
                reference: 'paystack-ref-1',
                domain: 'live',
            },
        })
        const signature = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(rawBody)
            .digest('hex')

        const result = await handleProviderWebhookRequestPublic({}, {
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            parsedPayload: JSON.parse(rawBody),
            rawBody,
            headers: {
                'X-Paystack-Signature': signature,
            },
            mode: 'production',
        })

        expectOnlyPublicFields(result)
        expect(result).toEqual({
            paymentId: 'payment-1',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-ref-1',
            amount: '150',
            currency: 'GHS',
            status: PAYMENT_DONE_STATUS,
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: 'confirmed',
        })
        expect(result.metadata).toBeUndefined()
        expect(result.webhook).toBeUndefined()
    })
})
