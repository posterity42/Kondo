import { useMutation, useQuery } from '@apollo/client'
import { Card, Col, Form, Input, Modal, Row, Table, notification } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'
import React, { useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { formatDate, formatMoney, getPropertyName, getRentalUnitName, getTenantName, StatusTag } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_PAYMENT = gql`
    query getPaymentPage ($id: ID!, $organizationId: ID!) {
        payment: Payment(where: { id: $id }) {
            id
            amount
            currencyCode
            paymentMethod
            provider
            externalTransactionId
            depositedDate
            confirmedAt
            purpose
            status
            reference
            reversalReason
            reversedAt
            reversedBy { id name }
            receipt { id number }
            reversalLedgerEntry { id }
            tenant { id user { id name phone } }
            occupancy { id }
            property { id address addressKey }
            rentalUnit { id name unitType }
            allocations(first: 50, sortBy: [allocatedAt_DESC], where: { deletedAt: null }) {
                id
                amount
                currencyCode
                allocatedAt
                rentCharge { id billingMonth dueDate status amount currencyCode }
            }
            ledgerEntries(first: 50, sortBy: [postedAt_DESC], where: { deletedAt: null }) {
                id
                entryType
                direction
                amount
                currencyCode
                postedAt
                postingStatus
                description
                receipt { id number }
                rentCharge { id }
            }
        }
        receipts: allPaymentReceipts(
            where: { organization: { id: $organizationId }, payment: { id: $id }, deletedAt: null }
            first: 10
            sortBy: [issuedAt_DESC]
        ) {
            id
            number
            amount
            currencyCode
            issuedAt
            paymentMethod
            provider
            reference
            balanceAfterPayment
        }
    }
`

const REVERSE_MANUAL_PAYMENT = gql`
    mutation reverseManualRentPaymentFromPaymentPage ($data: ReverseManualRentPaymentInput!) {
        result: reverseManualRentPayment(data: $data) {
            payment { id status reversedAt reversalReason }
            ledgerBalance
        }
    }
`

const PaymentPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const [form] = Form.useForm()
    const [isModalOpen, setIsModalOpen] = useState(false)

    const { data, loading, error, refetch } = useQuery(GET_PAYMENT, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })
    const [reversePayment, reverseState] = useMutation(REVERSE_MANUAL_PAYMENT)
    const payment = get(data, 'payment')
    const allocationTotal = useMemo(() => get(payment, 'allocations', []).reduce((sum, allocation) => sum + Number(get(allocation, 'amount') || 0), 0), [payment])

    if (loading || error) {
        return <LoadingOrErrorPage title='Payment' loading={loading} error={error?.message} />
    }

    if (!payment) {
        return <LoadingOrErrorPage title='Payment' loading={false} error='Payment not found' />
    }

    const canReverse = get(payment, 'provider') === 'manual' && !get(payment, 'reversedAt') && get(payment, 'status') !== 'REVERSED'

    const receiptColumns = [
        { title: 'Receipt', key: 'number', render: (_, receipt) => renderLink(get(receipt, 'number') || receipt.id, `/receipt/${receipt.id}`) },
        { title: 'Issued At', key: 'issuedAt', render: (_, receipt) => formatDate(get(receipt, 'issuedAt')) },
        { title: 'Amount', key: 'amount', render: (_, receipt) => formatMoney(intl, get(receipt, 'amount'), get(receipt, 'currencyCode')) },
        { title: 'Balance After Payment', key: 'balanceAfterPayment', render: (_, receipt) => formatMoney(intl, get(receipt, 'balanceAfterPayment'), get(receipt, 'currencyCode')) },
    ]

    const allocationColumns = [
        { title: 'Allocated At', key: 'allocatedAt', render: (_, allocation) => formatDate(get(allocation, 'allocatedAt')) },
        { title: 'Amount', key: 'amount', render: (_, allocation) => formatMoney(intl, get(allocation, 'amount'), get(allocation, 'currencyCode')) },
        { title: 'Rent Charge', key: 'charge', render: (_, allocation) => renderLink(get(allocation, ['rentCharge', 'id']), `/rentCharge/${get(allocation, ['rentCharge', 'id'])}`) },
        { title: 'Charge Status', key: 'status', render: (_, allocation) => <StatusTag status={get(allocation, ['rentCharge', 'status'])} /> },
    ]

    const ledgerColumns = [
        { title: 'Posted At', key: 'postedAt', render: (_, entry) => formatDate(get(entry, 'postedAt')) },
        { title: 'Entry Type', dataIndex: 'entryType', key: 'entryType' },
        { title: 'Direction', dataIndex: 'direction', key: 'direction' },
        { title: 'Amount', key: 'amount', render: (_, entry) => formatMoney(intl, get(entry, 'amount'), get(entry, 'currencyCode')) },
        { title: 'Posting Status', dataIndex: 'postingStatus', key: 'postingStatus' },
        { title: 'Charge', key: 'rentCharge', render: (_, entry) => get(entry, ['rentCharge', 'id']) ? renderLink(get(entry, ['rentCharge', 'id']), `/rentCharge/${get(entry, ['rentCharge', 'id'])}`) : '—' },
        { title: 'Receipt', key: 'receipt', render: (_, entry) => get(entry, ['receipt', 'id']) ? renderLink(get(entry, ['receipt', 'number']) || get(entry, ['receipt', 'id']), `/receipt/${get(entry, ['receipt', 'id'])}`) : '—' },
        { title: 'Description', dataIndex: 'description', key: 'description' },
    ]

    const handleReverse = async () => {
        const values = await form.validateFields()
        await reversePayment({
            variables: {
                data: {
                    dv: 1,
                    sender: getClientSideSenderInfo(),
                    organization: { id: organizationId },
                    payment: { id: payment.id },
                    reason: values.reason,
                },
            },
        })
        notification.success({ message: 'Payment reversed' })
        setIsModalOpen(false)
        await refetch()
    }

    return (
        <PageWrapper>
            <PageHeader
                title={`Payment ${payment.id}`}
                subTitle='Rent payment detail'
                extra={[
                    renderLink('Back to payments', '/payment'),
                    renderLink('Reversals report', '/payment/reversals'),
                    get(payment, ['tenant', 'id']) ? renderLink('Tenant statement', `/tenant/${get(payment, ['tenant', 'id'])}/statement`) : null,
                    get(payment, ['occupancy', 'id']) ? renderLink('Tenancy statement', `/tenancy/${get(payment, ['occupancy', 'id'])}/statement`) : null,
                    ...(canReverse ? [
                        <Button key='reverse-payment' type='secondary' onClick={() => setIsModalOpen(true)}>Reverse Payment</Button>,
                    ] : []),
                ].filter(Boolean)}
            />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={8}>
                            <Card title='Payment Summary'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Tenant: {renderLink(getTenantName(get(payment, 'tenant')), `/tenant/${get(payment, ['tenant', 'id'])}`)}</Typography.Text>
                                    <Typography.Text>Property: {getPropertyName(get(payment, 'property'))}</Typography.Text>
                                    <Typography.Text>Unit / Room / Bed: {getRentalUnitName(intl, get(payment, 'rentalUnit'))}</Typography.Text>
                                    <Typography.Text>Tenancy: {get(payment, ['occupancy', 'id']) ? renderLink(get(payment, ['occupancy', 'id']), `/tenancy/${get(payment, ['occupancy', 'id'])}`) : '—'}</Typography.Text>
                                    <Typography.Text>Amount: {formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode'))}</Typography.Text>
                                    <Typography.Text>Status: <StatusTag status={get(payment, 'status')} /></Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Collection Details'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Method: {get(payment, 'paymentMethod') || '—'}</Typography.Text>
                                    <Typography.Text>Provider: {get(payment, 'provider') || '—'}</Typography.Text>
                                    <Typography.Text>Reference: {get(payment, 'reference') || get(payment, 'externalTransactionId') || '—'}</Typography.Text>
                                    <Typography.Text>Received Date: {formatDate(get(payment, 'depositedDate') || get(payment, 'confirmedAt'))}</Typography.Text>
                                    <Typography.Text>Purpose: {get(payment, 'purpose') || '—'}</Typography.Text>
                                    <Typography.Text>Linked Receipt: {get(payment, ['receipt', 'id']) ? renderLink(get(payment, ['receipt', 'number']) || get(payment, ['receipt', 'id']), `/receipt/${get(payment, ['receipt', 'id'])}`) : '—'}</Typography.Text>
                                    <Typography.Text>Statement: {get(payment, ['occupancy', 'id']) ? renderLink('Open tenancy statement', `/tenancy/${get(payment, ['occupancy', 'id'])}/statement`) : renderLink('Open tenant statement', `/tenant/${get(payment, ['tenant', 'id'])}/statement`)}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Reversal State'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Reversed At: {formatDate(get(payment, 'reversedAt'))}</Typography.Text>
                                    <Typography.Text>Reason: {get(payment, 'reversalReason') || '—'}</Typography.Text>
                                    <Typography.Text>Reversed By: {get(payment, ['reversedBy', 'name']) || '—'}</Typography.Text>
                                    <Typography.Text>Reversal Ledger Entry: {get(payment, ['reversalLedgerEntry', 'id']) || '—'}</Typography.Text>
                                    {!canReverse && <Typography.Text type='secondary'>Reversal action is hidden unless this payment is currently reversible.</Typography.Text>}
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                    <Card title='Allocation Breakdown'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Typography.Text type='secondary'>
                                Allocated total: {formatMoney(intl, allocationTotal, get(payment, 'currencyCode'))}
                            </Typography.Text>
                            <Table rowKey='id' columns={allocationColumns} dataSource={get(payment, 'allocations', [])} pagination={false} scroll={{ x: true }} />
                        </Space>
                    </Card>
                    <Card title='Receipts'>
                        <Table rowKey='id' columns={receiptColumns} dataSource={get(data, 'receipts', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Ledger Impact'>
                        <Table rowKey='id' columns={ledgerColumns} dataSource={get(payment, 'ledgerEntries', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
            <Modal
                destroyOnClose
                open={isModalOpen}
                title='Reverse Manual Payment'
                okText='Reverse Payment'
                okButtonProps={{ danger: true }}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleReverse}
                confirmLoading={reverseState.loading}
            >
                <Typography.Paragraph>
                    This will call the existing payment reversal service, create compensating ledger entries, and refresh receipts and allocations.
                </Typography.Paragraph>
                <Typography.Paragraph>
                    Original payment: {formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode'))} via {get(payment, 'paymentMethod')} on {formatDate(get(payment, 'confirmedAt') || get(payment, 'depositedDate'))}
                </Typography.Paragraph>
                <Form form={form} layout='vertical'>
                    <Form.Item name='reason' label='Reversal Reason' rules={[{ required: true, message: 'Provide a reason for the reversal' }]}>
                        <Input.TextArea rows={4} />
                    </Form.Item>
                </Form>
            </Modal>
        </PageWrapper>
    )
}

PaymentPage.requiredAccess = OrganizationRequired

export default PaymentPage
