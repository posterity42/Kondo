import {
    buildResidentRentPaymentInitiationBoundary,
    buildRentalUnitSelectWhere,
    buildResidentRentalDashboardDataSource,
    getResidentRentPaymentErrorMessage,
    getResidentRentPaymentLink,
    getResidentRentPaymentResultMessage,
    getRentalUnitDisplayName,
} from './rental'


const intl = {
    formatMessage: ({ id }) => {
        if (id === 'pages.condo.ticket.field.unitType.prefix.room') return 'Room'
        if (id === 'pages.condo.ticket.field.unitType.prefix.apartment') return ''

        return id
    },
} as never

describe('rental client helpers', () => {
    test('prefers rental unit display data over legacy resident fallback', () => {
        expect(getRentalUnitDisplayName(
            intl,
            { name: '204', unitType: 'room' },
            { unitName: 'legacy', unitType: 'apartment' }
        )).toBe('Room 204')
    })

    test('uses unitName and unitType only as deprecated display fallback', () => {
        expect(getRentalUnitDisplayName(
            intl,
            null,
            { unitName: '17', unitType: 'room' }
        )).toBe('Room 17')
    })

    test('builds RentalUnitSelect query scope with rentable filter', () => {
        expect(buildRentalUnitSelectWhere({
            propertyId: 'property',
            organizationId: 'organization',
            rentableOnly: true,
        })).toEqual({
            deletedAt: null,
            property: { id: 'property' },
            organization: { id: 'organization' },
            rentable: true,
        })
    })

    test('builds resident dashboard rows from rental-unit and rent-charge summary data', () => {
        const rows = buildResidentRentalDashboardDataSource(intl, {
            currentRentalUnit: { name: '301', unitType: 'room' },
            occupancyStatus: 'active',
            billingFrequency: 'annual',
            monthlyRate: '100.00000000',
            arrearsTotal: '25.00000000',
            nextDueDate: '2026-05-01',
            unpaidRentCharges: [{ id: 'charge-1' }, { id: 'charge-2' }],
            linkedUnpaidInvoices: [{ id: 'invoice-1' }],
        })

        expect(rows).toEqual([
            { label: 'Rental unit', value: 'Room 301' },
            { label: 'Occupancy status', value: 'active' },
            { label: 'Billing frequency', value: 'annual' },
            { label: 'Monthly rate', value: '100.00000000' },
            { label: 'Arrears', value: '25.00000000' },
            { label: 'Next due date', value: '2026-05-01' },
            { label: 'Unpaid rent charges', value: 2 },
            { label: 'Linked unpaid invoices', value: 1 },
        ])
    })

    test('builds a paystack initiation payload from resident arrears dashboard data', () => {
        expect(buildResidentRentPaymentInitiationBoundary({
            residentId: 'resident-1',
            organizationId: 'organization-1',
            payerContact: {
                email: 'resident@example.com',
                phone: '+233000000000',
            },
            dashboard: {
                arrearsTotal: '25.00000000',
                currentRentalUnit: {
                    id: 'unit-1',
                    name: '301',
                    unitType: 'room',
                    property: {
                        id: 'property-1',
                    },
                },
                unpaidRentCharges: [
                    { id: 'charge-1', currencyCode: 'GHS' },
                    { id: 'charge-2', currencyCode: 'GHS' },
                ],
            },
        })).toEqual({
            input: {
                dv: 1,
                organization: { id: 'organization-1' },
                tenant: { id: 'resident-1' },
                property: { id: 'property-1' },
                rentalUnit: { id: 'unit-1' },
                amount: '25.00000000',
                currency: 'GHS',
                providerCode: 'paystack',
                purpose: 'Online rent payment for unpaid rent charges',
                payerContact: {
                    email: 'resident@example.com',
                    phone: '+233000000000',
                },
                rentContext: {
                    source: 'residentRentalDashboard',
                    residentId: 'resident-1',
                    unpaidRentChargeIds: ['charge-1', 'charge-2'],
                },
            },
            disabledReason: null,
        })
    })

    test('blocks rent payment initiation when there are no unpaid rent charges', () => {
        expect(buildResidentRentPaymentInitiationBoundary({
            residentId: 'resident-1',
            organizationId: 'organization-1',
            payerContact: {
                phone: '+233000000000',
            },
            dashboard: {
                arrearsTotal: '0.00000000',
                currentRentalUnit: {
                    id: 'unit-1',
                    name: '301',
                    unitType: 'room',
                    property: {
                        id: 'property-1',
                    },
                },
                unpaidRentCharges: [],
            },
        })).toEqual({
            input: null,
            disabledReason: 'No unpaid rent charges are available for online payment.',
        })
    })

    test('maps safe initiation result data into a user-facing payment link and message', () => {
        const result = {
            amount: '25.00000000',
            currency: 'GHS',
            paymentId: 'payment-1',
            providerReference: 'paystack-init-ref-1',
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-1',
            actionTaken: 'duplicate_noop',
        }

        expect(getResidentRentPaymentLink(result)).toBe('https://checkout.paystack.com/paystack-init-ref-1')
        expect(getResidentRentPaymentResultMessage(result)).toBe('An existing pending rent payment was reused. Continue with the secure payment link below.')
    })

    test('maps sanitized recovery statuses into resident-facing messages', () => {
        expect(getResidentRentPaymentResultMessage({
            actionTaken: 'recovered_retry',
            authorizationUrl: 'https://checkout.paystack.com/paystack-init-ref-2',
        })).toBe('The previous pending rent payment could not be reused. Continue with the new secure payment link below.')

        expect(getResidentRentPaymentResultMessage({
            actionTaken: 'pending_noop',
        })).toBe('A previous rent payment is still pending verification. Please wait a moment before trying again.')

        expect(getResidentRentPaymentResultMessage({
            actionTaken: 'confirmed',
        })).toBe('The earlier pending rent payment has already been confirmed.')
    })

    test('maps sanitized initiation error messages for the resident payment boundary', () => {
        expect(getResidentRentPaymentErrorMessage({
            graphQLErrors: [{
                message: 'Provider "paystack" failed to initialize online rent payment',
            }],
        })).toBe('The payment provider could not start the rent payment right now. Please try again later.')

        expect(getResidentRentPaymentErrorMessage({
            message: 'Provider "paystack" is not configured for online rent payment initiation',
        })).toBe('Online rent payment is not available right now.')
    })
})
