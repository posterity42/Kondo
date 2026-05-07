const checkPermissionsInEmployedOrganizations = jest.fn()
const getEmployedOrRelatedOrganizationsByPermissions = jest.fn()
const getUserResidents = jest.fn()
const find = jest.fn()
const getByCondition = jest.fn()
const getById = jest.fn()
const canDirectlyManageSchemaObjects = jest.fn()
const canDirectlyReadSchemaObjects = jest.fn()

jest.mock('@open-condo/keystone/schema', () => ({
    find: (...args) => find(...args),
    getByCondition: (...args) => getByCondition(...args),
    getById: (...args) => getById(...args),
}))

jest.mock('@condo/domains/organization/utils/accessSchema', () => ({
    checkPermissionsInEmployedOrganizations: (...args) => checkPermissionsInEmployedOrganizations(...args),
    getEmployedOrRelatedOrganizationsByPermissions: (...args) => getEmployedOrRelatedOrganizationsByPermissions(...args),
}))

jest.mock('@condo/domains/resident/utils/accessSchema', () => ({
    getUserResidents: (...args) => getUserResidents(...args),
}))

jest.mock('@condo/domains/user/utils/directAccess', () => ({
    canDirectlyManageSchemaObjects: (...args) => canDirectlyManageSchemaObjects(...args),
    canDirectlyReadSchemaObjects: (...args) => canDirectlyReadSchemaObjects(...args),
}))

const { canManageRentalUnits } = require('./RentalUnit')


describe('RentalUnit access', () => {
    const context = {}
    const user = { id: 'user-1', type: 'staff' }

    beforeEach(() => {
        jest.clearAllMocks()
        canDirectlyManageSchemaObjects.mockResolvedValue(false)
        canDirectlyReadSchemaObjects.mockResolvedValue(false)
        checkPermissionsInEmployedOrganizations.mockResolvedValue(true)
        getEmployedOrRelatedOrganizationsByPermissions.mockResolvedValue([])
        getUserResidents.mockResolvedValue([])
    })

    test('allows create when organization is inferred from property', async () => {
        getByCondition.mockResolvedValue({ id: 'property-1', organization: 'org-1' })

        const result = await canManageRentalUnits({
            authentication: { item: user },
            context,
            listKey: 'RentalUnit',
            operation: 'create',
            originalInput: {
                property: { connect: { id: 'property-1' } },
            },
        })

        expect(result).toBe(true)
        expect(getByCondition).toHaveBeenCalledWith('Property', {
            id: 'property-1',
            deletedAt: null,
        })
        expect(checkPermissionsInEmployedOrganizations).toHaveBeenCalledWith(context, user, ['org-1'], 'canManageProperties')
    })

    test('rejects create when property is missing', async () => {
        getByCondition.mockResolvedValue(null)

        const result = await canManageRentalUnits({
            authentication: { item: user },
            context,
            listKey: 'RentalUnit',
            operation: 'create',
            originalInput: {
                property: { connect: { id: 'property-1' } },
            },
        })

        expect(result).toBe(false)
        expect(checkPermissionsInEmployedOrganizations).not.toHaveBeenCalled()
    })
})
