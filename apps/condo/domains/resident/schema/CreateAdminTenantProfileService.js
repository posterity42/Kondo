const get = require('lodash/get')

const { GQLError, GQLErrorCode: { BAD_USER_INPUT } } = require('@open-condo/keystone/errors')
const { GQLCustomSchema, getById } = require('@open-condo/keystone/schema')

const access = require('@condo/domains/resident/access/CreateAdminTenantProfileService')
const { Resident } = require('@condo/domains/resident/utils/serverSchema')
const { RESIDENT } = require('@condo/domains/user/constants/common')
const { User } = require('@condo/domains/user/utils/serverSchema')

const ERRORS = {
    PROPERTY_NOT_FOUND: {
        mutation: 'createAdminTenantProfile',
        code: BAD_USER_INPUT,
        type: 'PROPERTY_NOT_FOUND',
        message: 'Property not found in the specified organization',
        messageForUser: 'api.resident.createAdminTenantProfile.PROPERTY_NOT_FOUND',
    },
    NAME_REQUIRED: {
        mutation: 'createAdminTenantProfile',
        code: BAD_USER_INPUT,
        type: 'TENANT_NAME_REQUIRED',
        message: 'Tenant full name is required',
        messageForUser: 'api.resident.createAdminTenantProfile.NAME_REQUIRED',
    },
    PHONE_REQUIRED: {
        mutation: 'createAdminTenantProfile',
        code: BAD_USER_INPUT,
        type: 'TENANT_PHONE_REQUIRED',
        message: 'Tenant phone is required',
        messageForUser: 'api.resident.createAdminTenantProfile.PHONE_REQUIRED',
    },
}

function normalizeOptionalString (value) {
    const normalized = String(value || '').trim()
    return normalized || null
}

const CreateAdminTenantProfileService = new GQLCustomSchema('CreateAdminTenantProfileService', {
    types: [
        {
            access: true,
            type: 'input CreateAdminTenantProfileInput { dv: Int!, sender: SenderFieldInput!, organizationId: ID!, propertyId: ID!, name: String!, phone: String!, email: String, ghanaCardNumber: String, emergencyContactName: String, emergencyContactPhone: String, institutionName: String, studentIdNumber: String }',
        },
    ],
    mutations: [
        {
            access: access.canCreateAdminTenantProfile,
            schema: 'createAdminTenantProfile(data: CreateAdminTenantProfileInput!): Resident',
            resolver: async (parent, args, context) => {
                const {
                    dv,
                    sender,
                    organizationId,
                    propertyId,
                    name,
                    phone,
                    email,
                    ghanaCardNumber,
                    emergencyContactName,
                    emergencyContactPhone,
                    institutionName,
                    studentIdNumber,
                } = args.data

                const normalizedName = normalizeOptionalString(name)
                const normalizedPhone = normalizeOptionalString(phone)
                if (!normalizedName) {
                    throw new GQLError(ERRORS.NAME_REQUIRED, context)
                }
                if (!normalizedPhone) {
                    throw new GQLError(ERRORS.PHONE_REQUIRED, context)
                }

                const property = await getById('Property', propertyId)
                if (!property || property.deletedAt || property.organization !== organizationId) {
                    throw new GQLError(ERRORS.PROPERTY_NOT_FOUND, context)
                }

                let user = null
                try {
                    user = await User.create(context, {
                        dv,
                        sender,
                        type: RESIDENT,
                        name: normalizedName,
                        phone: normalizedPhone,
                        email: normalizeOptionalString(email),
                        isPhoneVerified: false,
                        isEmailVerified: false,
                    })

                    const resident = await Resident.create(context, {
                        dv,
                        sender,
                        user: { connect: { id: user.id } },
                        property: { connect: { id: property.id } },
                        address: property.address,
                        addressMeta: get(property, 'addressMeta'),
                        unitName: null,
                        unitType: null,
                        ghanaCardNumber: normalizeOptionalString(ghanaCardNumber),
                        emergencyContactName: normalizeOptionalString(emergencyContactName),
                        emergencyContactPhone: normalizeOptionalString(emergencyContactPhone),
                        institutionName: normalizeOptionalString(institutionName),
                        studentIdNumber: normalizeOptionalString(studentIdNumber),
                    })

                    return await getById('Resident', resident.id)
                } catch (error) {
                    if (user && user.id) {
                        try {
                            await User.update(context, user.id, {
                                dv,
                                sender,
                                deletedAt: new Date().toISOString(),
                            })
                        } catch {
                            // Best-effort cleanup for partially created profile records.
                        }
                    }

                    throw error
                }
            },
        },
    ],
})

module.exports = {
    CreateAdminTenantProfileService,
    ERRORS,
}
