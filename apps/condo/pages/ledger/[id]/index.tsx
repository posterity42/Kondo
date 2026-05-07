import { useQuery } from '@apollo/client'
import { Card, Table } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'
import React from 'react'

import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Space, Typography } from '@open-condo/ui'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { formatDate, formatMoney, getTenantName, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_LEDGER = gql`
    query getLedgerPage ($id: ID!) {
        ledger: TenantLedger(where: { id: $id }) {
            id
            currencyCode
            status
            tenant { id user { id name phone } }
            entries(first: 200, sortBy: [postedAt_DESC], where: { deletedAt: null }) {
                id
                entryType
                direction
                amount
                currencyCode
                postedAt
                postingStatus
                description
                rentCharge { id }
                payment { id }
                receipt { id number }
            }
        }
    }
`

const LedgerPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const { data, loading, error } = useQuery(GET_LEDGER, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Ledger' loading={loading} error={error?.message} />
    }

    const ledger = get(data, 'ledger')
    if (!ledger) {
        return <LoadingOrErrorPage title='Ledger' loading={false} error='Ledger not found' />
    }

    const entries = get(ledger, 'entries', [])
    const runningBalance = entries.reduceRight((acc, entry) => {
        const amount = Number(get(entry, 'amount') || 0)
        return get(entry, 'direction') === 'debit' ? acc + amount : acc - amount
    }, 0)

    const columns = [
        { title: 'Posted At', key: 'postedAt', render: (_, entry) => formatDate(get(entry, 'postedAt')) },
        { title: 'Entry Type', dataIndex: 'entryType', key: 'entryType' },
        { title: 'Direction', dataIndex: 'direction', key: 'direction' },
        { title: 'Amount', key: 'amount', render: (_, entry) => formatMoney(intl, get(entry, 'amount'), get(entry, 'currencyCode')) },
        { title: 'Posting Status', dataIndex: 'postingStatus', key: 'postingStatus' },
        { title: 'Rent Charge', key: 'rentCharge', render: (_, entry) => get(entry, ['rentCharge', 'id']) ? renderLink(get(entry, ['rentCharge', 'id']), `/rentCharge/${get(entry, ['rentCharge', 'id'])}`) : '—' },
        { title: 'Payment', key: 'payment', render: (_, entry) => get(entry, ['payment', 'id']) ? renderLink(get(entry, ['payment', 'id']), `/payment/${get(entry, ['payment', 'id'])}`) : '—' },
        { title: 'Receipt', key: 'receipt', render: (_, entry) => get(entry, ['receipt', 'id']) ? renderLink(get(entry, ['receipt', 'number']) || get(entry, ['receipt', 'id']), `/receipt/${get(entry, ['receipt', 'id'])}`) : '—' },
        { title: 'Description', dataIndex: 'description', key: 'description' },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title={`Ledger ${ledger.id}`}
                subTitle={getTenantName(get(ledger, 'tenant'))}
                extra={[
                    renderLink('Tenant statement', `/tenant/${get(ledger, ['tenant', 'id'])}/statement`),
                ]}
            />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Card title='Ledger Summary'>
                        <Space direction='vertical' size={8}>
                            <Typography.Text>Tenant: {getTenantName(get(ledger, 'tenant'))}</Typography.Text>
                            <Typography.Text>Currency: {get(ledger, 'currencyCode')}</Typography.Text>
                            <Typography.Text>Status: <StatusTag status={get(ledger, 'status')} /></Typography.Text>
                            <Typography.Text>Running Balance: {formatMoney(intl, runningBalance, get(ledger, 'currencyCode'))}</Typography.Text>
                        </Space>
                    </Card>
                    <Card title='Statement Entries'>
                        <Table rowKey='id' columns={columns} dataSource={entries} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

LedgerPage.requiredAccess = OrganizationRequired

export default LedgerPage
