import { useMutation, useQuery } from '@apollo/client'
import { Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table, notification } from 'antd'
import dayjs from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Link from 'next/link'
import { useRouter } from 'next/router'
import React, { useEffect, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import {
    DEFAULT_PAGE_SIZE,
    PageError,
    formatDate,
    formatMoney,
    getPropertyName,
    getRentalUnitName,
    getTenantName,
    isDateInRange,
    matchesSearch,
    StatusTag,
} from '@condo/domains/property/components/RentalAdmin/utils'

const PAYMENT_FIELDS = `
    id
    amount
    currencyCode
    paymentMethod
    provider
    reference
    externalTransactionId
    depositedDate
    confirmedAt
    reversedAt
    reversalReason
    status
    tenant { id user { id name phone } }
    occupancy { id }
    property { id address addressKey }
    rentalUnit { id name unitType }
    receipt { id number }
`

const GET_PAYMENTS = gql`
    query getPaymentsPage ($organizationId: ID!) {
        payments: allPayments(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            ${PAYMENT_FIELDS}
        }
        tenants: allResidents(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            user { id name phone }
            currentOccupancy { id }
            property { id address addressKey }
        }
        occupancies: allOccupancies(
            where: { organization: { id: $organizationId }, deletedAt: null, status_in: [planned, active] }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            tenant { id user { id name phone } }
            property { id address addressKey }
            rentalUnit { id name unitType }
        }
        rentalUnits: allRentalUnits(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [name_ASC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            name
            unitType
        }
        properties: allProperties(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [address_ASC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            address
            addressKey
        }
    }
`

const RECORD_MANUAL_PAYMENT = gql`
    mutation recordManualRentPaymentFromPaymentsPage ($data: RecordManualRentPaymentInput!) {
        result: recordManualRentPayment(data: $data) {
            payment { id }
            receipt { id number reference }
            ledgerBalance
        }
    }
`

const PAYMENT_METHOD_OPTIONS = [
    { label: 'Cash', value: 'cash' },
    { label: 'Bank Transfer', value: 'bank_transfer' },
    { label: 'Mobile Money', value: 'momo' },
    { label: 'Card', value: 'card' },
]

const REVERSED_FILTER_OPTIONS = [
    { label: 'All payments', value: 'all' },
    { label: 'Not reversed', value: 'not_reversed' },
    { label: 'Reversed only', value: 'reversed' },
]

const PaymentsPage: PageComponentType = () => {
    const intl = useIntl()
    const router = useRouter()
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [form] = Form.useForm()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>()
    const [methodFilter, setMethodFilter] = useState<string | undefined>()
    const [providerFilter, setProviderFilter] = useState<string | undefined>()
    const [tenantFilter, setTenantFilter] = useState<string | undefined>()
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
    const [reversedFilter, setReversedFilter] = useState('all')

    const { data, loading, error, refetch } = useQuery(GET_PAYMENTS, {
        variables: { organizationId },
        skip: !organizationId,
        fetchPolicy: 'cache-and-network',
    })
    const [recordManualPayment, recordState] = useMutation(RECORD_MANUAL_PAYMENT)

    const payments = get(data, 'payments', [])
    const tenants = get(data, 'tenants', [])
    const occupancies = get(data, 'occupancies', [])
    const rentalUnits = get(data, 'rentalUnits', [])
    const properties = get(data, 'properties', [])

    const tenantOptions = useMemo(() => tenants.map(tenant => ({ label: getTenantName(tenant), value: tenant.id })), [tenants])
    const occupancyOptions = useMemo(() => occupancies.map(occupancy => ({ label: `${getTenantName(get(occupancy, 'tenant'))} - ${getRentalUnitName(intl, get(occupancy, 'rentalUnit'))}`, value: occupancy.id })), [intl, occupancies])
    const rentalUnitOptions = useMemo(() => rentalUnits.map(unit => ({ label: getRentalUnitName(intl, unit), value: unit.id })), [intl, rentalUnits])
    const propertyOptions = useMemo(() => properties.map(property => ({ label: getPropertyName(property), value: property.id })), [properties])

    const filteredPayments = useMemo(() => {
        const [startDate, endDate] = dateRange || []

        return payments.filter(payment => {
            if (statusFilter && get(payment, 'status') !== statusFilter) return false
            if (methodFilter && get(payment, 'paymentMethod') !== methodFilter) return false
            if (providerFilter && get(payment, 'provider') !== providerFilter) return false
            if (tenantFilter && get(payment, ['tenant', 'id']) !== tenantFilter) return false
            if (reversedFilter === 'reversed' && !get(payment, 'reversedAt')) return false
            if (reversedFilter === 'not_reversed' && get(payment, 'reversedAt')) return false
            if (!isDateInRange(get(payment, 'confirmedAt') || get(payment, 'depositedDate'), startDate, endDate)) return false

            return matchesSearch(search, [
                getTenantName(get(payment, 'tenant')),
                get(payment, ['tenant', 'user', 'phone']),
                get(payment, 'reference'),
                get(payment, 'externalTransactionId'),
                get(payment, 'paymentMethod'),
                get(payment, 'provider'),
                getPropertyName(get(payment, 'property')),
                getRentalUnitName(intl, get(payment, 'rentalUnit')),
            ])
        })
    }, [dateRange, intl, methodFilter, payments, providerFilter, reversedFilter, search, statusFilter, tenantFilter])

    useEffect(() => {
        if (!router.isReady) return
        if (get(router.query, 'mode') !== 'record') return

        form.setFieldsValue({
            tenantId: get(router.query, 'tenantId') || undefined,
            occupancyId: get(router.query, 'occupancyId') || undefined,
            propertyId: get(router.query, 'propertyId') || undefined,
            rentalUnitId: get(router.query, 'rentalUnitId') || undefined,
            paymentMethod: 'cash',
            receivedDate: dayjs(),
        })
        setIsModalOpen(true)
    }, [form, router.isReady, router.query])

    const openPaymentModal = () => {
        form.resetFields()
        form.setFieldsValue({ paymentMethod: 'cash', receivedDate: dayjs() })
        setIsModalOpen(true)
    }

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const result = await recordManualPayment({
            variables: {
                data: {
                    dv: 1,
                    sender: getClientSideSenderInfo(),
                    organization: { id: organizationId },
                    tenant: { id: values.tenantId },
                    ...(values.occupancyId ? { occupancy: { id: values.occupancyId } } : {}),
                    ...(values.propertyId ? { property: { id: values.propertyId } } : {}),
                    ...(values.rentalUnitId ? { rentalUnit: { id: values.rentalUnitId } } : {}),
                    amount: String(values.amount),
                    paymentMethod: values.paymentMethod,
                    reference: values.reference,
                    depositedDate: values.receivedDate?.toISOString(),
                    confirmedAt: values.receivedDate?.toISOString(),
                    purpose: values.notes,
                },
            },
        })

        const receipt = get(result, ['data', 'result', 'receipt'])
        notification.success({
            message: 'Manual payment recorded',
            description: receipt ? `Receipt ${receipt.number || receipt.reference || receipt.id} created` : undefined,
        })
        setIsModalOpen(false)
        form.resetFields()
        await refetch()

        if (router.query.mode) {
            await router.replace('/payment', undefined, { shallow: true })
        }
    }

    const columns = [
        {
            title: 'Payment',
            key: 'payment',
            render: (_, payment) => renderLink(payment.id, `/payment/${payment.id}`),
        },
        {
            title: 'Tenant',
            key: 'tenant',
            render: (_, payment) => renderLink(getTenantName(get(payment, 'tenant')), `/tenant/${get(payment, ['tenant', 'id'])}`),
        },
        {
            title: 'Unit / Room / Bed',
            key: 'rentalUnit',
            render: (_, payment) => getRentalUnitName(intl, get(payment, 'rentalUnit')),
        },
        {
            title: 'Amount',
            key: 'amount',
            render: (_, payment) => formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode')),
        },
        { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod' },
        { title: 'Provider', dataIndex: 'provider', key: 'provider' },
        { title: 'Reference', key: 'reference', render: (_, payment) => get(payment, 'reference') || get(payment, 'externalTransactionId') || '—' },
        { title: 'Received Date', key: 'depositedDate', render: (_, payment) => formatDate(get(payment, 'depositedDate') || get(payment, 'confirmedAt')) },
        { title: 'Status', key: 'status', render: (_, payment) => <StatusTag status={get(payment, 'status')} /> },
        { title: 'Receipt', key: 'receipt', render: (_, payment) => get(payment, ['receipt', 'id']) ? renderLink(get(payment, ['receipt', 'number']) || get(payment, ['receipt', 'id']), `/receipt/${get(payment, ['receipt', 'id'])}`) : '—' },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title='Payments'
                subTitle='Manual, provider, and reversed rent payments'
                extra={[
                    <Link key='reversals-report' href='/payment/reversals'>
                        <Button type='secondary'>Reversals Report</Button>
                    </Link>,
                    <Button key='record-payment' type='primary' onClick={openPaymentModal}>Record Manual Payment</Button>,
                ]}
            />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        Payments refresh from existing backend services only. This screen does not mutate charges directly.
                    </Typography.Text>
                    <Card title='Filters' size='small'>
                        <Space direction='vertical' size={12} width='100%'>
                            <Input
                                allowClear
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                placeholder='Search by tenant, reference, unit, property, method, or provider'
                            />
                            <Space wrap>
                                <Select allowClear placeholder='Status' value={statusFilter} onChange={setStatusFilter} options={[
                                    { label: 'CREATED', value: 'CREATED' },
                                    { label: 'PROCESSING', value: 'PROCESSING' },
                                    { label: 'DONE', value: 'DONE' },
                                    { label: 'REVERSED', value: 'REVERSED' },
                                    { label: 'ERROR', value: 'ERROR' },
                                ]} style={{ minWidth: 180 }} />
                                <Select allowClear placeholder='Method' value={methodFilter} onChange={setMethodFilter} options={PAYMENT_METHOD_OPTIONS} style={{ minWidth: 180 }} />
                                <Select allowClear placeholder='Provider' value={providerFilter} onChange={setProviderFilter} options={Array.from(new Set(payments.map(payment => get(payment, 'provider')).filter(Boolean))).map(provider => ({ label: provider, value: provider }))} style={{ minWidth: 180 }} />
                                <Select allowClear showSearch placeholder='Tenant' value={tenantFilter} onChange={setTenantFilter} options={tenantOptions} style={{ minWidth: 220 }} />
                                <Select value={reversedFilter} onChange={setReversedFilter} options={REVERSED_FILTER_OPTIONS} style={{ minWidth: 180 }} />
                                <DatePicker.RangePicker value={dateRange || undefined} onChange={value => setDateRange(value as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)} />
                            </Space>
                        </Space>
                    </Card>
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={filteredPayments} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
            <Modal
                destroyOnClose
                open={isModalOpen}
                title='Record Manual Payment'
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSubmit}
                confirmLoading={recordState.loading}
            >
                <Form form={form} layout='vertical'>
                    <Form.Item name='tenantId' label='Tenant' rules={[{ required: true, message: 'Select a tenant' }]}>
                        <Select showSearch options={tenantOptions} />
                    </Form.Item>
                    <Form.Item name='occupancyId' label='Tenancy'>
                        <Select allowClear showSearch options={occupancyOptions} />
                    </Form.Item>
                    <Form.Item name='propertyId' label='Property'>
                        <Select allowClear showSearch options={propertyOptions} />
                    </Form.Item>
                    <Form.Item name='rentalUnitId' label='Unit / Room / Bed'>
                        <Select allowClear showSearch options={rentalUnitOptions} />
                    </Form.Item>
                    <Form.Item name='amount' label='Amount (GHS)' rules={[{ required: true, message: 'Enter the payment amount' }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name='paymentMethod' label='Payment Method' rules={[{ required: true, message: 'Select a payment method' }]}>
                        <Select options={PAYMENT_METHOD_OPTIONS} />
                    </Form.Item>
                    <Form.Item name='reference' label='Reference'>
                        <Input placeholder='Cash receipt no. / bank ref / MoMo txn id' />
                    </Form.Item>
                    <Form.Item name='receivedDate' label='Received Date' rules={[{ required: true, message: 'Select received date' }]}>
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name='notes' label='Notes'>
                        <Input.TextArea rows={3} placeholder='Optional notes or payment purpose' />
                    </Form.Item>
                    <Typography.Text type='secondary'>
                        Allocation preview is not exposed by the current backend mutation, so this form submits directly to the existing payment recording service and then refreshes the resulting receipt and ledger state.
                    </Typography.Text>
                </Form>
            </Modal>
        </PageWrapper>
    )
}

PaymentsPage.requiredAccess = OrganizationRequired

export default PaymentsPage
