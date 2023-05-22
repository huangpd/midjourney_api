# midjourney_api
这是个关于midjourney非官方的api接口

##  Install


```

git clone https://github.com/erictik/midjourney-api.git

```

```

cd midjourney-api 

```

```

npm install 

```

##  Usage

cd modules 修改token_channels.json文件

```json
[
  {"token":"MTEwMTgwODU0Nzg1NzE3NDU1OA.GQu5KQ","channel":"1106130756494962778",
    "proxy": "http://127.0.0.1:7890","pattern_type": "fast"},
  {"token":"MTEwMTgwODU0Nzg1NzE3NDU1OA.GQu5KQ","channel":"1106130754792083477",
    "proxy": "http://127.0.0.1:7890","pattern_type": "relax"}
]

```

token是discord中的验证authorized, channel为你的频道id, proxy为代理, pattern_type是midjoury fast or relax模式

## API

1. midjourney/imagine 提交指令
该端点用于提交imagine指令。它接受prompt和upscale参数，以及token ID和pattern。如果token计数为0，则返回错误消息。否则，使用给定参数创建作业并返回作业数据。

```
http://127.0.0.1:8000/midjourney/imagine?token=4mflr&prompt=a dog

{
  "prompt": "a dog",
  "upscale": false,
  "client_id": "1103654914795765792",
  "id": "2e1146bdd64a4f7413bd",
  "tasks": 1,
  "images": [
    
  ]
}

```

2. midjourney/action
此端点用于将图像升级。它接受一个image ID、action ID、token ID和client ID参数。如果令牌计数为0，它将返回一个错误消息。否则，它在指定的图像上运行操作并返回作业数据。

2. midjourney/job
该端点用于检索imagine或action命令的结果。它接受一个job ID参数并返回作业数据，其中重复的图像已去除。

3. midjourney/desc
该端点用于提交describe指令。它接受一个图像文件的文件路径，并基于该图像生成作业。返回作业数据。

4. midjourney/descjob
该端点用于检索describe命令的结果。它接受一个job ID参数并返回作业数据，其中重复的描述已删除。

5. midjourney/create_token
该端点用于生成新的身份验证令牌。它接受计数和天数参数，以确定使用次数和到期天数。它生成一个随机的令牌ID，在数据库中创建一个新条目，并返回令牌数据。

6. midjourney/history
该端点用于检索与给定令牌相关的历史作业。它接受一个token参数并返回作业ID和图像URL的列表。

7. midjourney/progress
该端点用于检索给定作业的进度。它接受一个job ID参数并返回进度数据。

8. midjourney/switch
该端点用于在不同模式之间切换并检索有关当前模式的信息。它接受类型和客户端ID参数，向机器人发送斜线命令以切换模式或检索信息，并返回结果数据。

9. midjourney/get_devices
该端点用于检索可用于渲染作业的设备。

10. midjourney/get_queue
该端点用于检索队列中的任务数。返回队列大小。
