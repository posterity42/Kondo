const { find } = require('@open-condo/keystone/schema')

const { EncryptionManager } = require('@open-condo/keystone/crypto/EncryptionManager')

const { RENT_PAYMENT_PROVIDER_PAYSTACK } = require('@condo/domains/acquiring/constants/rentPayment')

const encryptionManager = new EncryptionManager()
const PAYSTACK_GLOBAL_FALLBACK_ENV = 'PAYSTACK_ALLOW_GLOBAL_CREDENTIAL_FALLBACK'

function normalizeText (value) {
    if (value === null || value === undefined) return null

    const normalizedValue = String(value).trim()

    return normalizedValue || null
}

function normalizeBoolean (value, defaultValue = false) {
    if (value === true || value === false) return value
    if (value === null || value === undefined) return defaultValue

    return String(value).trim().toLowerCase() === 'true'
}

function getRelationId (value) {
    return value && value.id ? value.id : value || null
}

function decryptOptionalSecret (value) {
    if (!value) return null

    return encryptionManager.decrypt(value)
}

function resolveCredentialEnvironment (data = {}, options = {}) {
    const explicitEnvironment = normalizeText(
        data.providerEnvironment ||
        data.environment ||
        data.mode ||
        options.environment ||
        null
    )

    if (explicitEnvironment === 'test') return 'test'
    if (explicitEnvironment === 'live' || explicitEnvironment === 'production') return 'live'
    if (data.testMode === true || data.sandbox === true) return 'test'
    if (process.env.NODE_ENV === 'test') return 'test'

    return 'live'
}

function isPaystackGlobalFallbackAllowed (options = {}) {
    const explicitFallback = normalizeBoolean(
        options.allowGlobalFallback,
        normalizeBoolean(process.env[PAYSTACK_GLOBAL_FALLBACK_ENV], false)
    )
    const runtimeEnvironment = normalizeText(options.runtimeEnvironment || process.env.NODE_ENV || 'development') || 'development'

    return explicitFallback && ['development', 'test'].includes(runtimeEnvironment)
}

async function findOrganizationProviderCredential ({ organizationId, provider, environment }) {
    if (!organizationId || !provider || !environment) return null

    const credentials = await find('PaymentProviderCredential', {
        organization: { id: organizationId },
        provider,
        environment,
        deletedAt: null,
    })

    if (credentials.length === 0) return null
    if (credentials.length === 1) return credentials[0]

    return false
}

function normalizeCredentialRecord (credential) {
    if (!credential) return null

    return {
        id: credential.id,
        provider: normalizeText(credential.provider),
        environment: normalizeText(credential.environment),
        publicKey: normalizeText(credential.publicKey),
        secretKey: decryptOptionalSecret(credential.secretKey),
        webhookSecret: decryptOptionalSecret(credential.webhookSecret),
        currency: normalizeText(credential.currency),
        initiationEnabled: credential.initiationEnabled !== false,
        verificationEnabled: credential.verificationEnabled !== false,
        webhookEnabled: credential.webhookEnabled !== false,
        isEnabled: credential.isEnabled !== false,
        metadata: credential.metadata && typeof credential.metadata === 'object' ? credential.metadata : null,
    }
}

function buildPaystackGlobalFallbackCredentials (environment) {
    const secretKey = normalizeText(process.env.PAYSTACK_SECRET_KEY)

    return {
        provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        environment,
        publicKey: normalizeText(process.env.PAYSTACK_PUBLIC_KEY),
        secretKey,
        webhookSecret: normalizeText(process.env.PAYSTACK_WEBHOOK_SECRET) || secretKey,
        currency: normalizeText(process.env.PAYSTACK_CURRENCY) || 'GHS',
        initiationEnabled: normalizeBoolean(process.env.PAYSTACK_INITIATION_ENABLED, false),
        verificationEnabled: normalizeBoolean(process.env.PAYSTACK_VERIFICATION_ENABLED, true),
        webhookEnabled: normalizeBoolean(process.env.PAYSTACK_WEBHOOK_ENABLED, true),
        isEnabled: normalizeBoolean(process.env.PAYSTACK_IS_ENABLED, true),
        metadata: null,
    }
}

async function resolvePaystackProviderCredential (data = {}, options = {}) {
    const organizationId = normalizeText(
        data.organizationId ||
        getRelationId(data.organization) ||
        getRelationId(data.payment && data.payment.organization) ||
        getRelationId(data.context && data.context.organization) ||
        null
    )
    const environment = resolveCredentialEnvironment(data, options)
    const credentialRecord = await findOrganizationProviderCredential({
        organizationId,
        provider: RENT_PAYMENT_PROVIDER_PAYSTACK,
        environment,
    })

    if (credentialRecord === false) {
        const error = new Error('Multiple provider credentials matched the same organization, provider, and environment')
        error.code = 'PAYMENT_PROVIDER_CREDENTIAL_LOOKUP_AMBIGUOUS'
        throw error
    }

    if (credentialRecord) {
        return {
            source: 'organization',
            environment,
            credentials: normalizeCredentialRecord(credentialRecord),
        }
    }

    if (!isPaystackGlobalFallbackAllowed(options)) {
        return {
            source: 'none',
            environment,
            credentials: null,
        }
    }

    return {
        source: 'global_fallback',
        environment,
        credentials: buildPaystackGlobalFallbackCredentials(environment),
    }
}

async function resolvePaymentProviderOptions (providerCode, data = {}, options = {}) {
    const baseOptions = {
        ...(options.providerOptions || {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
    }

    if (providerCode !== RENT_PAYMENT_PROVIDER_PAYSTACK) {
        return {
            providerEnvironment: null,
            providerOptions: baseOptions,
            providerCredentialSource: 'default',
        }
    }

    const paystackCredential = await resolvePaystackProviderCredential(data, options)

    return {
        providerEnvironment: paystackCredential.environment,
        providerCredentialSource: paystackCredential.source,
        providerOptions: {
            ...baseOptions,
            ...(paystackCredential.credentials ? { credentials: paystackCredential.credentials } : {}),
        },
    }
}

module.exports = {
    PAYSTACK_GLOBAL_FALLBACK_ENV,
    findOrganizationProviderCredential,
    normalizeCredentialRecord,
    resolveCredentialEnvironment,
    resolvePaymentProviderOptions,
    resolvePaystackProviderCredential,
}
