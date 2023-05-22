const midjourney = require('./midjourney.js')
const requests = {}
module.exports = async (app) => {
    const gptServices = {}

    app.all('/:type/chat', async (req, res) => {
        const type = req.params['type']
        const service = gptServices[type]
        if (service) {
            requests[req.clientIp] = new Date().getTime()
            const prompt = req.query['prompt'] || req.body['prompt']
            const conversationId = req.query['conversation'] || req.body['conversation']
            try {
                console.log(`Requesting [${type}] with [${prompt}]`)
                const result = await service.conversation(prompt, conversationId, req.body['options'])
                res.send({
                    text: result.response,
                    conversation: result.conversationId
                })
            } catch (e) {
                console.error(`Cannot process [${prompt}]`, e.message)
                res.status(500).send(e.message)
            } finally {
                delete requests[req.clientIp]
            }
        } else {
            res.status(404).send(`${type} GPT service was not found`)
        }
    })

    return Object.assign({
        midjourney: await midjourney(app),
    }, gptServices)
}
