import { useQuery } from '@apollo/client'
import { Card, Input, Select, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Link from 'next/link'
import React, { useMemo, useState } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { DEFAULT_PAGE_SIZE, formatMoney, getPropertyName, getRentalUnitName, getTenantName, matchesSearch, PageError, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_TENANTS = gql`
    query getTenantsPage ($organizationId: ID!) {
        tenants: allResidents(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            user { id name phone email }
            property { id address addressKey }
            ghanaCardNumber
            emergencyContactPhone
            institutionName
            currentOccupancy {
                id
                status
                monthlyRate
                rentalUnit { id name unitType }
            }
        }
        ledgers: allTenantLedgers(
            where: { organization: { id: $organizationId }, deletedAt: null }
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            currencyCode
            tenant { id }
            entries(first: 100, where: { deletedAt: null }) {
                id
                direction
                amount
            }
        }
    }
`

const TenantsPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization, link } = useOrganization()
    const organizationId = get(organization, 'id')
    const canManageResidents = get(link, ['role', 'canManageResidents'], false)
    const [search, setSearch] = useState('')
    const [propertyFilter, setPropertyFilter] = useState<string | undefined>()
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const { data, loading, error } = useQuery(GET_TENANTS, {
        variables: { organizationId },
        skip: !organizationId,
    })

    const tenants = get(data, 'tenants', [])
    const ledgersByTenantId = useMemo(() => get(data, 'ledgers', []).reduce((map, ledger) => {
        const tenantId = get(ledger, ['tenant', 'id'])
        if (tenantId && !map[tenantId]) map[tenantId] = ledger
        return map
    }, {}), [data])
    const propertyOptions = useMemo(() => Array.from(new Map(
        tenants
            .filter(tenant => get(tenant, ['property', 'id']))
            .map(tenant => [get(tenant, ['property', 'id']), {
                label: getPropertyName(get(tenant, 'property')),
                value: get(tenant, ['property', 'id']),
            }])
    ).values()), [tenants])

    const filteredTenants = useMemo(() => tenants.filter(tenant => {
        if (propertyFilter && get(tenant, ['property', 'id']) !== propertyFilter) return false
        if (statusFilter && get(tenant, ['currentOccupancy', 'status']) !== statusFilter) return false

        return matchesSearch(search, [
            getTenantName(tenant),
            get(tenant, ['user', 'phone']),
            get(tenant, ['user', 'email']),
            get(tenant, 'ghanaCardNumber'),
            getPropertyName(get(tenant, 'property')),
            get(tenant, 'institutionName'),
        ])
    }), [propertyFilter, search, statusFilter, tenants])

    const getTenantBalance = (tenant) => {
        const ledger = ledgersByTenantId[tenant.id]
        const entries = get(ledger, 'entries', [])
        const debits = entries.reduce((sum, entry) => get(entry, 'direction') === 'debit' ? sum + Number(get(entry, 'amount') || 0) : sum, 0)
        const credits = entries.reduce((sum, entry) => get(entry, 'direction') !== 'debit' ? sum + Number(get(entry, 'amount') || 0) : sum, 0)

        return formatMoney(intl, debits - credits, get(ledger, 'currencyCode'))
    }

    const columns = [
        { title: 'Tenant', key: 'tenant', render: (_, tenant) => renderLink(getTenantName(tenant), `/tenant/${tenant.id}`) },
        { title: 'Phone', key: 'phone', render: (_, tenant) => get(tenant, ['user', 'phone']) || get(tenant, 'emergencyContactPhone') || '—' },
        { title: 'Property', key: 'property', render: (_, tenant) => getPropertyName(get(tenant, 'property')) },
        { title: 'Unit / Room / Bed', key: 'tenancyUnit', render: (_, tenant) => {
            const occupancy = get(tenant, 'currentOccupancy')
            return occupancy ? renderLink(getRentalUnitName(intl, get(occupancy, 'rentalUnit')), `/tenancy/${get(occupancy, 'id')}`) : '—'
        } },
        { title: 'Tenancy Status', key: 'status', render: (_, tenant) => <StatusTag status={get(tenant, ['currentOccupancy', 'status'])} /> },
        { title: 'Balance', key: 'balance', render: (_, tenant) => getTenantBalance(tenant) },
        { title: 'Statement', key: 'statement', render: (_, tenant) => renderLink('Open', `/tenant/${tenant.id}/statement`) },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title='Tenants'
                subTitle='Tenant profiles, tenancy status, balances, and rental links'
                extra={canManageResidents ? [
                    <Link key='create-tenant' href='/tenant/create'>
                        <Button type='primary'>Add Tenant</Button>
                    </Link>,
                ] : []}
            />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder='Search by tenant, phone, email, Ghana Card, property, or institution' />
                            <Space wrap size={12}>
                                <Select allowClear showSearch placeholder='Property' value={propertyFilter} onChange={setPropertyFilter} options={propertyOptions} style={{ minWidth: 220 }} />
                                <Select allowClear placeholder='Tenancy Status' value={statusFilter} onChange={setStatusFilter} options={[
                                    { label: 'planned', value: 'planned' },
                                    { label: 'active', value: 'active' },
                                    { label: 'ended', value: 'ended' },
                                    { label: 'canceled', value: 'canceled' },
                                ]} style={{ minWidth: 180 }} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredTenants} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
        </PageWrapper>
    )
}

TenantsPage.requiredAccess = OrganizationRequired

export default TenantsPage
