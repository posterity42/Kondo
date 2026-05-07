import { useMutation, useQuery } from '@apollo/client'
import { Alert, Card, Checkbox, Col, DatePicker, Form, InputNumber, Modal, Row, Select, Space as AntSpace, Table, notification } from 'antd'
import dayjs from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import { useRouter } from 'next/router'
import React, { useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { PageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { PageComponentType } from '@condo/domains/common/types'
import { renderLink } from '@condo/domains/common/utils/Renders'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import {
    formatDate,
    formatMoney,
    getPropertyName,
    getRentalUnitName,
    getTenantName,
    StatusTag,
} from '@condo/domains/property/components/RentalAdmin/utils'
import { getOccupancyLifecycleActions } from '@condo/domains/property/components/Rentals/utils'

const GET_OCCUPANCY = gql`
    query getOccupancyPage ($id: ID!, $organizationId: ID!) {
        occupancy: Occupancy(where: { id: $id }) {
            id
            status
            startDate
            expectedEndDate
            actualEndDate
            billingFrequency
            monthlyRate
            tenant {
                id
                user { id name phone email }
                ghanaCardNumber
                emergencyContactName
                emergencyContactPhone
                institutionName
                studentIdNumber
                programme
                level
            }
            property { id address addressKey }
            rentalUnit { id name unitType capacity defaultMonthlyRate parent { id name unitType } }
        }
        rentCharges: allRentCharges(
            where: { organization: { id: $organizationId }, occupancy: { id: $id }, deletedAt: null }
            sortBy: [billingMonth_DESC]
            first: 50
        ) {
            id
            billingMonth
            dueDate
            amount
            currencyCode
            status
        }
        payments: allPayments(
            where: { organization: { id: $organizationId }, occupancy: { id: $id }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: 50
        ) {
            id
            amount
            currencyCode
            paymentMethod
            provider
            status
            confirmedAt
            reversedAt
            receipt { id number }
        }
        receipts: allPaymentReceipts(
            where: { organization: { id: $organizationId }, payment: { occupancy: { id: $id } }, deletedAt: null }
            sortBy: [issuedAt_DESC]
            first: 50
        ) {
            id
            number
            amount
            currencyCode
            issuedAt
        }
        ledgerEntries: allLedgerEntries(
            where: { organization: { id: $organizationId }, occupancy: { id: $id }, deletedAt: null }
            sortBy: [postedAt_DESC]
            first: 50
        ) {
            id
            entryType
            direction
            amount
            currencyCode
            postedAt
            postingStatus
            description
            payment { id }
            receipt { id number }
            rentCharge { id }
        }
        ledgers: allTenantLedgers(
            where: { organization: { id: $organizationId }, deletedAt: null }
            first: 50
        ) {
            id
            status
            currencyCode
            tenant { id }
        }
        rentalUnits: allRentalUnits(
            where: { organization: { id: $organizationId }, deletedAt: null, rentable: true }
            sortBy: [name_ASC]
            first: 200
        ) {
            id
            name
            unitType
            property { id address addressKey }
        }
    }
`

const RENEW_OCCUPANCY = gql`
    mutation renewOccupancyFromOccupancyDetailPage ($data: RenewOccupancyInput!) {
        obj: renewOccupancy(data: $data) { id }
    }
`

const CHECK_OUT_OCCUPANCY = gql`
    mutation checkOutOccupancyFromOccupancyDetailPage ($data: CheckOutOccupancyInput!) {
        result: checkOutOccupancy(data: $data) {
            occupancy { id }
            arrears { amount currencyCode chargeCount }
        }
    }
`

const TRANSFER_OCCUPANCY = gql`
    mutation transferOccupancyFromOccupancyDetailPage ($data: TransferOccupancyInput!) {
        result: transferOccupancy(data: $data) {
            newOccupancy { id }
            previousArrears { amount currencyCode chargeCount }
        }
    }
`

const CANCEL_OCCUPANCY = gql`
    mutation cancelOccupancyFromOccupancyDetailPage ($data: CancelOccupancyInput!) {
        obj: cancelOccupancy(data: $data) { id }
    }
`

type ActionState = {
    type: 'renew' | 'checkOut' | 'transfer' | 'cancel'
} | null

const OccupancyPage: PageComponentType = () => {
    const intl = useIntl()
    const { query } = useRouter()
    const { organization, link } = useOrganization()
    const id = get(query, 'id')
    const organizationId = get(organization, 'id')
    const canManageProperties = get(link, ['role', 'canManageProperties'], false)
    const [form] = Form.useForm()
    const [actionState, setActionState] = useState<ActionState>(null)
    const { data, loading, error, refetch } = useQuery(GET_OCCUPANCY, {
        variables: { id, organizationId },
        skip: !id || !organizationId,
    })
    const [renewOccupancy, renewState] = useMutation(RENEW_OCCUPANCY)
    const [checkOutOccupancy, checkOutState] = useMutation(CHECK_OUT_OCCUPANCY)
    const [transferOccupancy, transferState] = useMutation(TRANSFER_OCCUPANCY)
    const [cancelOccupancy, cancelState] = useMutation(CANCEL_OCCUPANCY)

    if (loading || error) {
        return <LoadingOrErrorPage title='Tenancy' loading={loading} error={error?.message} />
    }

    const occupancy = get(data, 'occupancy')
    if (!occupancy) {
        return <LoadingOrErrorPage title='Tenancy' loading={false} error='Tenancy not found' />
    }

    const ledgers = get(data, 'ledgers', [])
    const rentalUnits = get(data, 'rentalUnits', [])
    const primaryLedger = ledgers.find(ledger => get(ledger, ['tenant', 'id']) === get(occupancy, ['tenant', 'id']))
    const actions = getOccupancyLifecycleActions(get(occupancy, 'status'), canManageProperties).filter(action => action !== 'checkIn')

    const openAction = (type) => {
        setActionState({ type })
        form.resetFields()
        form.setFieldsValue({
            expectedEndDate: get(occupancy, 'expectedEndDate') ? dayjs(get(occupancy, 'expectedEndDate')) : undefined,
            actualEndDate: dayjs(),
            monthlyRate: get(occupancy, 'monthlyRate') ? Number(get(occupancy, 'monthlyRate')) : undefined,
            billingFrequency: get(occupancy, 'billingFrequency'),
            createFinalCharges: true,
            transferDate: dayjs(),
        })
    }

    const closeAction = () => {
        setActionState(null)
        form.resetFields()
    }

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const sender = getClientSideSenderInfo()

        if (actionState?.type === 'renew') {
            await renewOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: occupancy.id,
                        expectedEndDate: values.expectedEndDate?.toISOString(),
                        monthlyRate: values.monthlyRate ? String(values.monthlyRate) : undefined,
                        billingFrequency: values.billingFrequency,
                    },
                },
            })
            notification.success({ message: 'Tenancy renewed' })
        }

        if (actionState?.type === 'checkOut') {
            const result = await checkOutOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: occupancy.id,
                        actualEndDate: values.actualEndDate?.toISOString(),
                        createFinalCharges: values.createFinalCharges,
                    },
                },
            })
            const arrears = get(result, ['data', 'result', 'arrears'])
            notification.success({ message: `Tenancy checked out${arrears ? ` with arrears ${arrears.amount} ${arrears.currencyCode}` : ''}` })
        }

        if (actionState?.type === 'transfer') {
            await transferOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: occupancy.id,
                        targetRentalUnitId: values.targetRentalUnitId,
                        transferDate: values.transferDate?.toISOString(),
                        expectedEndDate: values.expectedEndDate?.toISOString(),
                        monthlyRate: values.monthlyRate ? String(values.monthlyRate) : undefined,
                        billingFrequency: values.billingFrequency,
                        createFinalCharges: values.createFinalCharges,
                    },
                },
            })
            notification.success({ message: 'Tenancy transferred' })
        }

        if (actionState?.type === 'cancel') {
            await cancelOccupancy({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        occupancyId: occupancy.id,
                    },
                },
            })
            notification.success({ message: 'Tenancy canceled' })
        }

        closeAction()
        await refetch()
    }

    const chargeColumns = [
        { title: 'Billing Month', key: 'billingMonth', render: (_, charge) => formatDate(get(charge, 'billingMonth')) },
        { title: 'Due Date', key: 'dueDate', render: (_, charge) => formatDate(get(charge, 'dueDate')) },
        { title: 'Amount', key: 'amount', render: (_, charge) => formatMoney(intl, get(charge, 'amount'), get(charge, 'currencyCode')) },
        { title: 'Status', key: 'status', render: (_, charge) => <StatusTag status={get(charge, 'status')} /> },
        { title: 'View', key: 'view', render: (_, charge) => renderLink('Open', `/rentCharge/${charge.id}`) },
    ]

    const paymentColumns = [
        { title: 'Amount', key: 'amount', render: (_, payment) => formatMoney(intl, get(payment, 'amount'), get(payment, 'currencyCode')) },
        { title: 'Method', dataIndex: 'paymentMethod', key: 'paymentMethod' },
        { title: 'Provider', dataIndex: 'provider', key: 'provider' },
        { title: 'Confirmed At', key: 'confirmedAt', render: (_, payment) => formatDate(get(payment, 'confirmedAt')) },
        { title: 'Status', key: 'status', render: (_, payment) => <StatusTag status={get(payment, 'status')} /> },
        { title: 'Receipt', key: 'receipt', render: (_, payment) => get(payment, ['receipt', 'id']) ? renderLink(get(payment, ['receipt', 'number']) || get(payment, ['receipt', 'id']), `/receipt/${get(payment, ['receipt', 'id'])}`) : '—' },
        { title: 'View', key: 'view', render: (_, payment) => renderLink('Open', `/payment/${payment.id}`) },
    ]

    const ledgerColumns = [
        { title: 'Posted At', key: 'postedAt', render: (_, entry) => formatDate(get(entry, 'postedAt')) },
        { title: 'Type', dataIndex: 'entryType', key: 'entryType' },
        { title: 'Direction', dataIndex: 'direction', key: 'direction' },
        { title: 'Amount', key: 'amount', render: (_, entry) => formatMoney(intl, get(entry, 'amount'), get(entry, 'currencyCode')) },
        { title: 'Posting Status', dataIndex: 'postingStatus', key: 'postingStatus' },
        { title: 'Charge', key: 'charge', render: (_, entry) => get(entry, ['rentCharge', 'id']) ? renderLink(get(entry, ['rentCharge', 'id']), `/rentCharge/${get(entry, ['rentCharge', 'id'])}`) : '—' },
        { title: 'Payment', key: 'payment', render: (_, entry) => get(entry, ['payment', 'id']) ? renderLink(get(entry, ['payment', 'id']), `/payment/${get(entry, ['payment', 'id'])}`) : '—' },
        { title: 'Receipt', key: 'receipt', render: (_, entry) => get(entry, ['receipt', 'id']) ? renderLink(get(entry, ['receipt', 'number']) || get(entry, ['receipt', 'id']), `/receipt/${get(entry, ['receipt', 'id'])}`) : '—' },
        { title: 'Description', dataIndex: 'description', key: 'description' },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title={`Tenancy ${occupancy.id}`}
                subTitle={getTenantName(get(occupancy, 'tenant'))}
                extra={[
                    renderLink('View tenant', `/tenant/${get(occupancy, ['tenant', 'id'])}`),
                    renderLink('Statement', `/tenancy/${occupancy.id}/statement`),
                    renderLink('Record payment', `/payment?mode=record&tenantId=${get(occupancy, ['tenant', 'id'])}&occupancyId=${occupancy.id}&propertyId=${get(occupancy, ['property', 'id'])}&rentalUnitId=${get(occupancy, ['rentalUnit', 'id'])}`),
                    ...(primaryLedger ? [renderLink('Open ledger', `/ledger/${primaryLedger.id}`)] : []),
                    ...actions.map(action => (
                        <Button key={action} type='secondary' onClick={() => openAction(action)}>
                            {action}
                        </Button>
                    )),
                ]}
            />
            <PageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Alert
                        type='info'
                        showIcon
                        message='Operational hub'
                        description='Use this screen to review the tenant, billing, ledger, payments, receipts, and lifecycle actions for the current tenancy.'
                    />
                    <Row gutter={[24, 24]}>
                        <Col xs={24} md={8}>
                            <Card title='Tenant Summary'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Name: {getTenantName(get(occupancy, 'tenant'))}</Typography.Text>
                                    <Typography.Text>Phone: {get(occupancy, ['tenant', 'user', 'phone']) || '—'}</Typography.Text>
                                    <Typography.Text>Email: {get(occupancy, ['tenant', 'user', 'email']) || '—'}</Typography.Text>
                                    <Typography.Text>Ghana Card: {get(occupancy, ['tenant', 'ghanaCardNumber']) || '—'}</Typography.Text>
                                    <Typography.Text>Emergency Contact: {get(occupancy, ['tenant', 'emergencyContactName']) || '—'}</Typography.Text>
                                    <Typography.Text>Emergency Phone: {get(occupancy, ['tenant', 'emergencyContactPhone']) || '—'}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Unit / Room / Bed Summary'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Unit / Room / Bed: {getRentalUnitName(intl, get(occupancy, 'rentalUnit'))}</Typography.Text>
                                    <Typography.Text>Property: {getPropertyName(get(occupancy, 'property'))}</Typography.Text>
                                    <Typography.Text>Unit Type: {get(occupancy, ['rentalUnit', 'unitType']) || '—'}</Typography.Text>
                                    <Typography.Text>Parent Unit: {get(occupancy, ['rentalUnit', 'parent', 'name']) || '—'}</Typography.Text>
                                    <Typography.Text>Capacity: {get(occupancy, ['rentalUnit', 'capacity']) || '—'}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={8}>
                            <Card title='Billing & Ledger Summary'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Text>Status: <StatusTag status={get(occupancy, 'status')} /></Typography.Text>
                                    <Typography.Text>Start Date: {formatDate(get(occupancy, 'startDate'))}</Typography.Text>
                                    <Typography.Text>Expected End: {formatDate(get(occupancy, 'expectedEndDate'))}</Typography.Text>
                                    <Typography.Text>Billing Frequency: {get(occupancy, 'billingFrequency') || '—'}</Typography.Text>
                                    <Typography.Text>Monthly Rate: {formatMoney(intl, get(occupancy, 'monthlyRate'))}</Typography.Text>
                                    <Typography.Text>Ledger: {primaryLedger ? renderLink(primaryLedger.id, `/ledger/${primaryLedger.id}`) : 'No tenant ledger linked yet'}</Typography.Text>
                                    <Typography.Text>Statement: {renderLink('Open tenancy statement', `/tenancy/${occupancy.id}/statement`)}</Typography.Text>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                    {!get(data, 'rentCharges', []).length && (
                        <Alert
                            type='warning'
                            showIcon
                            message='No rent charges are currently linked to this tenancy'
                            description='If charges were expected, the current backend flow did not auto-generate them for this check-in yet.'
                        />
                    )}
                    <Card title='Rent Charges'>
                        <Table rowKey='id' columns={chargeColumns} dataSource={get(data, 'rentCharges', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Payments'>
                        <Table rowKey='id' columns={paymentColumns} dataSource={get(data, 'payments', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                    <Card title='Receipts'>
                        <Table
                            rowKey='id'
                            columns={[
                                { title: 'Receipt', key: 'number', render: (_, receipt) => renderLink(get(receipt, 'number') || receipt.id, `/receipt/${receipt.id}`) },
                                { title: 'Issued At', key: 'issuedAt', render: (_, receipt) => formatDate(get(receipt, 'issuedAt')) },
                                { title: 'Amount', key: 'amount', render: (_, receipt) => formatMoney(intl, get(receipt, 'amount'), get(receipt, 'currencyCode')) },
                            ]}
                            dataSource={get(data, 'receipts', [])}
                            pagination={false}
                            scroll={{ x: true }}
                        />
                    </Card>
                    <Card title='Ledger / Statement Entries'>
                        <Table rowKey='id' columns={ledgerColumns} dataSource={get(data, 'ledgerEntries', [])} pagination={false} scroll={{ x: true }} />
                    </Card>
                </Space>
            </PageContent>
            <Modal
                destroyOnClose
                open={!!actionState}
                title={`Tenancy ${actionState?.type}`}
                onCancel={closeAction}
                onOk={handleSubmit}
                confirmLoading={renewState.loading || checkOutState.loading || transferState.loading || cancelState.loading}
            >
                <Form form={form} layout='vertical'>
                    {actionState?.type === 'renew' && (
                        <>
                            <Form.Item name='expectedEndDate' label='New Expected End Date' rules={[{ required: true, message: 'Select a new end date' }]}>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='billingFrequency' label='Billing Frequency' style={{ flex: 1 }}>
                                    <Select options={[{ label: 'monthly', value: 'monthly' }, { label: 'annual', value: 'annual' }]} />
                                </Form.Item>
                                <Form.Item name='monthlyRate' label='Monthly Rate (GHS)' style={{ flex: 1 }}>
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                        </>
                    )}
                    {actionState?.type === 'checkOut' && (
                        <>
                            <Form.Item name='actualEndDate' label='Actual End Date' rules={[{ required: true, message: 'Select check-out date' }]}>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name='createFinalCharges' valuePropName='checked'>
                                <Checkbox>Create final charges during check-out</Checkbox>
                            </Form.Item>
                        </>
                    )}
                    {actionState?.type === 'transfer' && (
                        <>
                            <Form.Item name='targetRentalUnitId' label='Target Unit / Room / Bed' rules={[{ required: true, message: 'Select the destination unit' }]}>
                                <Select showSearch options={rentalUnits.filter(unit => unit.id !== get(occupancy, ['rentalUnit', 'id'])).map(unit => ({
                                    label: `${getRentalUnitName(intl, unit)} (${getPropertyName(get(unit, 'property'))})`,
                                    value: unit.id,
                                }))} />
                            </Form.Item>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='transferDate' label='Transfer Date' rules={[{ required: true, message: 'Select transfer date' }]} style={{ flex: 1 }}>
                                    <DatePicker style={{ width: '100%' }} />
                                </Form.Item>
                                <Form.Item name='expectedEndDate' label='Expected End Date' style={{ flex: 1 }}>
                                    <DatePicker style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                            <AntSpace size={16} style={{ display: 'flex' }}>
                                <Form.Item name='billingFrequency' label='Billing Frequency' style={{ flex: 1 }}>
                                    <Select options={[{ label: 'monthly', value: 'monthly' }, { label: 'annual', value: 'annual' }]} />
                                </Form.Item>
                                <Form.Item name='monthlyRate' label='Monthly Rate (GHS)' style={{ flex: 1 }}>
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </AntSpace>
                            <Form.Item name='createFinalCharges' valuePropName='checked'>
                                <Checkbox>Create final charges during transfer</Checkbox>
                            </Form.Item>
                        </>
                    )}
                    {actionState?.type === 'cancel' && (
                        <Typography.Text type='secondary'>
                            This cancels a planned tenancy only. No frontend accounting logic is introduced here.
                        </Typography.Text>
                    )}
                </Form>
            </Modal>
        </PageWrapper>
    )
}

OccupancyPage.requiredAccess = OrganizationRequired

export default OccupancyPage
