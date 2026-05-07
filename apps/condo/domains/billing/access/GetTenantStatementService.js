const { throwAuthenticationError } = require('@open-condo/keystone/apolloErrorFormatter')
const { getById } = require('@open-condo/keystone/schema')

const { checkPermissionsInEmployedOrRelatedOrganizations } = require('@condo/domains/organization/utils/accessSchema')
const { RESIDENT, SERVICE } = require('@condo/domains/user/constants/common')
const { canDirectlyExecuteService } = require('@condo/domains/user/utils/directAccess')

async function canGetTenantStatement ({ args: { data }, authentication: { item: user }, context, gqlName }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false
    if (user.isAdmin || user.isSupport) return true

    const hasDirectAccess = await canDirectlyExecuteService(user, gqlName)
    if (hasDirectAccess) return hasDirectAccess

    if (user.type === RESIDENT) {
        const tenantId = data && data.tenant && data.tenant.id
        const organizationId = data && data.organization && data.organization.id
        if (!tenantId || !organizationId) return false

        const tenant = await getById('Resident', tenantId)
        if (!tenant || tenant.deletedAt) return false

        return String(tenant.user) === String(user.id) && String(tenant.organization) === String(organizationId)
    }

    if (user.type === SERVICE) return false

    const organizationId = data && data.organization && data.organization.id
    if (!organizationId) return false

    return await checkPermissionsInEmployedOrRelatedOrganizations(context, user, organizationId, 'canReadBillingReceipts')
}

module.exports = {
    canGetTenantStatement,
}
