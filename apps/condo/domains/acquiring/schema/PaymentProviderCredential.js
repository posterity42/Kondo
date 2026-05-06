const { EncryptionManager } = require('@open-condo/keystone/crypto/EncryptionManager')
const { historical, versioned, uuided, tracked, softDeleted, dvAndSender, analytical } = require('@open-condo/keystone/plugins')
const { GQLListSchema } = require('@open-condo/keystone/schema')

const { RENT_PAYMENT_PROVIDER_PAYSTACK } = require('@condo/domains/acquiring/constants/rentPayment')
const { CURRENCY_CODE_FIELD } = require('@condo/domains/common/schema/fields')
const { ORGANIZATION_OWNED_FIELD } = require('@condo/domains/organization/schema/fields')

const access = require('@condo/domains/acquiring/access/PaymentProviderCredential')

const PAYMENT_PROVIDER_CREDENTIAL_SECRET_ENCRYPTION_MANAGER = new EncryptionManager()
const PAYMENT_PROVIDER_CREDENTIAL_ENVIRONMENTS = ['test', 'live']
const PAYMENT_PROVIDER_CREDENTIAL_PROVIDERS = [RENT_PAYMENT_PROVIDER_PAYSTACK]

const PaymentProviderCredential = new GQLListSchema('PaymentProviderCredential', {
    schemaDoc: 'Organization-scoped payment provider credentials used for internal acquiring operations',
    fields: {
        organization: ORGANIZATION_OWNED_FIELD,
        provider: {
            schemaDoc: 'Payment provider code',
            type: 'Select',
            options: PAYMENT_PROVIDER_CREDENTIAL_PROVIDERS,
            dataType: 'string',
            defaultValue: RENT_PAYMENT_PROVIDER_PAYSTACK,
            isRequired: true,
        },
        environment: {
            schemaDoc: 'Provider credential environment',
            type: 'Select',
            options: PAYMENT_PROVIDER_CREDENTIAL_ENVIRONMENTS,
            dataType: 'string',
            defaultValue: 'test',
            isRequired: true,
        },
        publicKey: {
            schemaDoc: 'Optional provider public key',
            type: 'Text',
            isRequired: false,
        },
        secretKey: {
            schemaDoc: 'Encrypted provider secret key',
            type: 'EncryptedText',
            sensitive: true,
            encryptionManager: PAYMENT_PROVIDER_CREDENTIAL_SECRET_ENCRYPTION_MANAGER,
            isRequired: true,
            access: {
                read: false,
                create: true,
                update: true,
            },
        },
        webhookSecret: {
            schemaDoc: 'Encrypted provider webhook verification secret',
            type: 'EncryptedText',
            sensitive: true,
            encryptionManager: PAYMENT_PROVIDER_CREDENTIAL_SECRET_ENCRYPTION_MANAGER,
            isRequired: false,
            access: {
                read: false,
                create: true,
                update: true,
            },
        },
        currency: {
            ...CURRENCY_CODE_FIELD,
            schemaDoc: 'Default credential currency code',
            defaultValue: 'GHS',
        },
        initiationEnabled: {
            schemaDoc: 'Whether payment initiation is enabled for this credential',
            type: 'Checkbox',
            defaultValue: true,
        },
        verificationEnabled: {
            schemaDoc: 'Whether payment verification is enabled for this credential',
            type: 'Checkbox',
            defaultValue: true,
        },
        webhookEnabled: {
            schemaDoc: 'Whether webhook ingestion is enabled for this credential',
            type: 'Checkbox',
            defaultValue: true,
        },
        isEnabled: {
            schemaDoc: 'Whether this credential is enabled overall',
            type: 'Checkbox',
            defaultValue: true,
        },
        metadata: {
            schemaDoc: 'Internal-only credential metadata',
            type: 'Json',
            isRequired: false,
            access: {
                read: false,
                create: true,
                update: true,
            },
        },
    },
    plugins: [uuided(), versioned(), tracked(), softDeleted(), dvAndSender(), historical(), analytical()],
    access: {
        read: access.canReadPaymentProviderCredentials,
        create: access.canManagePaymentProviderCredentials,
        update: access.canManagePaymentProviderCredentials,
        delete: false,
        auth: true,
    },
    kmigratorOptions: {
        constraints: [
            {
                type: 'models.UniqueConstraint',
                fields: ['organization', 'provider', 'environment'],
                condition: 'Q(deletedAt__isnull=True)',
                name: 'paymentprovidercredential_unique_org_provider_env',
            },
        ],
    },
})

module.exports = {
    PAYMENT_PROVIDER_CREDENTIAL_ENVIRONMENTS,
    PAYMENT_PROVIDER_CREDENTIAL_PROVIDERS,
    PaymentProviderCredential,
}
