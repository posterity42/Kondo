const crypto = require('crypto')

const { RENT_PAYMENT_PROVIDER_PAYSTACK } = require('@condo/domains/acquiring/constants/rentPayment')
const {
    PAYMENT_DONE_STATUS,
    PAYMENT_INIT_STATUS,
    PAYMENT_PROCESSING_STATUS,
} = require('@condo/domains/acquiring/constants/payment')

const { PaymentProvider } = require('./PaymentProvider')
const {
    convertMajorAmountToPaystackSubunits,
    createPaystackVerificationClient,
    DEFAULT_PAYSTACK_API_URL,
    getVerificationOutcome,
    normalizeCurrencyCode,
} = require('./PaystackVerificationClient')
const {
    PaymentProviderConfigurationError,
    PaymentProviderRequestError,
    PaymentProviderResponseError,
    PaymentProviderValidationError,
} = require('./paymentProviderErrors')

const INITIALIZE_TRANSACTION_OPERATION = 'initializeTransaction'

function resolveStrictBooleanOption (value) {
    if (value === true || value === false) return value
    if (value === null || value === undefined) return false

    return value === 'true'
}

function normalizeText (value) {
    if (value === null || value === undefined) return null

    const normalizedValue = String(value).trim()

    return normalizedValue || null
}

function resolveFirstDefined (...values) {
    for (const value of values) {
        if (value !== undefined) return value
    }

    return undefined
}

function resolveFetch (fetchImpl) {
    if (typeof fetchImpl === 'function') return fetchImpl
    if (typeof global.fetch === 'function') return global.fetch.bind(global)

    throw new PaymentProviderConfigurationError(
        RENT_PAYMENT_PROVIDER_PAYSTACK,
        'paystack initialization requires a fetch implementation'
    )
}

class PaystackPaymentProvider extends PaymentProvider {
    get provider () {
        return RENT_PAYMENT_PROVIDER_PAYSTACK
    }

    isConfigured () {
        return Boolean(this.getSecretKey() && this.getIsEnabled())
    }

    isInitializationConfigured () {
        return Boolean(this.getSecretKey() && this.getIsEnabled() && this.getInitiationEnabled())
    }

    getStatusMap () {
        return {
            ...super.getStatusMap(),
            abandoned: PAYMENT_PROCESSING_STATUS,
            charge_success: PAYMENT_DONE_STATUS,
            ongoing: PAYMENT_PROCESSING_STATUS,
        }
    }

    getVerificationOutcome (providerStatus) {
        return getVerificationOutcome(providerStatus)
    }

    resolveProviderStatus (payload = {}) {
        const nestedPayload = payload && payload.data && typeof payload.data === 'object' ? payload.data : null
        const event = payload && payload.event ? String(payload.event).trim().toLowerCase() : null
        const providerStatus = payload.providerStatus ||
            payload.status ||
            (nestedPayload && nestedPayload.status)

        if (providerStatus) return String(providerStatus)
        if (event === 'charge.success') return 'success'

        return null
    }

    mapProviderReference (payload = {}) {
        const nestedPayload = payload && payload.data && typeof payload.data === 'object' ? payload.data : null
        const paystackReference = payload.reference ||
            (nestedPayload && (nestedPayload.reference || nestedPayload.gateway_response))

        return paystackReference ? String(paystackReference) : super.mapProviderReference(payload)
    }

    getSecretKey () {
        return this.options.secretKey ||
            this.options.paystackSecretKey ||
            (this.options.credentials && this.options.credentials.secretKey) ||
            null
    }

    getWebhookSecret () {
        return this.options.webhookSecret ||
            this.options.paystackWebhookSecret ||
            (this.options.credentials && this.options.credentials.webhookSecret) ||
            this.getSecretKey() ||
            null
    }

    getPublicKey () {
        return this.options.publicKey ||
            this.options.paystackPublicKey ||
            (this.options.credentials && this.options.credentials.publicKey) ||
            null
    }

    getCurrencyCode () {
        return normalizeCurrencyCode(
            this.options.currency ||
            this.options.currencyCode ||
            this.options.paystackCurrency ||
            (this.options.credentials && this.options.credentials.currency) ||
            'GHS'
        )
    }

    getIsEnabled () {
        const resolvedValue = resolveFirstDefined(
            this.options.isEnabled,
            this.options.paystackIsEnabled,
            this.options.credentials && this.options.credentials.isEnabled,
        )

        if (resolvedValue === undefined) return true

        return resolveStrictBooleanOption(resolvedValue)
    }

    getInitiationEnabled () {
        return resolveStrictBooleanOption(
            resolveFirstDefined(
                this.options.initiationEnabled,
                this.options.paystackInitiationEnabled,
                this.options.credentials && this.options.credentials.initiationEnabled,
                this.options.credentials && this.options.credentials.paystackInitiationEnabled,
            )
        )
    }

    getVerificationEnabled () {
        return resolveStrictBooleanOption(
            resolveFirstDefined(
                this.options.verificationEnabled,
                this.options.paystackVerificationEnabled,
                this.options.credentials && this.options.credentials.verificationEnabled,
                true
            )
        )
    }

    getWebhookEnabled () {
        return resolveStrictBooleanOption(
            resolveFirstDefined(
                this.options.webhookEnabled,
                this.options.paystackWebhookEnabled,
                this.options.credentials && this.options.credentials.webhookEnabled,
                true
            )
        )
    }

    getBaseUrl () {
        return this.options.baseUrl ||
            this.options.paystackBaseUrl ||
            DEFAULT_PAYSTACK_API_URL
    }

    getCallbackUrl () {
        return normalizeText(
            this.options.callbackUrl ||
            this.options.paystackCallbackUrl ||
            (this.options.credentials && (
                this.options.credentials.callbackUrl ||
                this.options.credentials.paystackCallbackUrl
            )) ||
            null
        )
    }

    getWebhookSignatureHeader (requestMetadata = {}) {
        if (!requestMetadata || typeof requestMetadata !== 'object') return null

        const headers = requestMetadata.headers && typeof requestMetadata.headers === 'object'
            ? requestMetadata.headers
            : requestMetadata

        return headers['x-paystack-signature'] ||
            headers['X-Paystack-Signature'] ||
            null
    }

    getWebhookRawBody (payload, requestMetadata = {}) {
        if (requestMetadata && Buffer.isBuffer(requestMetadata.rawBody)) return requestMetadata.rawBody
        if (requestMetadata && typeof requestMetadata.rawBody === 'string') return requestMetadata.rawBody
        if (requestMetadata && Buffer.isBuffer(requestMetadata.body)) return requestMetadata.body
        if (requestMetadata && typeof requestMetadata.body === 'string') return requestMetadata.body
        if (typeof payload === 'string' || Buffer.isBuffer(payload)) return payload

        return null
    }

    async verifyWebhookSignature (payload, requestMetadata = {}) {
        const webhookSecret = this.getWebhookSecret()
        const signature = this.getWebhookSignatureHeader(requestMetadata)
        const rawBody = this.getWebhookRawBody(payload, requestMetadata)

        if (!this.getIsEnabled() || !this.getWebhookEnabled()) {
            return {
                signatureVerified: false,
                signatureVerificationRequired: true,
                signatureVerificationReason: 'Paystack webhook handling is disabled for this credential',
            }
        }

        if (!webhookSecret) {
            return {
                signatureVerified: false,
                signatureVerificationRequired: true,
                signatureVerificationReason: 'Paystack webhook signature verification secret is not configured',
            }
        }

        if (!signature) {
            return {
                signatureVerified: false,
                signatureVerificationRequired: true,
                signatureVerificationReason: 'Paystack signature header is missing',
            }
        }

        if (!rawBody) {
            return {
                signatureVerified: false,
                signatureVerificationRequired: true,
                signatureVerificationReason: 'Paystack webhook raw body is unavailable for signature verification',
            }
        }

        const digest = crypto
            .createHmac('sha512', webhookSecret)
            .update(rawBody)
            .digest('hex')
        const normalizedSignature = String(signature).trim().toLowerCase()

        if (digest.length !== normalizedSignature.length) {
            return {
                signatureVerified: false,
                signatureVerificationRequired: true,
                signatureVerificationReason: 'Paystack signature does not match the webhook payload',
            }
        }

        const matches = crypto.timingSafeEqual(
            Buffer.from(digest, 'utf8'),
            Buffer.from(normalizedSignature, 'utf8')
        )

        return {
            signatureVerified: matches,
            signatureVerificationRequired: true,
            signatureVerificationReason: matches
                ? 'Paystack signature verified successfully'
                : 'Paystack signature does not match the webhook payload',
        }
    }

    validatePaymentData (paymentData = {}) {
        const amount = paymentData.amount
        const currency = paymentData.currency || paymentData.currencyCode
        const payer = paymentData.payer && typeof paymentData.payer === 'object' ? paymentData.payer : {}
        const payerEmail = payer.email || paymentData.payerEmail || paymentData.email
        const payerPhone = payer.phone || paymentData.payerPhone || paymentData.phone
        const organization = paymentData.organization
        const payment = paymentData.payment
        const context = paymentData.context
        const hasOrganization = Boolean(
            organization && (organization.id || typeof organization === 'string')
        )
        const hasPaymentContext = Boolean(
            (payment && (payment.id || typeof payment === 'string')) ||
            (context && (context.id || typeof context === 'string'))
        )

        if (amount === null || amount === undefined || String(amount).trim() === '') {
            throw new PaymentProviderValidationError(this.provider, 'amount', 'Paystack payment initialization requires amount')
        }
        if (!currency || !String(currency).trim()) {
            throw new PaymentProviderValidationError(this.provider, 'currency', 'Paystack payment initialization requires currency')
        }
        if (!payerEmail && !payerPhone) {
            throw new PaymentProviderValidationError(this.provider, 'payer', 'Paystack payment initialization requires payer email or phone')
        }
        if (!hasOrganization && !hasPaymentContext) {
            throw new PaymentProviderValidationError(this.provider, 'context', 'Paystack payment initialization requires organization or payment context')
        }
    }

    getPayerEmail (paymentData = {}) {
        const payer = paymentData.payer && typeof paymentData.payer === 'object' ? paymentData.payer : {}

        return normalizeText(payer.email || paymentData.payerEmail || paymentData.email)
    }

    getPayerPhone (paymentData = {}) {
        const payer = paymentData.payer && typeof paymentData.payer === 'object' ? paymentData.payer : {}

        return normalizeText(payer.phone || paymentData.payerPhone || paymentData.phone)
    }

    buildInitializationRequestBody (paymentData = {}) {
        const payerEmail = this.getPayerEmail(paymentData)
        const payerPhone = this.getPayerPhone(paymentData)

        if (!payerEmail) {
            throw new PaymentProviderValidationError(
                this.provider,
                'payer.email',
                'Paystack payment initialization requires payer email'
            )
        }

        const requestBody = {
            email: payerEmail,
            amount: convertMajorAmountToPaystackSubunits(
                paymentData.amount,
                paymentData.currency || paymentData.currencyCode || this.getCurrencyCode()
            ),
            currency: normalizeCurrencyCode(
                paymentData.currency || paymentData.currencyCode || this.getCurrencyCode()
            ),
        }
        const providerReference = normalizeText(this.mapProviderReference(paymentData))
        const callbackUrl = this.getCallbackUrl()

        if (providerReference) {
            requestBody.reference = providerReference
        }
        if (callbackUrl) {
            requestBody.callback_url = callbackUrl
        }
        if (payerPhone) {
            requestBody.metadata = JSON.stringify({
                payerPhone,
            })
        }

        return requestBody
    }

    async initializePayment (paymentData = {}) {
        if (!this.getSecretKey()) {
            throw new PaymentProviderConfigurationError(this.provider)
        }
        if (!this.getIsEnabled()) {
            throw new PaymentProviderConfigurationError(
                this.provider,
                'paystack credential is disabled'
            )
        }
        if (!this.getInitiationEnabled()) {
            throw new PaymentProviderConfigurationError(
                this.provider,
                'paystack payment initiation is disabled'
            )
        }

        this.validatePaymentData(paymentData)
        const request = resolveFetch(this.options.fetch)
        const requestBody = this.buildInitializationRequestBody(paymentData)
        const url = `${String(this.getBaseUrl()).replace(/\/$/, '')}/transaction/initialize`

        let response
        try {
            response = await request(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${String(this.getSecretKey()).trim()}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            })
        } catch (error) {
            throw new PaymentProviderRequestError(
                this.provider,
                INITIALIZE_TRANSACTION_OPERATION,
                'Paystack initialization request failed',
                { cause: error }
            )
        }

        let payload
        try {
            payload = await response.json()
        } catch (error) {
            throw new PaymentProviderResponseError(
                this.provider,
                INITIALIZE_TRANSACTION_OPERATION,
                'Paystack initialization response is malformed: invalid JSON'
            )
        }

        if (!response.ok) {
            throw new PaymentProviderRequestError(
                this.provider,
                INITIALIZE_TRANSACTION_OPERATION,
                `Paystack initialization request failed with status ${response.status}`
            )
        }

        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.data || typeof payload.data !== 'object') {
            throw new PaymentProviderResponseError(
                this.provider,
                INITIALIZE_TRANSACTION_OPERATION,
                'Paystack initialization response is malformed: missing data payload'
            )
        }

        const authorizationUrl = normalizeText(payload.data.authorization_url)
        const paymentUrl = normalizeText(payload.data.authorization_url)
        const providerReference = normalizeText(payload.data.reference) || normalizeText(requestBody.reference)

        if (!authorizationUrl || !providerReference) {
            throw new PaymentProviderResponseError(
                this.provider,
                INITIALIZE_TRANSACTION_OPERATION,
                'Paystack initialization response is malformed: missing required transaction fields'
            )
        }

        return {
            provider: this.provider,
            status: PAYMENT_INIT_STATUS,
            providerStatus: 'initialized',
            providerReference,
            authorizationUrl,
            paymentUrl,
            externalTransactionId: providerReference,
            metadata: {
                amountConvention: {
                    internal: {
                        amount: String(paymentData.amount),
                        unit: 'major',
                    },
                    provider: {
                        amount: requestBody.amount,
                        unit: 'subunit',
                    },
                    currencyCode: requestBody.currency,
                },
                initialization: {
                    endpoint: '/transaction/initialize',
                },
            },
        }
    }

    async verifyPayment (paymentData = {}) {
        if (!this.getSecretKey()) {
            throw new PaymentProviderConfigurationError(this.provider)
        }
        if (!this.getIsEnabled()) {
            throw new PaymentProviderConfigurationError(
                this.provider,
                'paystack credential is disabled'
            )
        }
        if (!this.getVerificationEnabled()) {
            throw new PaymentProviderConfigurationError(
                this.provider,
                'paystack payment verification is disabled'
            )
        }

        const client = createPaystackVerificationClient(this.options)
        const providerReference = paymentData.providerReference || this.mapProviderReference(paymentData)

        return client.verifyTransaction({
            providerReference,
            secretKey: this.getSecretKey(),
            paymentMethod: paymentData.paymentMethod,
            confirmedAt: paymentData.confirmedAt,
            paymentData,
        })
    }

    async handleWebhook (payload, requestMetadata = {}) {
        if (!this.getIsEnabled() || !this.getWebhookEnabled()) {
            return this.buildWebhookResponse({
                acknowledged: true,
                processed: false,
                payload,
                metadata: {
                    disabled: true,
                },
            })
        }

        const providerStatus = this.resolveProviderStatus(payload)
        const outcome = this.getVerificationOutcome(providerStatus)
        const signatureMetadata = await this.resolveWebhookSignatureMetadata(payload, requestMetadata)

        return this.buildWebhookResponse({
            acknowledged: true,
            processed: false,
            payload,
            providerStatus,
            status: outcome.status,
            internalStatus: outcome.internalStatus,
            metadata: {
                event: payload && payload.event ? payload.event : null,
                internalStatus: outcome.internalStatus,
                ...(outcome.rationale ? { rationale: outcome.rationale } : {}),
                amountConvention: {
                    internalUnit: 'major',
                    providerUnit: 'subunit',
                    providerCurrency: normalizeCurrencyCode(
                        payload && payload.data && payload.data.currency
                            ? payload.data.currency
                            : payload && payload.data && payload.data.currencyCode
                                ? payload.data.currencyCode
                                : null
                    ),
                },
                stub: true,
                ...signatureMetadata,
            },
        })
    }
}

module.exports = {
    PaymentProviderConfigurationError,
    PaymentProviderRequestError,
    PaymentProviderResponseError,
    PaymentProviderValidationError,
    PaystackPaymentProvider,
}
