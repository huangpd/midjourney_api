const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 创建连接
const dbPath = path.resolve(__dirname, './mydb.db');
const db = new sqlite3.Database(dbPath);

// 新增操作
function insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(',');
    const sql = `INSERT INTO ${table} (${keys.join(',')})
                 VALUES (${placeholders})`;
    return new Promise((resolve, reject) => {
            db.run(sql, values, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });

    });
}

// 修改操作
function update(sql) {
    return new Promise((resolve, reject) => {
        try {
            db.run(sql, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        } catch (e) {
            console.log(e)
        }

    });
}

// 删除操作
function remove(table, id) {
    const sql = `DELETE
                 FROM ${table}
                 WHERE id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
}

// 查询操作
function query(sql) {
    // const { where = '', values = [] } = parseConditions(conditions);
    // const sql = `SELECT * FROM ${table} ${where}`;
    return new Promise((resolve, reject) => {
        try {
            db.all(sql, function (err, rows) {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        } catch (e) {
            console.log(e)
        }
    });
}

module.exports = {insert, update, remove, query};