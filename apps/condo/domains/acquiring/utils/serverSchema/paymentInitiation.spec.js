/**
 * @jest-environment node
 */

const dayjs = require('dayjs')
const { EncryptionManager } = require('@open-condo/keystone/crypto/EncryptionManager')

const paymentStore = []
const paymentProviderCredentialStore = []
const findCalls = []
const encryptionManager = new EncryptionManager()
const mockPaymentCreate = jest.fn(async (context, data) => {
    const payment = {
        id: `payment-${paymentStore.length + 1}`,
        ...flattenRelations(data),
        deletedAt: null,
    }

    paymentStore.push(payment)

    return payment
})

function flattenRelations (data) {
    const result = { ...data }

    for (const [key, value] of Object.entries(result)) {
        if (value && value.connect && value.connect.id) {
            result[key] = value.connect.id
        }
    }

    return result
}

function getRelationId (value) {
    return value && value.id ? value.id : value
}

function matchesWhere (item, where) {
    return Object.entries(where).every(([key, value]) => {
        if (key === 'deletedAt') return item.deletedAt === value
        if (value && typeof value === 'object' && value.id) return getRelationId(item[key]) === value.id
        return item[key] === value
    })
}

const mockFind = jest.fn(async (listKey, where) => {
    findCalls.push({ listKey, where })

    if (listKey === 'Payment') {
        return paymentStore.filter(item => matchesWhere(item, where))
    }

    if (listKey === 'PaymentProviderCredential') {
        return paymentProviderCredentialStore.filter(item => matchesWhere(item, where))
    }

    return []
})

jest.mock('@open-condo/keystone/schema', () => ({
    find: mockFind,
    getById: jest.fn(),
}))

jest.mock('@open-condo/codegen/generate.server.utils', () => ({
    execGqlWithoutAccess: jest.fn(),
    generateServerUtils: jest.fn((listKey) => ({
        create: listKey === 'Payment' ? mockPaymentCreate : jest.fn(),
        update: jest.fn(),
        getOne: jest.fn(),
    })),
}))

jest.mock('@condo/domains/billing/utils/serverSchema', () => ({
    calculateLedgerBalance: jest.fn(),
    reverseConfirmedRentPayment: jest.fn(),
}))

const {
    PAYMENT_INIT_STATUS,
    PAYMENT_PROCESSING_STATUS,
} = require('@condo/domains/acquiring/constants/payment')
const {
    RENT_PAYMENT_PROVIDER_HUBTEL,
    RENT_PAYMENT_PROVIDER_MANUAL,
    RENT_PAYMENT_PROVIDER_PAYSTACK,
} = require('@condo/domains/acquiring/constants/rentPayment')
const {
    initiateRentPayment,
    RentPaymentInitiationError,
} = require('./index')
const { UnknownPaymentProviderError } = require('./paymentProviders')

const BASE_CONTEXT = {}
const BASE_DATA = {
    dv: 1,
    sender: { dv: 1, fingerprint: 'test-device' },
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

function addPaymentProviderCredential (organizationId, attrs = {}) {
    const credential = {
        id: `credential-${paymentProviderCredentialStore.length + 1}`,
        organization: organizationId,
        provider: 'paystack',
        environment: 'test',
        secretKey: encryptionManager.encrypt('sk_test_org_scoped_paystack'),
        webhookSecret: null,
        currency: 'GHS',
        initiationEnabled: true,
        verificationEnabled: true,
        webhookEnabled: true,
        isEnabled: true,
        deletedAt: null,
        ...attrs,
    }

    paymentProviderCredentialStore.push(credential)

    return credential
}

function createJsonResponse (payload, overrides = {}) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(payload),
        ...overrides,
    }
}

describe('initiateRentPayment', () => {
    const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY
    const originalPaystackInitiationEnabled = process.env.PAYSTACK_INITIATION_ENABLED
    const originalPaystackAllowFallback = process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK
    const originalHubtelSecret = process.env.HUBTEL_SECRET_KEY
    const originalHubtelApiKey = process.env.HUBTEL_API_KEY
    const originalFetch = global.fetch

    beforeEach(() => {
        paymentStore.length = 0
        paymentProviderCredentialStore.length = 0
        findCalls.length = 0
        jest.clearAllMocks()
        delete process.env.PAYSTACK_SECRET_KEY
        delete process.env.PAYSTACK_INITIATION_ENABLED
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'true'
        delete process.env.HUBTEL_SECRET_KEY
        delete process.env.HUBTEL_API_KEY
        global.fetch = jest.fn()
    })

    afterAll(() => {
        process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret
        process.env.PAYSTACK_INITIATION_ENABLED = originalPaystackInitiationEnabled
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = originalPaystackAllowFallback
        process.env.HUBTEL_SECRET_KEY = originalHubtelSecret
        process.env.HUBTEL_API_KEY = originalHubtelApiKey
        global.fetch = originalFetch
    })

    test('creates a pending payment intent record for Paystack without allocations or ledger side effects', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-1',
                    access_code: 'access-paystack-init-ref-1',
                    reference: 'paystack-init-ref-1',
                },
            }),
        })

        const result = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            paymentContext: { id: 'payment-context-1' },
            reference: 'paystack-init-ref-1',
        })

        expect(result.idempotent).toBe(false)
        expect(result.providerReference).toBe('paystack-init-ref-1')
        expect(result.initiation).toMatchObject({
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            status: PAYMENT_INIT_STATUS,
            providerStatus: 'initialized',
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            paymentUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            externalTransactionId: 'paystack-init-ref-1',
            metadata: {
                initialization: {
                    endpoint: '/transaction/initialize',
                },
            },
        })
        expect(result.payment).toEqual({
            id: 'payment-1',
            dv: 1,
            sender: { dv: 1, fingerprint: 'test-device' },
            amount: '125.50',
            currencyCode: 'GHS',
            period: dayjs().startOf('month').format('YYYY-MM-DD'),
            organization: 'organization-1',
            tenant: 'tenant-1',
            paymentMethod: null,
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-init-ref-1',
            providerEnvironment: 'test',
            externalTransactionId: 'paystack-init-ref-1',
            purpose: 'Online rent payment initiation',
            recipientBic: 'PENDING',
            recipientBankAccount: 'PENDING',
            status: PAYMENT_PROCESSING_STATUS,
            providerInitResponse: {
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
            },
            deletedAt: null,
        })
        expect(result.payment.providerInitResponse.paymentData).toBeUndefined()
        expect(paymentStore).toHaveLength(1)
        expect(findCalls.some(call => call.listKey === 'PaymentAllocation')).toBe(false)
        expect(findCalls.some(call => call.listKey === 'LedgerEntry')).toBe(false)
    })

    test('prefers organization-scoped Paystack credentials over global fallback credentials', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_global_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        addPaymentProviderCredential('organization-1', {
            secretKey: encryptionManager.encrypt('sk_test_org_a_paystack'),
        })
        global.fetch.mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                authorization_url: 'https://checkout.paystack.com/org-a-ref-1',
                access_code: 'access-org-a-ref-1',
                reference: 'org-a-ref-1',
            },
        }))

        await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'org-a-ref-1',
        })

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.paystack.co/transaction/initialize',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer sk_test_org_a_paystack',
                }),
            })
        )
    })

    test('does not allow organization A to use organization B credential', async () => {
        addPaymentProviderCredential('organization-2')
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_global_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'false'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'missing-org-a-credential-ref-1',
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_CONFIGURED',
        })
    })

    test('blocks Paystack initiation when organization credential is disabled', async () => {
        addPaymentProviderCredential('organization-1', {
            initiationEnabled: false,
        })
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'false'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'disabled-org-credential-ref-1',
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_CONFIGURED',
        })
    })

    test('global env fallback works only when explicitly enabled in test mode', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_global_fallback_only'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'false'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'global-fallback-disabled-ref-1',
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_CONFIGURED',
        })

        process.env.PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK = 'true'
        global.fetch.mockResolvedValue(createJsonResponse({
            status: true,
            data: {
                authorization_url: 'https://checkout.paystack.com/global-fallback-ref-1',
                access_code: 'access-global-fallback-ref-1',
                reference: 'global-fallback-ref-1',
            },
        }))

        const result = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'global-fallback-ref-1',
        })

        expect(result.providerReference).toBe('global-fallback-ref-1')
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.paystack.co/transaction/initialize',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer sk_test_global_fallback_only',
                }),
            })
        )
    })

    test('sends paystack amounts to the provider in subunits while keeping stored payment amounts in major units', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-amount-ref-1',
                    access_code: 'access-paystack-amount-ref-1',
                    reference: 'paystack-amount-ref-1',
                },
            }),
        })

        await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            amount: '100.55',
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-amount-ref-1',
        })

        expect(paymentStore[0].amount).toBe('100.55')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
            amount: '10055',
            currency: 'GHS',
            reference: 'paystack-amount-ref-1',
        })
    })

    test('creates a pending payment intent record for Hubtel', async () => {
        process.env.HUBTEL_SECRET_KEY = 'hubtel_test_secret'

        const result = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            occupancy: { id: 'occupancy-1' },
            tenant: null,
            providerCode: RENT_PAYMENT_PROVIDER_HUBTEL,
            paymentContext: { id: 'payment-context-2' },
            reference: 'hubtel-init-ref-1',
        })

        expect(result.idempotent).toBe(false)
        expect(result.payment).toMatchObject({
            provider: RENT_PAYMENT_PROVIDER_HUBTEL,
            providerReference: 'hubtel-init-ref-1',
            externalTransactionId: 'hubtel-init-ref-1',
            occupancy: 'occupancy-1',
            status: PAYMENT_PROCESSING_STATUS,
        })
        expect(result.initiation).toMatchObject({
            provider: RENT_PAYMENT_PROVIDER_HUBTEL,
            status: PAYMENT_INIT_STATUS,
            metadata: {
                stub: true,
            },
        })
        expect(findCalls.some(call => call.listKey === 'PaymentAllocation')).toBe(false)
        expect(findCalls.some(call => call.listKey === 'LedgerEntry')).toBe(false)
    })

    test('returns the existing pending intent idempotently for duplicate provider references', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-1',
                    access_code: 'access-paystack-init-ref-1',
                    reference: 'paystack-init-ref-1',
                },
            }),
        })

        const firstResult = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-ref-1',
        })
        const secondResult = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-ref-1',
        })

        expect(firstResult.idempotent).toBe(false)
        expect(secondResult.idempotent).toBe(true)
        expect(secondResult.payment).toEqual(firstResult.payment)
        expect(mockPaymentCreate).toHaveBeenCalledTimes(1)
        expect(paymentStore).toHaveLength(1)
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('treats providerReference unique-constraint races as idempotent retries when payload matches', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        const duplicateConstraintError = new Error('duplicate key value violates unique constraint "payment_unique_provider_reference_per_scope"')
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-race',
                    access_code: 'access-paystack-init-ref-race',
                    reference: 'paystack-init-ref-race',
                },
            }),
        })

        mockPaymentCreate.mockImplementationOnce(async () => {
            paymentStore.push({
                id: 'payment-race-1',
                dv: 1,
                sender: { dv: 1, fingerprint: 'test-device' },
                amount: '125.50',
                currencyCode: 'GHS',
                organization: 'organization-1',
                tenant: 'tenant-1',
                paymentMethod: null,
                provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
                providerReference: 'paystack-init-ref-race',
                externalTransactionId: 'paystack-init-ref-race',
                purpose: 'Online rent payment initiation',
                recipientBic: 'PENDING',
                recipientBankAccount: 'PENDING',
                status: PAYMENT_PROCESSING_STATUS,
                deletedAt: null,
            })

            throw duplicateConstraintError
        })

        const result = await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-ref-race',
        })

        expect(result.idempotent).toBe(true)
        expect(result.payment.id).toBe('payment-race-1')
    })

    test('rejects conflicting duplicate provider references', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
                status: true,
                data: {
                    authorization_url: 'https://checkout.paystack.com/paystack-init-ref-1',
                    access_code: 'access-paystack-init-ref-1',
                    reference: 'paystack-init-ref-1',
                },
            }),
        })

        await initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-ref-1',
        })

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            amount: '126.00',
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-ref-1',
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_DUPLICATE_PROVIDER_REFERENCE',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
            providerReference: 'paystack-init-ref-1',
            paymentId: 'payment-1',
        })
    })

    test('rejects unknown providers resolved outside the registry', async () => {
        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: 'unknown-provider',
        })).rejects.toThrow(UnknownPaymentProviderError)

        expect(paymentStore).toHaveLength(0)
    })

    test('rejects manual providers for online initiation', async () => {
        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_MANUAL,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_ONLINE',
            provider: RENT_PAYMENT_PROVIDER_MANUAL,
        })

        expect(paymentStore).toHaveLength(0)
    })

    test('rejects unconfigured online providers', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_NOT_CONFIGURED',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        })

        expect(paymentStore).toHaveLength(0)
    })

    test('sanitises paystack provider initiation failures', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'
        process.env.PAYSTACK_INITIATION_ENABLED = 'true'
        global.fetch.mockRejectedValue(new Error('connect ECONNRESET sk_test_paystack'))

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-failed-1',
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PROVIDER_REQUEST_FAILED',
            provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        })

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
            reference: 'paystack-init-failed-1',
        })).rejects.toThrow('Provider "paystack" failed to initialize online rent payment')
    })

    test('requires tenant or occupancy context', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            tenant: null,
            occupancy: null,
            providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_SUBJECT_REQUIRED',
        })

        expect(paymentStore).toHaveLength(0)
    })

    test('requires payer contact and rent or payment context', async () => {
        process.env.HUBTEL_SECRET_KEY = 'hubtel_test_secret'

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_HUBTEL,
            payerContact: null,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_PAYER_REQUIRED',
        })

        await expect(initiateRentPayment(BASE_CONTEXT, {
            ...BASE_DATA,
            providerCode: RENT_PAYMENT_PROVIDER_HUBTEL,
            rentContext: null,
            paymentContext: null,
        })).rejects.toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'RENT_PAYMENT_INITIATION_CONTEXT_REQUIRED',
        })

        expect(paymentStore).toHaveLength(0)
    })

    test('exports the typed initiation error for callers', () => {
        expect(new RentPaymentInitiationError('TEST_CODE', 'test message')).toMatchObject({
            name: 'RentPaymentInitiationError',
            code: 'TEST_CODE',
            message: 'test message',
        })
    })
})
