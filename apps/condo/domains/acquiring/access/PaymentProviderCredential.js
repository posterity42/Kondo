const get = require('lodash/get')

const { throwAuthenticationError } = require('@open-condo/keystone/apolloErrorFormatter')
const { getById } = require('@open-condo/keystone/schema')

const {
    checkPermissionsInEmployedOrganizations,
    getEmployedOrganizationsBySomePermissions,
} = require('@condo/domains/organization/utils/accessSchema')
const { RESIDENT, STAFF } = require('@condo/domains/user/constants/common')

async function canReadPaymentProviderCredentials ({ authentication: { item: user }, context }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false

    if (user.isAdmin || user.isSupport) return {}
    if (user.type === RESIDENT) return false

    if (user.type === STAFF) {
        const organizationIds = await getEmployedOrganizationsBySomePermissions(
            context,
            user,
            ['canManageIntegrations', 'canManageOrganization']
        )

        return {
            organization: {
                id_in: organizationIds,
            },
        }
    }

    return false
}

async function canManagePaymentProviderCredentials ({ authentication: { item: user }, context, originalInput, operation, itemId }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false

    if (user.isAdmin || user.isSupport) return true
    if (user.type !== STAFF) return false

    let organizationId = null

    if (operation === 'create') {
        organizationId = get(originalInput, ['organization', 'connect', 'id'])
    } else if (operation === 'update') {
        if (!itemId) return false

        const credential = await getById('PaymentProviderCredential', itemId)
        if (!credential) return false

        organizationId = credential.organization
    }

    if (!organizationId) return false

    const canManageIntegrations = await checkPermissionsInEmployedOrganizations(
        context,
        user,
        organizationId,
        'canManageIntegrations'
    )
    if (canManageIntegrations) return true

    return await checkPermissionsInEmployedOrganizations(
        context,
        user,
        organizationId,
        'canManageOrganization'
    )
}

module.exports = {
    canReadPaymentProviderCredentials,
    canManagePaymentProviderCredentials,
}
