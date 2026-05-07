import { useMutation, useQuery } from '@apollo/client'
import { Col, Form, Input, Row, Select, notification } from 'antd'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import React, { useMemo } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Space, Typography } from '@open-condo/ui'

import { AccessDeniedPage } from '@condo/domains/common/components/containers/AccessDeniedPage'
import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { FormWithAction } from '@condo/domains/common/components/containers/FormList'
import { Loader } from '@condo/domains/common/components/Loader'
import { PhoneInput } from '@condo/domains/common/components/PhoneInput'
import { useValidations } from '@condo/domains/common/hooks/useValidations'
import { PageComponentType } from '@condo/domains/common/types'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'
import { PageError, getPropertyName } from '@condo/domains/property/components/RentalAdmin/utils'


const GET_TENANT_CREATE_PAGE = gql`
    query getTenantCreatePage ($organizationId: ID!) {
        properties: allProperties(
            where: { organization: { id: $organizationId }, deletedAt: null }
            sortBy: [address_ASC]
            first: 300
        ) {
            id
            address
            addressKey
        }
    }
`

const CREATE_ADMIN_TENANT_PROFILE = gql`
    mutation createAdminTenantProfileFromPage ($data: CreateAdminTenantProfileInput!) {
        tenant: createAdminTenantProfile(data: $data) {
            id
            property { id address }
            user { id name phone email }
            ghanaCardNumber
            emergencyContactName
            emergencyContactPhone
        }
    }
`

const TenantCreatePageContent: React.FC = () => {
    const router = useRouter()
    const { organization, link } = useOrganization()
    const organizationId = get(organization, 'id')
    const canManageResidents = get(link, ['role', 'canManageResidents'], false)
    const redirectTo = typeof router.query.redirectTo === 'string' ? router.query.redirectTo : null
    const initialPropertyId = typeof router.query.propertyId === 'string' ? router.query.propertyId : undefined
    const [form] = Form.useForm()
    const { changeMessage, emailValidator, phoneValidator, requiredValidator, specCharValidator, trimValidator } = useValidations({ allowLandLine: true })

    const { data, loading, error } = useQuery(GET_TENANT_CREATE_PAGE, {
        variables: { organizationId },
        skip: !organizationId,
        fetchPolicy: 'cache-and-network',
    })
    const [createAdminTenantProfile] = useMutation(CREATE_ADMIN_TENANT_PROFILE)

    const properties = get(data, 'properties', [])
    const propertyOptions = useMemo(() => properties.map(property => ({
        label: getPropertyName(property),
        value: property.id,
    })), [properties])

    if (!canManageResidents) {
        return <AccessDeniedPage />
    }

    const validations = {
        name: [
            changeMessage(trimValidator, 'Tenant full name is required'),
            changeMessage(specCharValidator, 'Tenant full name contains invalid characters'),
        ],
        phone: [requiredValidator, phoneValidator],
        email: [changeMessage(emailValidator, 'Email is not valid')],
        propertyId: [{ required: true, message: 'Select the property for this tenant profile' }],
        emergencyContactPhone: [phoneValidator],
    }

    const handleSubmit = async (values: Record<string, string | null | undefined>) => {
        const result = await createAdminTenantProfile({
            variables: {
                data: {
                    dv: 1,
                    sender: getClientSideSenderInfo(),
                    organizationId,
                    propertyId: values.propertyId,
                    name: values.name,
                    phone: values.phone,
                    email: values.email || null,
                    ghanaCardNumber: values.ghanaCardNumber || null,
                    emergencyContactName: values.emergencyContactName || null,
                    emergencyContactPhone: values.emergencyContactPhone || null,
                    institutionName: values.institutionName || null,
                    studentIdNumber: values.studentIdNumber || null,
                },
            },
        })

        const tenant = get(result, ['data', 'tenant'])
        const tenantId = get(tenant, 'id')
        const createdPropertyId = get(tenant, ['property', 'id']) || values.propertyId

        notification.success({
            message: 'Tenant created',
            description: 'The tenant profile was created without requiring a contact or resident pre-step.',
        })

        if (redirectTo && tenantId) {
            const params = new URLSearchParams()
            params.set('tenantId', tenantId)
            if (createdPropertyId) {
                params.set('propertyId', createdPropertyId)
            }

            await router.push(`${redirectTo}${redirectTo.includes('?') ? '&' : '?'}${params.toString()}`)
            return
        }

        await router.push('/tenant')
    }

    return (
        <>
            <Head>
                <title>Create Tenant</title>
            </Head>
            <PageWrapper>
                <PageHeader
                    title='Create Tenant'
                    subTitle='Create a rental tenant profile directly'
                    extra={[
                        <Link key='back-to-tenants' href='/tenant'>
                            <Button type='secondary'>Back to Tenants</Button>
                        </Link>,
                    ]}
                />
                <PageContent>
                    <Space direction='vertical' size={24} width='100%'>
                        <Typography.Text type='secondary'>
                            Choose the property this tenant belongs to. You can assign a tenancy from the tenant detail page after saving.
                        </Typography.Text>
                        <PageError error={error} />
                        {loading && <Loader />}
                        {!loading && (
                            <FormWithAction
                                form={form}
                                action={handleSubmit}
                                layout='vertical'
                                initialValues={{ propertyId: initialPropertyId }}
                            >
                                {({ handleSave, isLoading }) => (
                                    <Row gutter={[24, 24]}>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='propertyId' label='Property' rules={validations.propertyId}>
                                                <Select
                                                    showSearch
                                                    options={propertyOptions}
                                                    placeholder='Select property'
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='name' label='Full Name' rules={validations.name} required>
                                                <Input placeholder='Tenant full name' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='phone' label='Phone' rules={validations.phone} required>
                                                <PhoneInput placeholder='Tenant phone number' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='email' label='Email' rules={validations.email}>
                                                <Input placeholder='Optional email address' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='ghanaCardNumber' label='Ghana Card / ID'>
                                                <Input placeholder='Optional Ghana Card or ID number' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='emergencyContactName' label='Emergency Contact Name'>
                                                <Input placeholder='Optional emergency contact name' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='emergencyContactPhone' label='Emergency Contact Phone' rules={validations.emergencyContactPhone}>
                                                <PhoneInput placeholder='Optional emergency contact phone' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='institutionName' label='Institution'>
                                                <Input placeholder='Optional institution or employer' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} lg={16}>
                                            <Form.Item name='studentIdNumber' label='Student ID'>
                                                <Input placeholder='Optional student ID number' />
                                            </Form.Item>
                                        </Col>
                                        <Col span={24}>
                                            <Space size={16}>
                                                <Button type='primary' onClick={handleSave} loading={isLoading}>
                                                    Create Tenant
                                                </Button>
                                                <Link href={redirectTo || '/tenant'}>
                                                    <Button type='secondary'>Cancel</Button>
                                                </Link>
                                            </Space>
                                        </Col>
                                    </Row>
                                )}
                            </FormWithAction>
                        )}
                    </Space>
                </PageContent>
            </PageWrapper>
        </>
    )
}

const TenantCreatePage: PageComponentType = () => {
    return <TenantCreatePageContent />
}

TenantCreatePage.requiredAccess = OrganizationRequired

export default TenantCreatePage
