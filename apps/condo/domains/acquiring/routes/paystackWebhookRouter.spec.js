/**
 * @jest-environment node
 */

const mockBuildPublicRentPaymentResponse = jest.fn((result = {}) => ({
    paymentId: result.payment && result.payment.id || null,
    provider: result.provider || 'paystack',
    providerReference: result.providerReference || null,
    amount: result.payment && result.payment.amount || null,
    currency: result.payment && result.payment.currencyCode || null,
    status: result.payment && result.payment.status || null,
    authorizationUrl: null,
    paymentUrl: null,
    actionTaken: result.metadata && result.metadata.actionTaken || null,
}))
const mockHandleProviderWebhookRequest = jest.fn()

jest.mock('@condo/domains/acquiring/utils/serverSchema', () => ({
    buildPublicRentPaymentResponse: (...args) => mockBuildPublicRentPaymentResponse(...args),
    handleProviderWebhookRequest: (...args) => mockHandleProviderWebhookRequest(...args),
    ProviderWebhookHandlingError: class ProviderWebhookHandlingError extends Error {
        constructor (code, message) {
            super(message)
            this.name = 'ProviderWebhookHandlingError'
            this.code = code
        }
    },
}))

const { PaystackWebhookRouter } = require('./paystackWebhookRouter')

function createMockResponse () {
    return {
        statusCode: null,
        body: null,
        status: jest.fn(function (statusCode) {
            this.statusCode = statusCode
            return this
        }),
        json: jest.fn(function (body) {
            this.body = body
            return this
        }),
    }
}

function createMockRequest (payload, overrides = {}) {
    return {
        body: Buffer.from(payload, 'utf8'),
        headers: {
            'content-type': 'application/json',
        },
        query: {},
        ...overrides,
    }
}

describe('PaystackWebhookRouter', () => {
    let keystone
    let router
    let next

    beforeEach(() => {
        jest.clearAllMocks()
        keystone = {
            createContext: jest.fn().mockResolvedValue({}),
        }
        router = new PaystackWebhookRouter({ keystone })
        next = jest.fn()
    })

    test('returns 200 for processed duplicate confirmations without exposing internals', async () => {
        mockHandleProviderWebhookRequest.mockResolvedValue({
            provider: 'paystack',
            providerReference: 'paystack-ref-1',
            processed: true,
            idempotent: true,
            code: 'PAYMENT_WEBHOOK_ALREADY_CONFIRMED',
            outcome: 'confirmed',
            metadata: {
                actionTaken: 'duplicate_noop',
            },
            payment: {
                id: 'payment-1',
                amount: '150',
                currencyCode: 'NGN',
                status: 'DONE',
            },
            webhook: {
                payload: 'should-not-leak',
            },
        })

        const req = createMockRequest(JSON.stringify({ event: 'charge.success', data: { reference: 'paystack-ref-1' } }))
        const res = createMockResponse()

        await router.handleRequest(req, res, next)

        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.body).toEqual({
            ok: true,
            code: 'PAYMENT_WEBHOOK_ALREADY_CONFIRMED',
            outcome: 'confirmed',
            paymentId: 'payment-1',
            provider: 'paystack',
            providerReference: 'paystack-ref-1',
            amount: '150',
            currency: 'NGN',
            status: 'DONE',
            authorizationUrl: null,
            paymentUrl: null,
            actionTaken: 'duplicate_noop',
        })
        expect(res.body.webhook).toBeUndefined()
        expect(res.body.metadata).toBeUndefined()
        expect(next).not.toHaveBeenCalled()
    })

    test('returns 401 for rejected signatures', async () => {
        mockHandleProviderWebhookRequest.mockResolvedValue({
            provider: 'paystack',
            providerReference: 'paystack-ref-2',
            processed: false,
            code: 'PAYMENT_WEBHOOK_SIGNATURE_REJECTED',
            outcome: 'rejected',
            payment: null,
        })

        const req = createMockRequest(JSON.stringify({ event: 'charge.success', data: { reference: 'paystack-ref-2' } }))
        const res = createMockResponse()

        await router.handleRequest(req, res, next)

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.body.code).toBe('PAYMENT_WEBHOOK_SIGNATURE_REJECTED')
        expect(res.body.ok).toBe(false)
    })

    test('returns 404 for unknown provider references', async () => {
        mockHandleProviderWebhookRequest.mockResolvedValue({
            provider: 'paystack',
            providerReference: 'missing-ref',
            processed: false,
            code: 'PAYMENT_WEBHOOK_PAYMENT_NOT_FOUND',
            outcome: 'not_found',
            payment: null,
        })

        const req = createMockRequest(JSON.stringify({ event: 'charge.success', data: { reference: 'missing-ref' } }))
        const res = createMockResponse()

        await router.handleRequest(req, res, next)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.body.code).toBe('PAYMENT_WEBHOOK_PAYMENT_NOT_FOUND')
    })

    test('returns 202 for irrelevant pending events', async () => {
        mockHandleProviderWebhookRequest.mockResolvedValue({
            provider: 'paystack',
            providerReference: 'paystack-ref-3',
            processed: true,
            noop: true,
            code: 'PAYMENT_WEBHOOK_PENDING',
            outcome: 'pending',
            metadata: {
                actionTaken: 'pending_noop',
            },
            payment: {
                id: 'payment-3',
                amount: '150',
                currencyCode: 'NGN',
                status: 'PROCESSING',
            },
        })

        const req = createMockRequest(JSON.stringify({ event: 'charge.dispute.create', data: { reference: 'paystack-ref-3' } }))
        const res = createMockResponse()

        await router.handleRequest(req, res, next)

        expect(res.status).toHaveBeenCalledWith(202)
        expect(res.body.code).toBe('PAYMENT_WEBHOOK_PENDING')
    })

    test('returns 400 for malformed JSON bodies', async () => {
        const req = createMockRequest('{not-json')
        const res = createMockResponse()

        await router.handleRequest(req, res, next)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.body).toEqual(expect.objectContaining({
            ok: false,
            code: 'PAYMENT_WEBHOOK_INVALID_JSON',
            provider: 'paystack',
            actionTaken: 'rejected',
        }))
        expect(mockHandleProviderWebhookRequest).not.toHaveBeenCalled()
    })
})
