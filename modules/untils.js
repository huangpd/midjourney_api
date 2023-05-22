const get_now_date = function () {
    function change(t) {
        if (t < 10) {
            return "0" + t;
        } else {
            return t;
        }
    }

    const timestamp = Date.parse(new Date());
    const date = new Date(timestamp);
    //获取年份
    const Y = date.getFullYear();
    //获取月份
    const M = (date.getMonth() + 1 < 10 ? '0' + (date.getMonth() + 1) : date.getMonth() + 1);
    //获取当日日期
    const D = date.getDate() < 10 ? '0' + date.getDate() : date.getDate();
    const hour = change(date.getHours());
    const minute = change(date.getMinutes());
    const second = change(date.getSeconds());
    return Y + '-' + M + '-' + D + ' ' + hour + ':' + minute + ':' + second;
}

//获取当前日期后任意一天的日期
function addDaysToDate(days) {
    let currentDate = new Date(); // 获取当前日期和时间
    currentDate.setDate(currentDate.getDate() + days); // 添加指定天数
    let year = currentDate.getFullYear();
    let month = String(currentDate.getMonth() + 1).padStart(2, '0'); // 月份从0开始计数，需要加上1并补零
    let day = String(currentDate.getDate()).padStart(2, '0'); // 需要补零
    let hour = String(currentDate.getHours()).padStart(2, '0'); // 获取当前小时并补零
    let minute = String(currentDate.getMinutes()).padStart(2, '0'); // 获取当前分钟并补零
    let second = String(currentDate.getSeconds()).padStart(2, '0'); // 获取当前秒数并补零
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`; // 将年月日时分秒组合成一个字符串

}

module.exports = {get_now_date,addDaysToDate}
