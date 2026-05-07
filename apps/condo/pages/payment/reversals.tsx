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
import { DEFAULT_PAGE_SIZE, PageError, formatDate, formatMoney, getTenantName, isDateInRange, matchesSearch, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_PAYMENT_REVERSALS = gql`
    query getPaymentReversalsPage ($organizationId: ID!) {
        payments: allPayments(
            where: { organization: { id: $organizationId }, deletedAt: null, reversedAt_not: null }
            sortBy: [reversedAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            amount
            currencyCode
            paymentMethod
            provider
            reference
            externalTransactionId
            status
            reversalReason
            reversedAt
            reversedBy { id name }
            tenant { id user { id name phone } }
            receipt { id number }
            reversalLedgerEntry { id }
        }
    }
`

const PaymentReversalsPage: PageComponentType = () => {
    const intl = useIntl()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [search, setSearch] = useState('')
    const [reversedByFilter, setReversedByFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
    const { data, loading, error } = useQuery(GET_PAYMENT_REVERSALS, {
        variables: { organizationId },
        skip: !organizationId,
    })

    const payments = get(data, 'payments', [])
    const reversedByOptions = useMemo(() => Array.from(new Map(
        payments
            .filter(payment => get(payment, ['reversedBy', 'id']))
            .map(payment => [get(payment, ['reversedBy', 'id']), {
                label: get(payment, ['reversedBy', 'name']) || get(payment, ['reversedBy', 'id']),
                value: get(payment, ['reversedBy', 'id']),
            }])
    ).values()), [payments])

    const filteredPayments = useMemo(() => {
        const [startDate, endDate] = dateRange || []

        return payments.filter(payment => {
            if (reversedByFilter && get(payment, ['reversedBy', 'id']) !== reversedByFilter) return false
            if (!isDateInRange(get(payment, 'reversedAt'), startDate, endDate)) return false

            return matchesSearch(search, [
                getTenantName(get(payment, 'tenant')),
                get(payment, 'reference'),
                get(payment, 'externalTransactionId'),
                get(payment, 'reversalReason'),
                get(payment, ['reversedBy', 'name']),
                get(payment, 'paymentMethod'),
                get(payment, 'provider'),
            ])
        })
    }, [dateRange, payments, reversedByFilter, search])

    const columns = [
        { title: 'Payment', key: 'payment', render: (_, payment) => renderLink(payment.id, `/payment/${payment.id}`) },
        { title: 'Tenant', key: 'tenant', render: (_, payment) => renderLink(getTenantName(get(payment, 'tenant')), `/tenant/${get(payment, ['tenant', 'id'])}`) },
        { title: 'Amount', key: 'amount', render: (_, payment) => formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode')) },
        { title: 'Method / Ref', key: 'reference', render: (_, payment) => `${get(payment, 'paymentMethod') || '—'} • ${get(payment, 'reference') || get(payment, 'externalTransactionId') || '—'}` },
        { title: 'Reason', dataIndex: 'reversalReason', key: 'reversalReason' },
        { title: 'Reversed By', key: 'reversedBy', render: (_, payment) => get(payment, ['reversedBy', 'name']) || '—' },
        { title: 'Reversed At', key: 'reversedAt', render: (_, payment) => formatDate(get(payment, 'reversedAt')) },
        { title: 'Receipt', key: 'receipt', render: (_, payment) => get(payment, ['receipt', 'id']) ? renderLink(get(payment, ['receipt', 'number']) || get(payment, ['receipt', 'id']), `/receipt/${get(payment, ['receipt', 'id'])}`) : '—' },
        { title: 'Ledger', key: 'ledger', render: (_, payment) => get(payment, ['reversalLedgerEntry', 'id']) || '—' },
        { title: 'Status', key: 'status', render: (_, payment) => <StatusTag status={get(payment, 'status')} /> },
    ]

    return (
        <PageWrapper>
            <PageHeader title='Payment Reversals' subTitle='Read-only report of reversed rent payments' />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        This report only shows reversal metadata already exposed by backend payment records. Raw provider payloads are intentionally not displayed.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder='Search by tenant, reference, reason, provider, or reversed by' />
                            <Space wrap>
                                <Select allowClear placeholder='Reversed By' value={reversedByFilter} onChange={setReversedByFilter} options={reversedByOptions} style={{ minWidth: 220 }} />
                                <DatePicker.RangePicker value={dateRange || undefined} onChange={value => setDateRange(value as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredPayments} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
        </PageWrapper>
    )
}

PaymentReversalsPage.requiredAccess = OrganizationRequired

export default PaymentReversalsPage
