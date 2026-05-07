import { useQuery } from '@apollo/client'
import { Card, DatePicker, Input, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useMemo, useState } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { DEFAULT_PAGE_SIZE, formatDate, formatMoney, getPropertyName, getRentalUnitName, getTenantName, isDateInRange, matchesSearch, PageError, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_RENT_CHARGES = gql`
    query getRentChargesPage ($organizationId: ID!) {
        rentCharges: allRentCharges(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [billingMonth_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            billingMonth
            periodStart
            periodEnd
            dueDate
            amount
            currencyCode
            status
            tenant { id user { id name phone } }
            occupancy { id }
            property { id address addressKey }
            rentalUnit { id name unitType }
            allocations(first: 20, where: { deletedAt: null }) { id amount }
        }
    }
`

const RentChargesPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const [propertyFilter, setPropertyFilter] = useState<string | undefined>()
    const [tenantFilter, setTenantFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
    const { data, loading, error } = useQuery(GET_RENT_CHARGES, {
        variables: { organizationId },
        skip: !organizationId,
    })

    const rentCharges = get(data, 'rentCharges', [])
    const propertyOptions = useMemo(() => Array.from(new Map(
        rentCharges
            .filter(charge => get(charge, ['property', 'id']))
            .map(charge => [get(charge, ['property', 'id']), {
                label: getPropertyName(get(charge, 'property')),
                value: get(charge, ['property', 'id']),
            }])
    ).values()), [rentCharges])
    const tenantOptions = useMemo(() => Array.from(new Map(
        rentCharges
            .filter(charge => get(charge, ['tenant', 'id']))
            .map(charge => [get(charge, ['tenant', 'id']), {
                label: getTenantName(get(charge, 'tenant')),
                value: get(charge, ['tenant', 'id']),
            }])
    ).values()), [rentCharges])

    const filteredRentCharges = useMemo(() => {
        const [startDate, endDate] = dateRange || []

        return rentCharges.filter(charge => {
            if (statusFilter && get(charge, 'status') !== statusFilter) return false
            if (propertyFilter && get(charge, ['property', 'id']) !== propertyFilter) return false
            if (tenantFilter && get(charge, ['tenant', 'id']) !== tenantFilter) return false
            if (!isDateInRange(get(charge, 'billingMonth'), startDate, endDate) && !isDateInRange(get(charge, 'dueDate'), startDate, endDate)) return false

            return matchesSearch(search, [
                getTenantName(get(charge, 'tenant')),
                getPropertyName(get(charge, 'property')),
                getRentalUnitName(intl, get(charge, 'rentalUnit')),
                get(charge, 'status'),
            ])
        })
    }, [dateRange, intl, propertyFilter, rentCharges, search, statusFilter, tenantFilter])

    const columns = [
        { title: 'Billing Month', key: 'billingMonth', render: (_, charge) => renderLink(formatDate(get(charge, 'billingMonth')), `/rentCharge/${charge.id}`) },
        { title: 'Tenant', key: 'tenant', render: (_, charge) => renderLink(getTenantName(get(charge, 'tenant')), `/tenant/${get(charge, ['tenant', 'id'])}`) },
        { title: 'Property', key: 'property', render: (_, charge) => getPropertyName(get(charge, 'property')) },
        { title: 'Rental Unit', key: 'rentalUnit', render: (_, charge) => getRentalUnitName(intl, get(charge, 'rentalUnit')) },
        { title: 'Due Date', key: 'dueDate', render: (_, charge) => formatDate(get(charge, 'dueDate')) },
        { title: 'Amount', key: 'amount', render: (_, charge) => formatMoney(intl, get(charge, 'amount'), get(charge, 'currencyCode')) },
        { title: 'Status', key: 'status', render: (_, charge) => <StatusTag status={get(charge, 'status')} /> },
        { title: 'Allocations', key: 'allocations', render: (_, charge) => get(charge, 'allocations', []).length },
    ]

    return (
        <PageWrapper>
            <PageHeader title='Rent Charges' subTitle='Generated rent billing items and allocation state' />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        Charges are displayed in GHS and stay read-only here. No new billing algorithm is introduced from the UI.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder='Search by tenant, property, rental unit, or charge status' />
                            <Space wrap>
                                <Select allowClear placeholder='Status' value={statusFilter} onChange={setStatusFilter} options={[
                                    { label: 'draft', value: 'draft' },
                                    { label: 'invoiced', value: 'invoiced' },
                                    { label: 'partially_paid', value: 'partially_paid' },
                                    { label: 'paid', value: 'paid' },
                                ]} style={{ minWidth: 180 }} />
                                <Select allowClear showSearch placeholder='Property' value={propertyFilter} onChange={setPropertyFilter} options={propertyOptions} style={{ minWidth: 220 }} />
                                <Select allowClear showSearch placeholder='Tenant' value={tenantFilter} onChange={setTenantFilter} options={tenantOptions} style={{ minWidth: 220 }} />
                                <DatePicker.RangePicker value={dateRange || undefined} onChange={value => setDateRange(value as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredRentCharges} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
        </PageWrapper>
    )
}

RentChargesPage.requiredAccess = OrganizationRequired

export default RentChargesPage
