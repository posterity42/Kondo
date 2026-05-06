const { RENT_PAYMENT_PROVIDER_PAYSTACK } = require('@condo/domains/acquiring/constants/rentPayment')
const {
    buildPublicRentPaymentResponse,
    handleProviderWebhookRequest,
    ProviderWebhookHandlingError,
} = require('@condo/domains/acquiring/utils/serverSchema')

const PAYSTACK_WEBHOOK_PATH = '/api/acquiring/webhooks/paystack'
const DEFAULT_WEBHOOK_ENVIRONMENT = 'production'

function normalizeText (value) {
    if (value === null || value === undefined) return null

    const normalizedValue = String(value).trim()
    return normalizedValue || null
}

function parseBooleanFlag (value) {
    if (value === true || value === false) return value
    if (Array.isArray(value)) return parseBooleanFlag(value[0])
    if (value === null || value === undefined) return null

    const normalizedValue = String(value).trim().toLowerCase()

    if (normalizedValue === 'true') return true
    if (normalizedValue === 'false') return false

    return null
}

function parseJsonBody (rawBody) {
    if (!rawBody || rawBody.length === 0) {
        const error = new Error('Webhook body must be a valid JSON object')
        error.code = 'PAYMENT_WEBHOOK_INVALID_JSON'
        throw error
    }

    try {
        return JSON.parse(String(rawBody))
    } catch (error) {
        error.code = 'PAYMENT_WEBHOOK_INVALID_JSON'
        throw error
    }
}

function buildSafeWebhookResponseBody (result = {}) {
    return {
        ok: result.processed === true || result.idempotent === true,
        code: normalizeText(result.code),
        outcome: normalizeText(result.outcome),
        ...buildPublicRentPaymentResponse(result),
    }
}

function buildSafeWebhookErrorBody ({
    code,
    outcome = 'rejected',
    provider = RENT_PAYMENT_PROVIDER_PAYSTACK,
    providerReference = null,
    message = null,
}) {
    return {
        ok: false,
        code,
        outcome,
        paymentId: null,
        provider,
        providerReference,
        amount: null,
        currency: null,
        status: null,
        authorizationUrl: null,
        paymentUrl: null,
        actionTaken: 'rejected',
        ...(message ? { message } : {}),
    }
}

function resolveWebhookHttpStatus (result = {}) {
    switch (result.code) {
    case 'PAYMENT_WEBHOOK_CONFIRMED':
    case 'PAYMENT_WEBHOOK_ALREADY_CONFIRMED':
    case 'PAYMENT_WEBHOOK_MARKED_FAILED':
    case 'PAYMENT_WEBHOOK_ALREADY_FAILED':
        return 200
    case 'PAYMENT_WEBHOOK_PENDING':
    case 'PAYMENT_WEBHOOK_PENDING_ERROR_NOOP':
    case 'PAYMENT_WEBHOOK_STATUS_UNCHANGED':
        return 202
    case 'PAYMENT_WEBHOOK_SIGNATURE_REJECTED':
        return 401
    case 'PAYMENT_WEBHOOK_PAYMENT_NOT_FOUND':
        return 404
    case 'PAYMENT_WEBHOOK_CONFIRMATION_REJECTED':
    case 'PAYMENT_WEBHOOK_FAILURE_REJECTED':
        return 409
    default:
        return result.processed === true ? 200 : 202
    }
}

function resolveWebhookMode (req) {
    const query = req.query || {}
    const headers = req.headers || {}
    const mode = normalizeText(
        query.mode ||
        query.environment ||
        headers['x-condo-webhook-mode'] ||
        null
    )
    const environment = mode || DEFAULT_WEBHOOK_ENVIRONMENT
    const testMode = parseBooleanFlag(query.testMode || headers['x-condo-test-mode'])
    const sandbox = parseBooleanFlag(query.sandbox || headers['x-condo-sandbox-mode'])

    return {
        mode: environment,
        environment,
        testMode: testMode === true,
        sandbox: sandbox === true,
    }
}

function resolveProviderReferenceFromPayload (payload) {
    if (!payload || typeof payload !== 'object') return null

    const nestedPayload = payload.data && typeof payload.data === 'object' ? payload.data : null
    const providerReference = payload.reference ||
        (nestedPayload && nestedPayload.reference) ||
        null

    return normalizeText(providerReference)
}

function resolveErrorHttpStatus (error) {
    const errorCode = error && (error.code || error.extensions && error.extensions.type)

    switch (errorCode) {
    case 'PAYMENT_WEBHOOK_INVALID_JSON':
        return 400
    case 'PAYMENT_AMOUNT_MISMATCH':
    case 'PAYMENT_CURRENCY_MISMATCH':
        return 422
    case 'PAYMENT_WEBHOOK_LOOKUP_AMBIGUOUS':
        return 409
    case 'PAYMENT_WEBHOOK_PROVIDER_NOT_CONFIGURED':
        return 503
    default:
        return 500
    }
}

function buildErrorResponseBody (error, providerReference = null) {
    const errorCode = error && (error.code || error.extensions && error.extensions.type) || 'PAYMENT_WEBHOOK_INTERNAL_ERROR'
    const outcome = errorCode === 'PAYMENT_WEBHOOK_INVALID_JSON' ? 'rejected' : 'error'
    const safeMessage = errorCode === 'PAYMENT_WEBHOOK_INTERNAL_ERROR' ? null : error.message

    return buildSafeWebhookErrorBody({
        code: errorCode,
        outcome,
        providerReference,
        message: safeMessage,
    })
}

class PaystackWebhookRouter {
    constructor ({ keystone }) {
        this.keystone = keystone
    }

    async createContext (req, res) {
        const context = await this.keystone.createContext({ skipAccessControl: true })
        context.req = req
        context.res = res

        return context
    }

    async handleRequest (req, res, next) {
        let payload = null
        let rawBody = null

        try {
            rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''))
            payload = parseJsonBody(rawBody)

            const context = await this.createContext(req, res)
            const result = await handleProviderWebhookRequest(context, {
                providerCode: RENT_PAYMENT_PROVIDER_PAYSTACK,
                parsedPayload: payload,
                rawBody,
                headers: req.headers,
                ...resolveWebhookMode(req),
            })

            return res.status(resolveWebhookHttpStatus(result)).json(buildSafeWebhookResponseBody(result))
        } catch (error) {
            if (error instanceof ProviderWebhookHandlingError || error.code === 'PAYMENT_WEBHOOK_INVALID_JSON' || error.extensions) {
                return res
                    .status(resolveErrorHttpStatus(error))
                    .json(buildErrorResponseBody(error, resolveProviderReferenceFromPayload(payload)))
            }

            return next(error)
        }
    }
}

module.exports = {
    DEFAULT_WEBHOOK_ENVIRONMENT,
    PAYSTACK_WEBHOOK_PATH,
    PaystackWebhookRouter,
    buildSafeWebhookErrorBody,
    buildSafeWebhookResponseBody,
    resolveWebhookHttpStatus,
}
