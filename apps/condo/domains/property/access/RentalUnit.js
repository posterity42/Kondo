const get = require('lodash/get')
const isEmpty = require('lodash/isEmpty')
const isNull = require('lodash/isNil')
const uniq = require('lodash/uniq')

const { throwAuthenticationError } = require('@open-condo/keystone/apolloErrorFormatter')
const { find, getByCondition, getById } = require('@open-condo/keystone/schema')

const {
    checkPermissionsInEmployedOrganizations,
    getEmployedOrRelatedOrganizationsByPermissions,
} = require('@condo/domains/organization/utils/accessSchema')
const { getUserResidents } = require('@condo/domains/resident/utils/accessSchema')
const { RESIDENT, SERVICE } = require('@condo/domains/user/constants/common')
const { canDirectlyManageSchemaObjects, canDirectlyReadSchemaObjects } = require('@condo/domains/user/utils/directAccess')

async function canReadRentalUnits ({ authentication: { item: user }, context, listKey }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false

    if (user.isAdmin || user.isSupport) return {}

    const hasDirectAccess = await canDirectlyReadSchemaObjects(user, listKey)
    if (hasDirectAccess) return true

    if (user.type === RESIDENT) {
        const residents = await getUserResidents(context, user)
        const propertyIds = uniq(residents.map(resident => resident.property).filter(Boolean))

        return {
            property: {
                id_in: propertyIds,
            },
            deletedAt: null,
        }
    }

    if (user.type === SERVICE) return false

    const organizationIds = await getEmployedOrRelatedOrganizationsByPermissions(context, user, 'canReadProperties')

    return {
        organization: {
            id_in: organizationIds,
        },
        deletedAt: null,
    }
}

async function canManageRentalUnits ({ authentication: { item: user }, originalInput, operation, itemId, itemIds, context, listKey }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false
    if (user.isAdmin || user.isSupport) return true

    const hasDirectAccess = await canDirectlyManageSchemaObjects(user, listKey, originalInput, operation)
    if (hasDirectAccess) return true
    if (user.type === RESIDENT || user.type === SERVICE) return false

    const isBulkRequest = Array.isArray(originalInput)
    let organizationIds

    if (operation === 'create') {
        if (isBulkRequest) {
            const orgIds = uniq(originalInput.map((item) => get(item, ['data', 'organization', 'connect', 'id'])).filter(Boolean))
            const propertyIds = uniq(originalInput.map((item) => get(item, ['data', 'property', 'connect', 'id'])).filter(Boolean))

            let organizationIdsFromProperties = []
            if (propertyIds.length) {
                const properties = await find('Property', {
                    id_in: propertyIds,
                    deletedAt: null,
                })

                if (properties.length !== propertyIds.length) return false

                organizationIdsFromProperties = uniq(properties.map(property => get(property, 'organization', null)))
                if (organizationIdsFromProperties.some(isNull)) return false
            }

            organizationIds = uniq([...orgIds, ...organizationIdsFromProperties])
        } else {
            let organizationId = get(originalInput, ['organization', 'connect', 'id'])

            if (!organizationId) {
                const propertyId = get(originalInput, ['property', 'connect', 'id'])

                if (propertyId) {
                    const property = await getByCondition('Property', {
                        id: propertyId,
                        deletedAt: null,
                    })

                    if (!property || !property.organization) return false

                    organizationId = property.organization
                }
            }

            if (!organizationId) return false
            organizationIds = [organizationId]
        }
    } else if (operation === 'update') {
        const ids = itemIds || [itemId]
        if (ids.length !== uniq(ids).length) return false

        const items = await find('RentalUnit', {
            id_in: ids,
            deletedAt: null,
        })

        if (items.length !== ids.length || items.some(item => !item.organization)) return false
        organizationIds = uniq(items.map(item => item.organization))
    } else if (operation === 'delete' && itemId) {
        const item = await getById('RentalUnit', itemId)
        if (!item || !item.organization) return false
        organizationIds = [item.organization]
    }

    if (isEmpty(organizationIds) || organizationIds.some(isNull)) return false

    return await checkPermissionsInEmployedOrganizations(context, user, organizationIds, 'canManageProperties')
}

module.exports = {
    canReadRentalUnits,
    canManageRentalUnits,
}
