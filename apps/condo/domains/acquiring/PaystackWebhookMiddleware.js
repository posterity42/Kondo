const express = require('express')

const { expressErrorHandler } = require('@open-condo/keystone/utils/errors/expressErrorHandler')

const {
    PAYSTACK_WEBHOOK_PATH,
    PaystackWebhookRouter,
} = require('@condo/domains/acquiring/routes/paystackWebhookRouter')

class PaystackWebhookMiddleware {
    async prepareMiddleware ({ keystone }) {
        // this public webhook route accepts provider callbacks and does not rely on browser cookies or csrf state
        // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
        const app = express()
        const router = new PaystackWebhookRouter({ keystone })

        app.post(
            PAYSTACK_WEBHOOK_PATH,
            express.raw({ type: '*/*', limit: '1mb' }),
            router.handleRequest.bind(router)
        )

        app.use(expressErrorHandler)

        return app
    }
}

module.exports = {
    PaystackWebhookMiddleware,
}
