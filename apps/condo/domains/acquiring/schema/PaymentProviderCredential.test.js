const AUTHENTICATION_ERROR = new Error('AUTHENTICATION_ERROR')

class MockEncryptionManager {
    encrypt (value) {
        return `encrypted:${value}`
    }

    decrypt (value) {
        return value.replace(/^encrypted:/, '')
    }

    isEncrypted (value) {
        return typeof value === 'string' && value.startsWith('encrypted:')
    }
}

function loadPaymentProviderCredentialSchema () {
    let schemaModule

    jest.isolateModules(() => {
        jest.doMock('@condo/domains/acquiring/access/PaymentProviderCredential', () => ({
            canReadPaymentProviderCredentials: jest.fn(),
            canManagePaymentProviderCredentials: jest.fn(),
        }))
        jest.doMock('@open-condo/keystone/crypto/EncryptionManager', () => ({
            EncryptionManager: MockEncryptionManager,
        }))

        schemaModule = require('./PaymentProviderCredential')
    })

    return schemaModule
}

function loadPaymentProviderCredentialAccess () {
    const mocks = {
        throwAuthenticationError: jest.fn(() => {
            throw AUTHENTICATION_ERROR
        }),
        getById: jest.fn(),
        checkPermissionsInEmployedOrganizations: jest.fn(),
        getEmployedOrganizationsBySomePermissions: jest.fn(),
    }
    let accessModule

    jest.isolateModules(() => {
        jest.dontMock('@condo/domains/acquiring/access/PaymentProviderCredential')
        jest.doMock('@open-condo/keystone/apolloErrorFormatter', () => ({
            throwAuthenticationError: mocks.throwAuthenticationError,
        }))
        jest.doMock('@open-condo/keystone/schema', () => ({
            getById: mocks.getById,
        }))
        jest.doMock('@condo/domains/organization/utils/accessSchema', () => ({
            checkPermissionsInEmployedOrganizations: mocks.checkPermissionsInEmployedOrganizations,
            getEmployedOrganizationsBySomePermissions: mocks.getEmployedOrganizationsBySomePermissions,
        }))

        accessModule = require('@condo/domains/acquiring/access/PaymentProviderCredential')
    })

    return { accessModule, mocks }
}

describe('PaymentProviderCredential schema contract', () => {
    afterEach(() => {
        jest.clearAllMocks()
        jest.resetModules()
    })

    test('keeps secrets and metadata hidden in schema and generated GraphQL helpers', () => {
        const {
            PaymentProviderCredential,
            PAYMENT_PROVIDER_CREDENTIAL_ENVIRONMENTS,
            PAYMENT_PROVIDER_CREDENTIAL_PROVIDERS,
        } = loadPaymentProviderCredentialSchema()
        const fields = PaymentProviderCredential.schema.fields
        const { PaymentProviderCredential: PaymentProviderCredentialGQL } = require('@condo/domains/acquiring/gql')

        expect(PAYMENT_PROVIDER_CREDENTIAL_ENVIRONMENTS).toEqual(['test', 'live'])
        expect(PAYMENT_PROVIDER_CREDENTIAL_PROVIDERS).toEqual(['paystack'])

        expect(fields.secretKey).toMatchObject({
            type: 'EncryptedText',
            isRequired: true,
            sensitive: true,
            access: {
                read: false,
                create: true,
                update: true,
            },
        })
        expect(fields.webhookSecret).toMatchObject({
            type: 'EncryptedText',
            sensitive: true,
            access: {
                read: false,
                create: true,
                update: true,
            },
        })
        expect(fields.metadata).toMatchObject({
            type: 'Json',
            access: {
                read: false,
                create: true,
                update: true,
            },
        })

        const publicSelectionSets = [
            PaymentProviderCredentialGQL.MODEL_FIELDS,
            PaymentProviderCredentialGQL.GET_ALL_OBJS_QUERY.loc.source.body,
            PaymentProviderCredentialGQL.CREATE_OBJ_MUTATION.loc.source.body,
            PaymentProviderCredentialGQL.UPDATE_OBJ_MUTATION.loc.source.body,
        ]

        for (const selectionSet of publicSelectionSets) {
            expect(selectionSet).not.toContain('secretKey')
            expect(selectionSet).not.toContain('webhookSecret')
            expect(selectionSet).not.toContain('metadata')
        }
    })

    test('enforces organization + provider + environment uniqueness with soft-delete awareness', () => {
        const { PaymentProviderCredential } = loadPaymentProviderCredentialSchema()

        expect(PaymentProviderCredential.schema.kmigratorOptions.constraints).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'models.UniqueConstraint',
                fields: ['organization', 'provider', 'environment'],
                condition: 'Q(deletedAt__isnull=True)',
                name: 'paymentprovidercredential_unique_org_provider_env',
            }),
        ]))
    })

    test('uses encrypted fields for at-rest secret storage', () => {
        const { PaymentProviderCredential } = loadPaymentProviderCredentialSchema()
        const { secretKey, webhookSecret } = PaymentProviderCredential.schema.fields

        const encryptedSecretKey = secretKey.encryptionManager.encrypt('sk_test_payment_provider_credential')
        const encryptedWebhookSecret = webhookSecret.encryptionManager.encrypt('whsec_test_payment_provider_credential')

        expect(secretKey.encryptionManager).toBeInstanceOf(MockEncryptionManager)
        expect(webhookSecret.encryptionManager).toBeInstanceOf(MockEncryptionManager)
        expect(encryptedSecretKey).not.toBe('sk_test_payment_provider_credential')
        expect(encryptedWebhookSecret).not.toBe('whsec_test_payment_provider_credential')
        expect(secretKey.encryptionManager.decrypt(encryptedSecretKey)).toBe('sk_test_payment_provider_credential')
        expect(webhookSecret.encryptionManager.decrypt(encryptedWebhookSecret)).toBe('whsec_test_payment_provider_credential')
    })
})

describe('PaymentProviderCredential access control', () => {
    afterEach(() => {
        jest.clearAllMocks()
        jest.resetModules()
    })

    test('read access is limited to admins, support, and staff from permitted organizations', async () => {
        const { accessModule, mocks } = loadPaymentProviderCredentialAccess()
        const context = { req: { id: 'req-1' } }
        const staffUser = { id: 'staff-1', type: 'staff' }

        await expect(accessModule.canReadPaymentProviderCredentials({
            authentication: { item: null },
            context,
        })).rejects.toThrow('AUTHENTICATION_ERROR')

        expect(await accessModule.canReadPaymentProviderCredentials({
            authentication: { item: { id: 'deleted', deletedAt: '2026-05-06T00:00:00.000Z' } },
            context,
        })).toBe(false)

        expect(await accessModule.canReadPaymentProviderCredentials({
            authentication: { item: { id: 'admin', isAdmin: true } },
            context,
        })).toEqual({})

        expect(await accessModule.canReadPaymentProviderCredentials({
            authentication: { item: { id: 'support', isSupport: true } },
            context,
        })).toEqual({})

        expect(await accessModule.canReadPaymentProviderCredentials({
            authentication: { item: { id: 'resident', type: 'resident' } },
            context,
        })).toBe(false)

        mocks.getEmployedOrganizationsBySomePermissions.mockResolvedValue(['org-1', 'org-2'])

        expect(await accessModule.canReadPaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
        })).toEqual({
            organization: {
                id_in: ['org-1', 'org-2'],
            },
        })
        expect(mocks.getEmployedOrganizationsBySomePermissions).toHaveBeenCalledWith(
            context,
            staffUser,
            ['canManageIntegrations', 'canManageOrganization']
        )
    })

    test('create access allows org staff with integrations or organization management permission', async () => {
        const { accessModule, mocks } = loadPaymentProviderCredentialAccess()
        const context = { req: { id: 'req-2' } }
        const staffUser = { id: 'staff-2', type: 'staff' }

        await expect(accessModule.canManagePaymentProviderCredentials({
            authentication: { item: null },
            context,
            operation: 'create',
            originalInput: {},
        })).rejects.toThrow('AUTHENTICATION_ERROR')

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: { id: 'admin', isAdmin: true } },
            context,
            operation: 'create',
            originalInput: {},
        })).toBe(true)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: { id: 'support', isSupport: true } },
            context,
            operation: 'create',
            originalInput: {},
        })).toBe(true)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: { id: 'resident', type: 'resident' } },
            context,
            operation: 'create',
            originalInput: { organization: { connect: { id: 'org-1' } } },
        })).toBe(false)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'create',
            originalInput: {},
        })).toBe(false)

        mocks.checkPermissionsInEmployedOrganizations
            .mockResolvedValueOnce(true)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'create',
            originalInput: { organization: { connect: { id: 'org-1' } } },
        })).toBe(true)
        expect(mocks.checkPermissionsInEmployedOrganizations).toHaveBeenCalledWith(
            context,
            staffUser,
            'org-1',
            'canManageIntegrations'
        )

        mocks.checkPermissionsInEmployedOrganizations
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'create',
            originalInput: { organization: { connect: { id: 'org-2' } } },
        })).toBe(true)

        mocks.checkPermissionsInEmployedOrganizations
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'create',
            originalInput: { organization: { connect: { id: 'org-3' } } },
        })).toBe(false)
    })

    test('update access is scoped to the credential organization', async () => {
        const { accessModule, mocks } = loadPaymentProviderCredentialAccess()
        const context = { req: { id: 'req-3' } }
        const staffUser = { id: 'staff-3', type: 'staff' }

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'update',
            itemId: null,
        })).toBe(false)

        mocks.getById.mockResolvedValueOnce(null)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'update',
            itemId: 'credential-missing',
        })).toBe(false)
        expect(mocks.getById).toHaveBeenCalledWith('PaymentProviderCredential', 'credential-missing')

        mocks.getById.mockResolvedValueOnce({ id: 'credential-1', organization: 'org-1' })
        mocks.checkPermissionsInEmployedOrganizations
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'update',
            itemId: 'credential-1',
        })).toBe(true)

        mocks.getById.mockResolvedValueOnce({ id: 'credential-2', organization: 'org-2' })
        mocks.checkPermissionsInEmployedOrganizations
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)

        expect(await accessModule.canManagePaymentProviderCredentials({
            authentication: { item: staffUser },
            context,
            operation: 'update',
            itemId: 'credential-2',
        })).toBe(false)
    })
})
