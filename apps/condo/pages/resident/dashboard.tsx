import Head from 'next/head'
import React from 'react'

import { PageContent, PageHeader, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { PageComponentType } from '@condo/domains/common/types'
import { ResidentPortalDashboard } from '@condo/domains/resident/components/ResidentPortalDashboard'
import { ResidentPortalRequired } from '@condo/domains/resident/components/ResidentPortalRequired'


const ResidentDashboardPage: PageComponentType = () => {
    return (
        <>
            <Head>
                <title>Tenant Portal</title>
            </Head>
            <PageWrapper>
                <PageHeader title='Tenant Portal' subTitle='Your occupancy, statement, payments, receipts, and service requests' />
                <PageContent>
                    <ResidentPortalDashboard />
                </PageContent>
            </PageWrapper>
        </>
    )
}

ResidentDashboardPage.requiredAccess = ResidentPortalRequired

export default ResidentDashboardPage
