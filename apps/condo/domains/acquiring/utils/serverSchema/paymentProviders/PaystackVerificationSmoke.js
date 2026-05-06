const get = require('lodash/get')

const { RENT_PAYMENT_PROVIDER_PAYSTACK } = require('@condo/domains/acquiring/constants/rentPayment')

const { PaystackPaymentProvider } = require('./PaystackPaymentProvider')

function normalizeOptionalText (value) {
    if (value === null || value === undefined) return null

    const normalized = String(value).trim()
    return normalized || null
}

function getPaystackVerificationSmokeConfig (env = process.env) {
    return {
        provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        secretKey: normalizeOptionalText(env.PAYSTACK_SECRET_KEY),
        providerReference: normalizeOptionalText(env.PAYSTACK_SMOKE_REFERENCE),
        baseUrl: normalizeOptionalText(env.PAYSTACK_API_URL),
        paymentMethod: normalizeOptionalText(env.PAYSTACK_SMOKE_PAYMENT_METHOD),
    }
}

function getPaystackVerificationSmokeSkipReason (config = {}) {
    if (!config.secretKey) return 'PAYSTACK_SECRET_KEY is not configured'
    if (!config.providerReference) return 'PAYSTACK_SMOKE_REFERENCE is not configured'

    return null
}

function buildPaystackVerificationSmokeSkipResult (config = {}) {
    return {
        skipped: true,
        provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        reason: getPaystackVerificationSmokeSkipReason(config),
        configuration: {
            secretKeyConfigured: Boolean(config.secretKey),
            providerReferenceConfigured: Boolean(config.providerReference),
            baseUrlConfigured: Boolean(config.baseUrl),
            paymentMethodConfigured: Boolean(config.paymentMethod),
        },
    }
}

function sanitizePaystackVerificationResult (verificationResult = {}, config = {}) {
    return {
        skipped: false,
        provider: verificationResult.provider || RENT_PAYMENT_PROVIDER_PAYSTACK,
        providerReference: config.providerReference || null,
        externalTransactionId: verificationResult.externalTransactionId || null,
        paymentMethod: verificationResult.paymentMethod || config.paymentMethod || null,
        confirmed: verificationResult.confirmed === true,
        confirmedAt: verificationResult.confirmedAt || null,
        status: verificationResult.status || null,
        internalStatus: verificationResult.internalStatus || null,
        providerStatus: verificationResult.providerStatus || null,
        amount: verificationResult.amount || null,
        currencyCode: verificationResult.currencyCode || null,
        amountConvention: {
            internal: {
                amount: get(verificationResult, ['metadata', 'amountConvention', 'internal', 'amount']) || verificationResult.amount || null,
                unit: get(verificationResult, ['metadata', 'amountConvention', 'internal', 'unit']) || 'major',
            },
            provider: {
                amount: get(verificationResult, ['metadata', 'amountConvention', 'provider', 'amount']) || null,
                unit: get(verificationResult, ['metadata', 'amountConvention', 'provider', 'unit']) || 'subunit',
            },
            currencyCode: get(verificationResult, ['metadata', 'amountConvention', 'currencyCode']) || verificationResult.currencyCode || null,
        },
        verification: {
            endpoint: get(verificationResult, ['metadata', 'verification', 'endpoint']) || null,
        },
    }
}

async function runPaystackVerificationSmoke (options = {}) {
    const {
        env = process.env,
        fetch,
        providerReference = null,
    } = options
    const config = getPaystackVerificationSmokeConfig(env)
    if (providerReference) config.providerReference = normalizeOptionalText(providerReference)

    const skipReason = getPaystackVerificationSmokeSkipReason(config)
    if (skipReason) {
        return buildPaystackVerificationSmokeSkipResult(config)
    }

    const provider = new PaystackPaymentProvider({
        secretKey: config.secretKey,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        ...(fetch ? { fetch } : {}),
    })
    const verificationResult = await provider.verifyPayment({
        providerReference: config.providerReference,
        ...(config.paymentMethod ? { paymentMethod: config.paymentMethod } : {}),
    })

    return sanitizePaystackVerificationResult(verificationResult, config)
}

module.exports = {
    buildPaystackVerificationSmokeSkipResult,
    getPaystackVerificationSmokeConfig,
    getPaystackVerificationSmokeSkipReason,
    runPaystackVerificationSmoke,
    sanitizePaystackVerificationResult,
}
