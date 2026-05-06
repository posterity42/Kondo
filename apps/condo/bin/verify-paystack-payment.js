const {
    runPaystackVerificationSmoke,
} = require('../domains/acquiring/utils/serverSchema/paymentProviders/PaystackVerificationSmoke')

function printJson (payload) {
    console.log(JSON.stringify(payload, null, 2))
}

async function main (args) {
    const [providerReference = null] = args
    const result = await runPaystackVerificationSmoke({
        providerReference,
    })

    if (result.skipped) {
        printJson({
            status: 'skipped',
            ...result,
        })

        return
    }

    printJson({
        status: 'ok',
        ...result,
    })
}

main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
        console.error(JSON.stringify({
            status: 'error',
            name: error.name || 'Error',
            code: error.code || null,
            provider: error.provider || 'paystack',
            operation: error.operation || null,
            field: error.field || null,
            message: error.message,
        }, null, 2))
        process.exit(1)
    },
)
