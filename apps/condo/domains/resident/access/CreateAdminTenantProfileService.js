const get = require('lodash/get')

const { throwAuthenticationError } = require('@open-condo/keystone/apolloErrorFormatter')
const { getById } = require('@open-condo/keystone/schema')

const { checkPermissionsInEmployedOrganizations } = require('@condo/domains/organization/utils/accessSchema')
const { RESIDENT, SERVICE } = require('@condo/domains/user/constants/common')
const { canDirectlyManageSchemaObjects } = require('@condo/domains/user/utils/directAccess')

async function canCreateAdminTenantProfile (accessArgs) {
    const { authentication: { item: user }, context } = accessArgs

    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false
    if (user.isAdmin || user.isSupport) return true

    const originalInput = {
        organization: {
            connect: {
                id: get(accessArgs, ['args', 'data', 'organizationId']),
            },
        },
    }
    const hasDirectAccess = await canDirectlyManageSchemaObjects(user, 'Resident', originalInput, 'create')
    if (hasDirectAccess) return true

    if (user.type === RESIDENT || user.type === SERVICE) return false

    let organizationId = get(accessArgs, ['args', 'data', 'organizationId'])
    if (!organizationId) {
        const propertyId = get(accessArgs, ['args', 'data', 'propertyId'])
        const property = propertyId && await getById('Property', propertyId)
        organizationId = get(property, 'organization')
    }

    if (!organizationId) return false

    return await checkPermissionsInEmployedOrganizations(context, user, [organizationId], 'canManageResidents')
}

module.exports = {
    canCreateAdminTenantProfile,
}
