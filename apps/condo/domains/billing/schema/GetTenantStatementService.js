const { GQLErrorCode: { BAD_USER_INPUT } } = require('@open-condo/keystone/errors')
const { checkDvAndSender } = require('@open-condo/keystone/plugins/dvAndSender')
const { GQLCustomSchema } = require('@open-condo/keystone/schema')

const access = require('@condo/domains/billing/access/GetTenantStatementService')
const { getTenantStatement } = require('@condo/domains/billing/utils/serverSchema')
const { DV_VERSION_MISMATCH, WRONG_FORMAT } = require('@condo/domains/common/constants/errors')

const ERRORS = {
    DV_VERSION_MISMATCH: {
        query: 'getTenantStatement',
        variable: ['data', 'dv'],
        code: BAD_USER_INPUT,
        type: DV_VERSION_MISMATCH,
        message: 'Wrong value for data version number',
    },
    WRONG_SENDER_FORMAT: {
        query: 'getTenantStatement',
        variable: ['data', 'sender'],
        code: BAD_USER_INPUT,
        type: WRONG_FORMAT,
        message: 'Invalid format of "sender" field value. {details}',
        correctExample: '{ "dv": 1, "fingerprint": "uniq-device-or-container-id" }',
        messageInterpolation: { details: 'Please, check the example for details' },
    },
}

const GetTenantStatementService = new GQLCustomSchema('GetTenantStatementService', {
    types: [
        {
            access: true,
            type: 'input GetTenantStatementInput { dv: Int!, sender: SenderFieldInput!, organization: OrganizationWhereUniqueInput!, tenant: ResidentWhereUniqueInput!, occupancy: OccupancyWhereUniqueInput, property: PropertyWhereUniqueInput, dateFrom: String, dateTo: String }',
        },
        {
            access: true,
            type: 'type TenantStatementHeader { tenantId: ID!, tenantName: String!, tenantPhone: String, tenantEmail: String, propertyId: ID, propertyName: String, rentalUnitId: ID, rentalUnitName: String, occupancyId: ID, occupancyStatus: String, statementPeriodStart: String, statementPeriodEnd: String, currencyCode: String! }',
        },
        {
            access: true,
            type: 'type TenantStatementSummary { totalCharges: String!, totalPayments: String!, totalReversals: String!, totalCreditsAdjustments: String!, openingBalance: String!, closingBalance: String!, outstandingBalance: String!, runningBalanceAvailable: Boolean! }',
        },
        {
            access: true,
            type: 'type TenantStatementRow { id: ID!, date: String!, type: String!, description: String!, debit: String, credit: String, runningBalance: String, linkedEntityId: ID, linkedEntityType: String, reference: String, status: String, occupancyId: ID, propertyId: ID, rentalUnitId: ID }',
        },
        {
            access: true,
            type: 'type TenantStatementOutput { header: TenantStatementHeader!, summary: TenantStatementSummary!, rows: [TenantStatementRow!]! }',
        },
    ],
    queries: [
        {
            access: access.canGetTenantStatement,
            schema: 'getTenantStatement(data: GetTenantStatementInput!): TenantStatementOutput',
            resolver: async (parent, args, context) => {
                const { data } = args

                checkDvAndSender(data, ERRORS.DV_VERSION_MISMATCH, ERRORS.WRONG_SENDER_FORMAT, context)

                return await getTenantStatement(context, data)
            },
        },
    ],
})

module.exports = {
    GetTenantStatementService,
}
