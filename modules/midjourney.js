const fs = require('fs')
const redis = require('./redis.js')
const sqlite = require('./sqlite.js')
const {get_now_date,addDaysToDate} = require('./untils.js')
const crypto = require('crypto')
const {Client, MessageAttachment} = require('discord.js-selfbot-v13')
const path = require('path');
const url = require('url');
const {use} = require("express/lib/router");
const midjourneyBotId = '936929561302675456'
const listeners = []

let jobs
let queue
let progress
let sessions_redis
let sessions = [];

function callJobListeners(job) {
    listeners.forEach(listener => listener(job))
}

const SESSIONS_FILE = path.join(__dirname, 'token_channels.json');

const getSessionsFile = function () {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

async function getJobId(message) {
    const s = message.indexOf('#id:')
    const e = message.indexOf('#', s + 1)
    if (s !== -1 && e > s) {
        return message.substring(s + 4, e)
    }
}

async function findJob(message) {
    const id = await getJobId(message)
    return jobs.get(id)
}

async function findDescJob(message) {
    let _url
    try {
        _url = message.embeds[0].image.url
    } catch (e) {
        return null
    }

    const parsedUrl = url.parse(_url);
    const imagename = path.basename(parsedUrl.pathname);
    return jobs.get(imagename.split('.')[0])
}

async function schedule(task) {
    queue.push(task)
}

async function extractJobInfo(messages) {
    const regex = /#id:([\w-]+)[^()]*\(([\d.]+)%/
    let match
    try {
        match = regex.exec(messages.content)
    } catch (e) {
        match = null
    }

    if (match) {
        const url = messages.attachments.first().url
        progress.set(match[1], {id: match[1], percentage: match[2], image_url: url}, 600)
    } else {
        return null
    }
}

function getCurrentTimestamp() {
    return new Date().getTime()
}

async function runTask(task) {
    if (task) {
        let channel
        console.log(task)
        channel = sessions.find(sess => sess.client_id === task.client_id)?.channel;
        if (task.prompt) {
            try {
                await channel.sendSlash(midjourneyBotId, 'imagine', task.prompt)
            } catch (e) {
                console.error(`[Midjourney] cannot run prompt "${task.prompt}"`, e.message)
            }
        } else if (task.actionId && task.imageId) {
            try {
                const msg = await channel.messages.fetch(task.imageId)
                await msg.clickButton(task.actionId)
            } catch (e) {
                console.error(`[Midjourney] cannot run action ${task.actionId} on image ${task.imageId}`, e.message)
            }
        } else if (task.imagePath && task.imageName) {
            try {
                console.log(task.imagePath)
                const _image = new MessageAttachment(fs.readFileSync(task.imagePath), task.imageName)
                await channel.sendSlash(midjourneyBotId, 'describe', _image)
            } catch (e) {
                console.error(`[Midjourney] cannot run prompt "${task.imagePath}"`, e.message)
            }
        }
    }
}

async function runAction(imageId, actionId, channel, client_id) {
    const msg = await channel.messages.fetch(imageId);
    const job = msg && (await findJob(msg.content));
    if (job) {
        await schedule({imageId: imageId, actionId: actionId, client_id: client_id});
        job.tasks += 1;
        jobs.set(job.id, job);
    }
    return job;
}

async function runJob(job) {

    job = Object.assign(job, {id: crypto.randomBytes(10).toString('hex'), tasks: 1, images: []});
    job.prompt = job.prompt.replaceAll('—', '--');
    let cidx = job.prompt.indexOf('--');
    if (cidx === -1) cidx = job.prompt.length;
    const prompt = job.prompt.substring(0, cidx) + `, #id:${job.id}# ` + job.prompt.substring(cidx);
    jobs.set(job.id, job);
    await schedule({prompt: prompt, client_id: job.client_id});
    return job;
}

async function rundescJob(job) {
    job = Object.assign(job, {desc: []});
    jobs.set(job.id, job);
    await schedule({imagePath: job.imagePath, imageName: job.imageName, id: job.id, client_id: job.client_id});
    return job;
}

async function getJob(id) {
    return jobs.get(id);
}

async function getAvailableDevice() {
    const sessions_redis = await redis('midjourney-sessions');
    const devices = await sessions_redis.redisclient.keys("midjourney-sessions:channel_id*");
    const devicesList = [];
    for (const device of devices) {
        let status
        const id = device.replace("midjourney-sessions:", "")
        const channelID = (await sessions_redis.hget(id, "channel_id")).toString();
        const patternType = (await sessions_redis.hget(id, "pattern_type")).toString();
        status = (await sessions_redis.hget(id, "status")).toString();
        const count = (await sessions_redis.hget(id, "count")).toString();
        const time = (await sessions_redis.hget(id, "time")).toString();
        if (status === "queued") {
            if (getCurrentTimestamp() - parseInt(time) > 120000) {
                status = "idle"
                sessions_redis.hset(id, "status", "idle");
            }
        } else if (status === "full") {
            if (getCurrentTimestamp() - parseInt(time) > 300000) {
                status = "idle"
                sessions_redis.hset(id, "status", "idle");
            }
        }

        const item = {
            "device": id.toString(), "channelID": channelID, "patternType": patternType,
            "status": status, "count": count, "time": time
        };
        devicesList.push(item);
    }
    return devicesList

}

async function getBestFastEntry(type) {
    const dataList = await getAvailableDevice()
    const fastEntries = dataList.filter(entry => entry.patternType === type);
    const statusOrder = {idle: 0, queue: 1, full: 2};
    const sortedEntries = fastEntries.sort((a, b) =>
        (statusOrder[a.status] - statusOrder[b.status]) || (parseInt(a.count) - parseInt(b.count))
    );
    return sortedEntries[0] || null;
}

//积分校验
async function checkScore() {
    const data = await sqlite.query("SELECT j.token, j.job_id, ABS(j.tasks - COUNT(ji.images_url)) as difference\n" +
        "FROM jobs j\n" +
        "LEFT JOIN job_images ji ON j.job_id = ji.job_id\n" +
        "WHERE j.tasks IS NOT NULL and j.score_flag=0\n" +
        "GROUP BY j.job_id\n")
    for (const row of data) {
        const token = row.token
        const job_id = row.job_id
        const difference = row.difference
        if (difference === 0) {
            await sqlite.update(`UPDATE jobs
                                 SET score_flag=1
                                 WHERE job_id = '${job_id}'`)

        } else {
            await updateTokenCount(token, 'token_count', '+', parseInt(difference))
            await sqlite.update(`UPDATE jobs
                                 SET score_flag=1,
                                     update_time='${get_now_date()}'
                                 WHERE job_id = '${job_id}'`)
        }
    }
    console.log(data)
}

//job id查询积分校验
async function checkJobScore(job_id) {
    const data = await sqlite.query(`
        SELECT t.token,
               t.job_id,
               COUNT(DISTINCT i.id)                AS num_images,
               t.tasks,
               ABS(COUNT(DISTINCT i.id) - t.tasks) as diff
        FROM jobs t
                 LEFT JOIN job_images i ON t.job_id = i.job_id
        WHERE t.tasks IS NOT NULL
          And t.score_flag = 0
          And t.job_id = '${job_id}'
        GROUP BY t.token, t.job_id, t.tasks;`)

    for (const row of data) {
        const token = row.token
        const job_id = row.job_id
        const diff = row.diff
        if (diff === 0) {
            await sqlite.update(`UPDATE jobs
                                 SET score_flag=1,
                                     update_time='${get_now_date()}'
                                 WHERE job_id = '${job_id}'`)
        } else {
            await updateTokenCount(token, 'token_count', '+', parseInt(diff))
            await sqlite.update(`UPDATE jobs
                                 SET score_flag=1,
                                     update_time='${get_now_date()}'
                                 WHERE job_id = '${job_id}'`)

        }
    }
    console.log(data)
}

checkScore()

async function getTokenCount(token_id) {
    let count;
    let token_type;
    let user_type;
    try {
        const sql = `SELECT token_count, token_type, user_type
                     FROM users_token
                     WHERE token_count > 0
                       AND expiration_time >= datetime('now', 'localtime')
                       AND token = '${token_id}';`;
        const data = await sqlite.query(sql);
        if (data.length > 0) {
            count = data[0].token_count;
            token_type = data[0].token_type;
            user_type = data[0].user_type;
            if (user_type === '1' && count < 25) {
                token_type = 'relax';
            } else if (user_type === '1' && count >= 25) {
                token_type = 'fast';
            } else if (user_type === '2' && count < 50) {
                token_type = 'relax';
            } else if (user_type === '2' && count >= 50) {
                token_type = 'fast';
            } else if (user_type === '3' && count < 250) {
                token_type = 'relax';
            } else if (user_type === '3' && count >= 250) {
                token_type = 'fast';
            }
        } else {
            count = 0;
        }
    } catch (e) {
        count = 0;
        token_type = 'relax';
    }
    return [parseInt(count), token_type]
}

async function updateTokenCount(token_id, columnName, operation, number) {

    let sql;
    if (operation === '+') {
        sql = `UPDATE users_token
               SET ${columnName} = ${columnName} + ${number}
               WHERE token = '${token_id}'`;
    } else if (operation === '-') {
        sql = `UPDATE users_token
               SET ${columnName} = ${columnName} - ${number}
               WHERE token = '${token_id}'`;
    } else {
        throw new Error(`Invalid operation: ${operation}`);
    }

    // 执行 SQL 查询语句
    try {
        await sqlite.update(sql)
    } catch (e) {
        console.log(e);
    }

}

async function startClient(token_id, channel_id, proxy, pattern_type) {
    jobs = await redis('midjourney-jobs')
    queue = await redis('midjourney-tasks')
    progress = await redis('midjourney-progress')
    sessions_redis = await redis('midjourney-sessions')

    let lastRun = 0
    let channel

    const devices = await sessions_redis.redisclient.keys("midjourney-sessions:channel_id*");
    for (const device of devices) {
        const id = device.replace("midjourney-sessions:", "")
        sessions_redis.del(id)
    }

    const client = new Client({checkUpdate: false, 'proxy': proxy})
    client.login(token_id)


    client.on('ready', async () => {
        console.log(`[Midjourney] Discord ${client.user.username} is ready!`);
        channel = await client.channels.fetch(channel_id)

        setInterval(async () => {
            const data = await getAvailableDevice();
        }, 10000)

        setInterval(async () => {
            const now = new Date().getTime()
            if (now - lastRun > 5000) {
                const task = await queue.pop()
                if (task) {
                    lastRun = now
                    const device = await getAvailableDevice()
                    const data = device.filter((d) => d.channelID === task.client_id && d.status !== 'idle');
                    if (data.length > 0) {
                        console.log('队列状态繁忙.....')
                        await schedule(task)
                    } else {
                        await runTask(task)
                    }
                }
            }
        }, 1000)
        sessions.push({
            client: client,
            channel: channel,
            client_id: channel_id,
            pattern_type: pattern_type
        });

        sessions_redis.hset("channel_id_" + channel_id, "channel_id", channel_id);
        sessions_redis.hset("channel_id_" + channel_id, "pattern_type", pattern_type);
        sessions_redis.hset("channel_id_" + channel_id, "status", "idle");
        sessions_redis.hset("channel_id_" + channel_id, "count", '0');
        sessions_redis.hset("channel_id_" + channel_id, "time", getCurrentTimestamp().toString());
    })


    client.on('messageUpdate', async (oldMsg, newMsg) => {
        if (oldMsg.author && oldMsg.author.id === midjourneyBotId && channel && oldMsg.channelId === channel.id) {
            // if (newMsg.author && newMsg.author.id === midjourneyBotId && channel && newMsg.channelId === channel_id) {
            const T = newMsg.components.map(row => {
                return row.components.filter(btn => btn.customId && btn.label === 'Remix mode' && btn.style === 'SUCCESS').map(btn => {
                    return {label: btn.label, id: btn.customId, style: btn.style}
                })
            }).filter(row => row.length > 0)
            const RAW = newMsg.components.map(row => {
                return row.components.filter(btn => btn.customId && btn.label === 'RAW Mode' && btn.style === 'SUCCESS').map(btn => {
                    return {label: btn.label, id: btn.customId, style: btn.style}
                })
            }).filter(row => row.length > 0)
            if (T.length === 0) {

            } else {
                const msg = await channel.messages.fetch(newMsg.id)
                await msg.clickButton('MJ::Settings::RemixMode')
            }
            if (RAW.length === 0) {

            } else {
                const msg = await channel.messages.fetch(newMsg.id)
                await msg.clickButton('MJ::Settings::Style::raw')
            }
            console.log(T)
            console.log(RAW)
            console.log('==================')
            await extractJobInfo(newMsg)
            let job
            job = await findDescJob(newMsg)
            if (job) {
                console.log(`[Midjourney] desc ${job.id}`)
                job.desc.push({
                    id: newMsg.id,
                    mj_image: newMsg.embeds[0].image.url,
                    desc_text: newMsg.embeds[0].description.replaceAll('\n\n', '\r\n'),
                    actions: newMsg.components.map(row => {
                        return row.components.filter(btn => btn.customId && btn.customId.indexOf('::RATING::') === -1).map(btn => {
                            return {label: btn.label || btn.emoji.name, id: btn.customId}
                        })
                    }).filter(row => row.length > 0)
                })
                await sqlite.insert("job_describe", {'job_id': job.id, 'job_': job.desc, 'creat_time': get_now_date()})

                jobs.set(job.id, job)
                callJobListeners(job)
            }
        }
    })


    client.on('messageCreate', async (msg) => {

        if (msg.author && msg.author.id === midjourneyBotId && channel && msg.channelId === channel.id) {
            let job
            if (msg.content) {
                job = await findJob(msg.content)
            } else if (msg.embeds.length) {
                const title = msg.embeds[0].title
                // if (title && errorMessages.find(m => title.startsWith(m))) {
                if (title) {
                    if (title.includes('Job queued')) {
                        sessions_redis.hset('channel_id_' + channel_id, "status", "queued");
                        sessions_redis.hset('channel_id_' + channel_id, "time", getCurrentTimestamp().toString());
                    } else if (title.includes('full')) {
                        sessions_redis.hset('channel_id_' + channel_id, "status", "full");
                        sessions_redis.hset('channel_id_' + channel_id, "time", getCurrentTimestamp().toString());
                    }
                    job = await findJob(msg.embeds[0].footer.text)
                    if (job) {
                        job.images.push({
                            id: msg.id,
                            error: msg.embeds[0].description,
                            title: msg.embeds[0].title
                        })
                        jobs.set(job.id, job)
                        callJobListeners(job)
                        return
                    }
                }
            }

            let attachement = msg.attachments.size && msg.attachments.first()
            if (job && attachement) {
                console.log(`[Midjourney] done ${job.id} ${attachement.url}`)
                let image_url
                // try {
                //     const imagePath = await downloadImage(attachement.url)
                //     console.log(imagePath)
                //     const imgbb = await imgbbUploader("6b90c6ff20fe58fca996a8d50e3a4107", imagePath)
                //     // const imgbb = await qinIuUploadFile(image_id, image_id)
                //     image_url = imgbb.url
                //     if (fs.existsSync(imagePath)) {
                //         fs.rmSync(imagePath, {recursive: true});
                //     }
                // } catch (e) {
                //     image_url = attachement.url
                // }
                job.images.push({
                    id: msg.id,
                    url: attachement.url,
                    upscaled: msg.content.indexOf(' - Upscaled ') !== -1,
                    actions: msg.components.map(row => {
                        return row.components.filter(btn => btn.customId && btn.customId.indexOf('::RATING::') === -1).map(btn => {
                            return {label: btn.label || btn.emoji.name, id: btn.customId}
                        })
                    }).filter(row => row.length > 0)
                })
                try {
                    await sqlite.insert('job_images', {job_id: job.id, images_url: attachement.url})
                } catch (e) {
                    console.log(e)
                }
                await checkJobScore(job.id)


                job['client_id'] = msg.channelId

                let btn = msg.components[0].components.find(c => c.label === 'U1')
                if (job.upscale && btn) {
                    await schedule({actionId: btn.customId, imageId: msg.id})
                }
                jobs.set(job.id, job)
                callJobListeners(job)
            }
        }
    })

}

const init = async function () {
    const savedSessions = getSessionsFile();
    if (savedSessions.length > 0) {
        for (const sess of savedSessions) {
            await startClient(sess.token, sess.channel, sess.proxy, sess.pattern_type);
        }
    }
}

init()


module.exports = async (app) => {
    const token = await redis('midjourney-token')

    // 提交imagine指令
    app.get('/midjourney/imagine', async (req, res) => {

        let prompt = req.query['prompt']
        let upscale = req.query['upscale'] === 'true'
        let token_id = req.query['token']
        let pattern
        let count

        [count, pattern] = await getTokenCount(token_id)

        if (count === 0) {
            return res.status(400).send(JSON.stringify({'code': 400, 'result': '调用次数达到限制，请联系管理员v a16559798_23'}))
        }

        const data = await getBestFastEntry(pattern)
        const client_id = data.channelID
        const run_count = parseInt(await sessions_redis.hget(`channel_id_${client_id}`, "count")) + 1
        sessions_redis.hset("channel_id_" + client_id, "count", run_count.toString());

        if (!prompt || !prompt.trim()) {
            res.status(400).send('prompt parameter is required')
        } else {
            const job = await runJob({
                prompt: prompt,
                upscale: upscale,
                client_id: client_id
            })

            if (job) {
                try {
                    await sqlite.insert('jobs', {
                        token: token_id, job_id: job.id, prompt: prompt,
                        pattern: pattern, channel_id: client_id, tasks: job.tasks, creat_time: get_now_date()
                    })
                }catch (e) {
                    console.log(e)
                }
                await updateTokenCount(token_id, 'token_count', '-', 1)
                return res.send(job)

            } else {
                return res.status(500).send(JSON.stringify({
                    'code': 400,
                    'result': 'cannot create a new job with this prompt'
                }))
            }
        }
    })

    // 对图片进行升级
    app.get('/midjourney/action', async (req, res) => {

        let imageId = req.query['image']
        let actionId = req.query['action']
        let token_id = req.query['token']
        let client_id = req.query['client_id'].toString()
        let channel = sessions.find(sess => sess.client_id === client_id)?.channel;
        let count
        [count, _] = await getTokenCount(token_id)
        if (count === 0) {
            return res.status(400).send(JSON.stringify({'code': 400, 'result': '调用次数达到限制，请联系管理员v a16559798_23'}))
        }

        if (!imageId || !actionId) {
            res.status(400).send(JSON.stringify({
                'code': 400,
                'result': 'image and action parameters should be provided'
            }))
        } else {
            const job = await runAction(imageId, actionId, channel, client_id)
            if (job) {
                try {
                    await sqlite.update(`update jobs
                                         set tasks      = '${job.tasks}',
                                             update_time='${get_now_date()}'
                                         where job_id = '${job.id}'`)
                } catch (e) {
                    console.log(e)
                }
                await updateTokenCount(token_id, 'token_count', '-', 1)
                return res.send(job)
            } else {
                return res.status(500).send(JSON.stringify({'code': 400, 'result': 'cannot run action'}))
            }
        }
    })

    // 获取图片结果
    app.get('/midjourney/job', async (req, res) => {
        let id = req.query['id']
        if (!id || !id.trim()) {
            res.sendStatus(400)
        } else {
            let job = await getJob(id)
            if (job) {
                // 获取所有图片ID
                const allUrls = job.images.map(image => image.url ? image.url : []);
                const allIds = job.images.map(image => image.id);
                if (allUrls.length > 0) {
                    for (let i = 0; i < allUrls.length; i++) {
                        try {
                            await sqlite.insert('job_images', {job_id: job.id, images_url: allUrls[i].toString()})
                        } catch (e) {
                            console.log('该数据已经存在')
                        }

                    }
                }

                // 去重
                const uniqueIds = [...new Set(allIds)];
                // 根据唯一的ID列表创建新的图片对象
                const uniqueImages = uniqueIds.map(id => {
                    return job.images.find(image => image.id === id);
                });
                // 更新去重后的图片列表
                const output = {
                    ...job,
                    images: uniqueImages
                };
                return res.send(output)
            } else {
                return res.sendStatus(404)
            }
        }
    })

    // 提交describe指令
    app.get('/midjourney/desc', async (req, res) => {
        const randomIndex = Math.floor(Math.random() * sessions.length);
        const client_id = sessions[randomIndex].client_id;
        let imagePath = req.query['filePath']
        let imageName = path.basename(imagePath);
        let regex = /^[0-9a-z.]+$/;
        if (!regex.test(imageName)) {
            return res.status(400).send('无效的文件名,只允许使用数字文件名!!!');
        }
        const job = await rundescJob({
            imagePath: imagePath,
            imageName: imageName,
            id: imageName.split('.')[0],
            client_id: client_id
        })
        if (job) {
            return res.send(job)
        } else {
            return res.status(500).send(JSON.stringify({
                'code': 400,
                'result': 'cannot create a new job with this prompt'
            }))
        }
    })

    // 获取describe指令的结果
    app.get('/midjourney/descjob', async (req, res) => {
        let id = req.query['id']
        if (!id || !id.trim()) {
            res.sendStatus(400)
        } else {
            let job = await getJob(id)
            if (job) {
                // 使用map()方法得到去重后的desc数组
                job.desc = Array.from(new Set(job.desc.map(JSON.stringify)), JSON.parse);
                return res.send(job)
            } else {
                return res.sendStatus(404)
            }
        }
    })

    // 生成校验token
    app.get('/midjourney/create_token', async (req, res) => {
        let count = parseInt(req.query['count'])
        let day = parseInt(req.query['day'])

        function generateRandomString(length) {
            var result = '';
            var characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
            for (var i = 0; i < length; i++) {
                result += characters.charAt(Math.floor(Math.random() * characters.length));
            }
            return result;
        }

        async function start(count, day, type) {
            const id = generateRandomString(5)
            const create_time = get_now_date()
            const expiration_time = addDaysToDate(day)
            return {token: id, count, day, create_time, type, expiration_time}
        }

        const a = await start(count, day, 'null')
        const tokenData = {
            token: a.token,
            token_type: a.type,
            token_day: a.day,
            token_count: a.count,
            create_time: a.create_time,
            user: 'admin',
            expiration_time: a.expiration_time,
            user_type: 1
        };
        console.log(tokenData)
        try {
            const data = await sqlite.insert('users_token', tokenData)
            console.log(data)

            return res.send({token:a.token})
        }catch (e) {
            console.log(e)
            return res.send({e})
        }

    })

    // 获取所有token有效期
    app.get('/midjourney/get_token', async (req, res) => {
        return res.send({"data": item})
    })

    // 获取账户历史记录
    app.get('/midjourney/history', async (req, res) => {
        const token = req.query['token']
        const data = await sqlite.query(`SELECT t1.job_id, t2.images_url
                                         FROM jobs t1
                                                  JOIN job_images t2 ON t1.job_id = t2.job_id
                                         WHERE t1.token = '${token}'`)
        return res.send({"data": data})

    })


    // 获取job进度条
    app.get('/midjourney/progress', async (req, res) => {
        let id = req.query['id']
        if (!id || !id.trim()) {
            res.sendStatus(400)
        } else {
            let job = await progress.get(id)
            if (job) {
                return res.send(job)
            } else {
                return res.send({"progress": 0})
            }
        }
    })

    // 切换模式switch
    app.get('/midjourney/switch', async (req, res) => {
        let type = req.query['type']
        let client_id = req.query['client_id'].toString()
        let channel = sessions.find(sess => sess.client_id === client_id)?.channel;
        let client = sessions.find(sess => sess.client_id === client_id)?.client;
        try {
            await channel.sendSlash(midjourneyBotId, type)

            client.on('messageUpdate', async (oldMsg, newMsg) => {
                if (oldMsg.author && oldMsg.author.id === midjourneyBotId && channel && oldMsg.channelId === channel.id) {
                    if (newMsg.interaction.commandName === 'info') {
                        return res.send({
                            'code': 200, 'result':
                                {
                                    "title": newMsg.embeds[0].title,
                                    "description:": newMsg.embeds[0].description,
                                }
                        })
                    }
                    // if (newMsg.interaction.commandName === type) {
                    //     return res.send({'code': 200, 'result': newMsg.content})
                    // }

                }
            })
        } catch (e) {
            console.error(`[Midjourney] cannot run ${type} `, e.message)
            return res.send({'code': 400, 'result': 'fail'})
        }
    })

    app.get('/midjourney/get_devices', async (req, res) => {
        return res.send(await getAvailableDevice())
    })

    app.get('/midjourney/get_queue', async (req, res) => {
        const a = await queue.redisclient.LLEN("midjourney-tasks")

        return res.send({status: 200, data: a})
    })

}


