import React from 'react'

import { useAuth } from '@open-condo/next/auth'

import { AccessDeniedPage } from '@condo/domains/common/components/containers/AccessDeniedPage'
import { AuthRequired } from '@condo/domains/common/components/containers/AuthRequired'


const ResidentPortalRequiredContent: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { user } = useAuth()

    if (user?.type !== 'resident') {
        return <AccessDeniedPage />
    }

    return <>{children}</>
}

export const ResidentPortalRequired: React.FC<React.PropsWithChildren> = ({ children }) => {
    return (
        <AuthRequired>
            <ResidentPortalRequiredContent>
                {children}
            </ResidentPortalRequiredContent>
        </AuthRequired>
    )
}
