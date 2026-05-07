import { useQuery } from '@apollo/client'
import { Card, Input, Select, Table } from 'antd'
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
import { DEFAULT_PAGE_SIZE, formatMoney, getTenantName, matchesSearch, PageError, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_LEDGERS = gql`
    query getLedgersPage ($organizationId: ID!) {
        ledgers: allTenantLedgers(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            currencyCode
            status
            tenant { id user { id name phone } }
            entries(first: 100, where: { deletedAt: null }) {
                id
                direction
                amount
            }
        }
    }
`

const LedgersPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [search, setSearch] = useState('')
    const [tenantFilter, setTenantFilter] = useState<string | undefined>()
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const { data, loading, error } = useQuery(GET_LEDGERS, {
        variables: { organizationId },
        skip: !organizationId,
    })

    const ledgers = get(data, 'ledgers', [])
    const tenantOptions = useMemo(() => ledgers
        .filter(ledger => get(ledger, ['tenant', 'id']))
        .map(ledger => ({
            label: getTenantName(get(ledger, 'tenant')),
            value: get(ledger, ['tenant', 'id']),
        })), [ledgers])

    const filteredLedgers = useMemo(() => ledgers.filter(ledger => {
        if (tenantFilter && get(ledger, ['tenant', 'id']) !== tenantFilter) return false
        if (statusFilter && get(ledger, 'status') !== statusFilter) return false

        return matchesSearch(search, [
            ledger.id,
            getTenantName(get(ledger, 'tenant')),
            get(ledger, 'status'),
            get(ledger, 'currencyCode'),
        ])
    }), [ledgers, search, statusFilter, tenantFilter])

    const columns = [
        { title: 'Ledger', key: 'ledger', render: (_, ledger) => renderLink(ledger.id, `/ledger/${ledger.id}`) },
        { title: 'Tenant', key: 'tenant', render: (_, ledger) => renderLink(getTenantName(get(ledger, 'tenant')), `/tenant/${get(ledger, ['tenant', 'id'])}`) },
        { title: 'Statement', key: 'statement', render: (_, ledger) => renderLink('Open', `/tenant/${get(ledger, ['tenant', 'id'])}/statement`) },
        { title: 'Currency', dataIndex: 'currencyCode', key: 'currencyCode' },
        { title: 'Status', key: 'status', render: (_, ledger) => <StatusTag status={get(ledger, 'status')} /> },
        { title: 'Entries', key: 'entries', render: (_, ledger) => get(ledger, 'entries', []).length },
        {
            title: 'Net Movement',
            key: 'balance',
            render: (_, ledger) => {
                const debits = get(ledger, 'entries', []).reduce((sum, entry) => get(entry, 'direction') === 'debit' ? sum + Number(get(entry, 'amount') || 0) : sum, 0)
                const credits = get(ledger, 'entries', []).reduce((sum, entry) => get(entry, 'direction') !== 'debit' ? sum + Number(get(entry, 'amount') || 0) : sum, 0)
                return formatMoney(intl, debits - credits, get(ledger, 'currencyCode'))
            },
        },
    ]

    return (
        <PageWrapper>
            <PageHeader title='Tenant Ledger / Statements' subTitle='Ledger-first tenant balances and history' />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        This screen shows tenant-ledger links and entry movement already persisted by the backend. A full running balance per statement line is shown only where backend data exposes enough context.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder='Search by ledger id, tenant, status, or currency' />
                            <Space wrap>
                                <Select allowClear showSearch placeholder='Tenant' value={tenantFilter} onChange={setTenantFilter} options={tenantOptions} style={{ minWidth: 220 }} />
                                <Select allowClear placeholder='Status' value={statusFilter} onChange={setStatusFilter} options={[
                                    { label: 'open', value: 'open' },
                                    { label: 'archived', value: 'archived' },
                                ]} style={{ minWidth: 180 }} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredLedgers} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
        </PageWrapper>
    )
}

LedgersPage.requiredAccess = OrganizationRequired

export default LedgersPage
