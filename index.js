const axios = require('axios')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const requestIp = require('request-ip')
const services = require('./modules/services.js')
const midjourney = require('./modules/midjourney')
const app = express()
const path = require("path");

app.use(requestIp.mw())
app.use(bodyParser.json({limit: '10mb'}))
app.use(cors({origin: '*'}))
app.use(express.json());
app.use(express.urlencoded({extended: true}));


axios.interceptors.request.use(request => {
    request.maxContentLength = Infinity;
    request.maxBodyLength = Infinity;
    return request;
})

const port = process.env.PORT || 8000
app.listen(port, async () => {
    midjourney(app, await services(app))
    console.log(`App running on *: http//:127.0.0.1:${port}`)
})