import { useMutation, useQuery } from '@apollo/client'
import { Alert, Form, Input, Modal, Select, Switch, Table, notification } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { TablePageContent } from '@condo/domains/common/components/containers/BaseLayout/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { DEFAULT_PAGE_SIZE, PageError } from '@condo/domains/property/components/RentalAdmin/utils'

const GET_PROVIDER_CREDENTIALS = gql`
    query getPaymentProviderCredentialsPage ($organizationId: ID!) {
        credentials: allPaymentProviderCredentials(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [createdAt_DESC]
            first: ${DEFAULT_PAGE_SIZE}
        ) {
            id
            provider
            environment
            publicKey
            currency
            initiationEnabled
            verificationEnabled
            webhookEnabled
            isEnabled
        }
    }
`

const CREATE_PROVIDER_CREDENTIAL = gql`
    mutation createPaymentProviderCredentialFromAdminPage ($data: PaymentProviderCredentialCreateInput!) {
        obj: createPaymentProviderCredential(data: $data) { id }
    }
`

const UPDATE_PROVIDER_CREDENTIAL = gql`
    mutation updatePaymentProviderCredentialFromAdminPage ($id: ID!, $data: PaymentProviderCredentialUpdateInput!) {
        obj: updatePaymentProviderCredential(id: $id, data: $data) { id }
    }
`

const PROVIDER_OPTIONS = [
    { label: 'Paystack', value: 'paystack' },
]

const ENVIRONMENT_OPTIONS = [
    { label: 'Test', value: 'test' },
    { label: 'Live', value: 'live' },
]

const PaymentProviderSettingsPage: PageComponentType = () => {
    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')
    const [form] = Form.useForm()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedCredential, setSelectedCredential] = useState<Record<string, unknown> | null>(null)

    const { data, loading, error, refetch } = useQuery(GET_PROVIDER_CREDENTIALS, {
        variables: { organizationId },
        skip: !organizationId,
    })
    const [createCredential, createState] = useMutation(CREATE_PROVIDER_CREDENTIAL)
    const [updateCredential, updateState] = useMutation(UPDATE_PROVIDER_CREDENTIAL)

    const credentials = get(data, 'credentials', [])

    const openCreate = () => {
        setSelectedCredential(null)
        form.resetFields()
        form.setFieldsValue({
            provider: 'paystack',
            environment: 'test',
            currency: 'GHS',
            isEnabled: true,
            initiationEnabled: true,
            verificationEnabled: true,
            webhookEnabled: true,
        })
        setIsModalOpen(true)
    }

    const openEdit = (credential) => {
        setSelectedCredential(credential)
        form.setFieldsValue({
            provider: get(credential, 'provider'),
            environment: get(credential, 'environment'),
            publicKey: get(credential, 'publicKey'),
            currency: get(credential, 'currency'),
            isEnabled: get(credential, 'isEnabled'),
            initiationEnabled: get(credential, 'initiationEnabled'),
            verificationEnabled: get(credential, 'verificationEnabled'),
            webhookEnabled: get(credential, 'webhookEnabled'),
            secretKey: undefined,
            webhookSecret: undefined,
        })
        setIsModalOpen(true)
    }

    const handleSubmit = async () => {
        const values = await form.validateFields()
        const data = {
            dv: 1,
            sender: getClientSideSenderInfo(),
            organization: { connect: { id: organizationId } },
            provider: values.provider,
            environment: values.environment,
            publicKey: values.publicKey,
            currency: values.currency || 'GHS',
            initiationEnabled: values.initiationEnabled,
            verificationEnabled: values.verificationEnabled,
            webhookEnabled: values.webhookEnabled,
            isEnabled: values.isEnabled,
            ...(values.secretKey ? { secretKey: values.secretKey } : {}),
            ...(values.webhookSecret ? { webhookSecret: values.webhookSecret } : {}),
        }

        if (selectedCredential?.id) {
            await updateCredential({ variables: { id: selectedCredential.id, data } })
            notification.success({ message: 'Payment provider settings updated' })
        } else {
            await createCredential({ variables: { data } })
            notification.success({ message: 'Payment provider settings created' })
        }

        setIsModalOpen(false)
        await refetch()
    }

    const columns = [
        { title: 'Provider', dataIndex: 'provider', key: 'provider' },
        { title: 'Environment', dataIndex: 'environment', key: 'environment' },
        { title: 'Currency', dataIndex: 'currency', key: 'currency' },
        { title: 'Public Key', key: 'publicKey', render: (_, credential) => get(credential, 'publicKey') || '—' },
        { title: 'Enabled', key: 'isEnabled', render: (_, credential) => get(credential, 'isEnabled') ? 'Yes' : 'No' },
        { title: 'Initiation', key: 'initiationEnabled', render: (_, credential) => get(credential, 'initiationEnabled') ? 'Yes' : 'No' },
        { title: 'Verification', key: 'verificationEnabled', render: (_, credential) => get(credential, 'verificationEnabled') ? 'Yes' : 'No' },
        { title: 'Webhook', key: 'webhookEnabled', render: (_, credential) => get(credential, 'webhookEnabled') ? 'Yes' : 'No' },
        { title: 'Actions', key: 'actions', render: (_, credential) => <Button type='secondary' onClick={() => openEdit(credential)}>Edit</Button> },
    ]

    return (
        <PageWrapper>
            <PageHeader
                title='Organisation Payment Settings'
                subTitle='Payment provider credentials and Ghana rent payment controls'
                extra={[
                    <Button key='create-provider-setting' type='primary' onClick={openCreate}>Add Provider</Button>,
                ]}
            />
            <TablePageContent>
                <Space direction='vertical' size={24} width='100%'>
                    <Typography.Text type='secondary'>
                        Saved secret keys and webhook secrets are write-only. This screen never renders stored secrets or raw provider payloads.
                    </Typography.Text>
                    <Alert
                        type='info'
                        showIcon
                        message='Provider availability'
                        description='Paystack is currently the only configurable credential provider exposed by the schema in this admin UI. Hubtel and manual collection flows remain operational elsewhere but are not configurable here yet.'
                    />
                    <Alert
                        type='info'
                        showIcon
                        message='Ghana payment settings'
                        description='Use GHS credentials, keep secrets write-only, and review initiation, verification, and webhook toggles carefully for test versus live environments.'
                    />
                    <PageError error={error} />
                    <Table rowKey='id' loading={loading} columns={columns} dataSource={credentials} pagination={false} scroll={{ x: true }} />
                </Space>
            </TablePageContent>
            <Modal
                destroyOnClose
                open={isModalOpen}
                title={selectedCredential ? 'Edit Payment Provider' : 'Add Payment Provider'}
                onCancel={() => setIsModalOpen(false)}
                onOk={handleSubmit}
                confirmLoading={createState.loading || updateState.loading}
            >
                <Form form={form} layout='vertical'>
                    <Form.Item name='provider' label='Provider' rules={[{ required: true, message: 'Select a provider' }]}>
                        <Select options={PROVIDER_OPTIONS} />
                    </Form.Item>
                    <Form.Item name='environment' label='Environment' rules={[{ required: true, message: 'Select environment' }]}>
                        <Select options={ENVIRONMENT_OPTIONS} />
                    </Form.Item>
                    <Form.Item name='currency' label='Currency' rules={[{ required: true, message: 'Currency is required' }]}>
                        <Input disabled />
                    </Form.Item>
                    <Form.Item name='publicKey' label='Public Key / Client ID'>
                        <Input />
                    </Form.Item>
                    <Form.Item name='secretKey' label='Secret Key / Client Secret'>
                        <Input.Password placeholder={selectedCredential ? 'Leave blank to keep current secret' : undefined} />
                    </Form.Item>
                    <Form.Item name='webhookSecret' label='Webhook Secret'>
                        <Input.Password placeholder={selectedCredential ? 'Leave blank to keep current secret' : undefined} />
                    </Form.Item>
                    <Form.Item name='isEnabled' label='Enabled' valuePropName='checked'>
                        <Switch />
                    </Form.Item>
                    <Form.Item name='initiationEnabled' label='Initiation Enabled' valuePropName='checked'>
                        <Switch />
                    </Form.Item>
                    <Form.Item name='verificationEnabled' label='Verification Enabled' valuePropName='checked'>
                        <Switch />
                    </Form.Item>
                    <Form.Item name='webhookEnabled' label='Webhook Enabled' valuePropName='checked'>
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </PageWrapper>
    )
}

PaymentProviderSettingsPage.requiredAccess = OrganizationRequired

export default PaymentProviderSettingsPage
