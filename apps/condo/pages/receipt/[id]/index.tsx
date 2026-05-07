import { useQuery } from '@apollo/client'
import { Card, Col, Row, Table } from 'antd'
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
import { formatDate, formatMoney, getTenantName } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_RECEIPT = gql`
    query getReceiptPage ($id: ID!, $organizationId: ID!) {
        receipt: PaymentReceipt(where: { id: $id }) {
            id
            number
            amount
            currencyCode
            issuedAt
            paymentMethod
            provider
            reference
            balanceAfterPayment
            tenant { id user { id name phone } }
            payment { id amount currencyCode paymentMethod provider confirmedAt }
            ledgerEntries(first: 50, sortBy: [postedAt_DESC], where: { deletedAt: null }) {
                id
                entryType
                direction
                amount
                currencyCode
                postedAt
                description
            }
        }
    }
`

const ReceiptPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const { data, loading, error } = useQuery(GET_RECEIPT, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })

    if (loading || error) {
        return <LoadingOrErrorPage title='Receipt' loading={loading} error={error?.message} />
    }

    const receipt = get(data, 'receipt')
    if (!receipt) {
        return <LoadingOrErrorPage title='Receipt' loading={false} error='Receipt not found' />
    }

    const ledgerColumns = [
        { title: 'Posted At', key: 'postedAt', render: (_, entry) => formatDate(get(entry, 'postedAt')) },
        { title: 'Entry Type', dataIndex: 'entryType', key: 'entryType' },
        { title: 'Direction', dataIndex: 'direction', key: 'direction' },
        { title: 'Amount', key: 'amount', render: (_, entry) => formatMoney(intl, get(entry, 'amount'), get(entry, 'currencyCode')) },
        { title: 'Description', dataIndex: 'description', key: 'description' },
    ]

    return (
        <PageWrapper>
            <PageHeader title={get(receipt, 'number') || `Receipt ${receipt.id}`} subTitle='Payment receipt' />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={12}>
                            <Card title='Receipt'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Tenant: {getTenantName(get(receipt, 'tenant'))}</Typography.Text>
                                    <Typography.Text>Amount: {formatMoney(intl, get(receipt, 'amount'), get(receipt, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Issued At: {formatDate(get(receipt, 'issuedAt'))}</Typography.Text>
                                    <Typography.Text>Method: {get(receipt, 'paymentMethod') || '—'}</Typography.Text>
                                    <Typography.Text>Provider: {get(receipt, 'provider') || '—'}</Typography.Text>
                                    <Typography.Text>Reference: {get(receipt, 'reference') || '—'}</Typography.Text>
                                    <Typography.Text>Balance After Payment: {formatMoney(intl, get(receipt, 'balanceAfterPayment'), get(receipt, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Statement: {get(receipt, ['tenant', 'id']) ? renderLink('Open tenant statement', `/tenant/${get(receipt, ['tenant', 'id'])}/statement`) : '—'}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={12}>
                            <Card title='Payment Linkage'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Payment: {renderLink(get(receipt, ['payment', 'id']) || '—', `/payment/${get(receipt, ['payment', 'id'])}`)}</Typography.Text>
                                    <Typography.Text>Confirmed At: {formatDate(get(receipt, ['payment', 'confirmedAt']))}</Typography.Text>
                                    <Typography.Text>Payment Amount: {formatMoney(intl, get(receipt, ['payment', 'amount']), get(receipt, ['payment', 'currencyCode']))}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                    <Card title='Receipt Ledger Entries'>
                        <Table rowKey='id' columns={ledgerColumns} dataSource={get(receipt, 'ledgerEntries', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
        </PageWrapper>
    )
}

ReceiptPage.requiredAccess = OrganizationRequired

export default ReceiptPage
