var sqlite3 = require("sqlite3");
var ReadWriteLock = require("rwlock");
var transacLock = new ReadWriteLock();
var db = new sqlite3.Database("todos.db", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);

db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'", function(err, data)
{
    if (!data)
    {
        db.serialize(function()
        {
            db.run("CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, completed BOOLEAN DEFAULT 0, title TEXT, version INTEGER DEFAULT 0)");
            db.run("INSERT INTO todos (title) VALUES (\"Buy ketchup\")");
            db.run("INSERT INTO todos (title) VALUES (\"Pay internet bill\")");
            db.run("INSERT INTO todos (title) VALUES (\"Anna's birthday present\")");
        });
    }
});

var emitterKey = "9SN1Xg1DjvmeiSdpnS0WdKkrxlz0koBH";
var channel = "todo";
var emitter = require('emitter-io').connect();

emitter.on('connect', function(){
    console.log('emitter: connected');
    emitter.subscribe({
        key: emitterKey,
        channel: channel + "/cmd",
    });
});

emitter.on('message', function(msg)
{
    console.log('emitter: received ' + msg.asString());
    msg = msg.asObject();
    handle[msg.cmd](msg);
});   


function publish(recipient, msg)
{
    emitter.publish({
        key: emitterKey,
        channel: channel + "/" + recipient,
        message: JSON.stringify(msg)
    });
}

function handleGet(msg)
{
    db.get("SELECT * FROM todos WHERE id = ?", [msg.id], function(err, rows){
        if (err)
            publish(msg.sender, {cmd: "err", err: err, request: msg}); 
        else
            publish(msg.sender, {cmd: "get", todos: rows});
    });
}

function handleGetAll(msg)
{
    db.all("SELECT * FROM todos", function(err, rows){
        if (err)
            publish(msg.sender, {cmd: "err", err: err, request: msg}); 
        else
            publish(msg.sender, {cmd: "getall", todos: rows});
    }); 
}

function handleAdd(msg)
{
    db.run("INSERT INTO todos (title) VALUES (?)", [msg.title], function(err)
    {
        if (err)
            publish(msg.sender, {cmd: "err", err: err, request: msg}); 
        else    
            publish("broadcast", {cmd: "add", todo: {id: this.lastID, completed: false, title: msg.title }});
    });    
}

function handleDelete(msg)
{
    db.run("DELETE FROM todos WHERE id = ?", [msg.id], function(err)
    {
        if (err)
            publish(msg.sender, {cmd: "err", err: err, request: msg}); 
        else
            publish("broadcast", {cmd: "delete", ids: [msg.id]});     
    });    
}

function handleRemoveCompleted(msg)
{
    transacLock.writeLock(function(release)
    {
        db.run("BEGIN;");
        var ids = undefined;
        db.all("SELECT id FROM todos WHERE completed = 1", function(err, rows){
            if (err)
            {
                db.run("ROLLBACK;");
                release();
                console.log(err);
                publish(msg.sender, {cmd: "err", err: err, request: msg});
                return;
            }
            ids = rows.map(function(x){ return x.id; });
            db.run("DELETE FROM todos WHERE completed = 1", function(err) {
                if (err)
                {
                    db.run("ROLLBACK;");
                    release();
                    console.log(err);
                    publish(msg.sender, {cmd: "err", err: err, request: msg});
                    return;
                }
                db.run("COMMIT;");
                release();
                publish("broadcast", {cmd: "delete", ids: ids});
            });
        });
    });
}

function handleComplete(msg)
{
    transacLock.writeLock(function(release)
    {
        db.run("BEGIN;");
        db.get("SELECT version FROM todos WHERE id = ?", [msg.id], function (err, row)
        {
           if (err)
            {
                db.run("ROLLBACK;");
                release();
                console.log(err);
                publish(msg.sender, {cmd: "err", err: err, request: msg});
                return;
            }
            var version = row.version + 1;
            db.run("UPDATE todos SET completed = ?, version = ? WHERE id = ?",
                   [msg.completed, version, msg.id],
                   function(err){
                    if (err)
                    {
                        db.run("ROLLBACK;");
                        release();
                        console.log(err);
                        publish(msg.sender, {cmd: "err", err: err, request: msg});
                        return;
                    }
                    db.run("COMMIT;");
                    release();
                    publish("broadcast", {cmd: "complete", todo: {id: msg.id, completed: msg.completed, version: version}});
            });
        });
    });
}

function handleEdit(msg)
{
    transacLock.writeLock(function(release)
    {
        db.run("BEGIN;");
        var version = undefined;
        db.get("SELECT version FROM todos WHERE id = ?", [msg.id], function (err, row)
        {
            if (err)
            {
                db.run("ROLLBACK;");
                release();
                console.log(err);
                publish(msg.sender, {cmd: "err", err: err, request: msg});
                return;
            }
            version = row.version + 1;
            db.run("UPDATE todos SET title = ?, version = ? WHERE id = ?", [msg.title, version, msg.id], function(err){
                if (err)
                {
                    db.run("ROLLBACK;");
                    release();
                    console.log(err);
                    publish(msg.sender, {cmd: "err", err: err, request: msg});
                    return;
                }
                db.run("COMMIT;");
                release();
                publish("broadcast", {cmd: "edit", todo: {id: msg.id, title: msg.title, version: version}});
            });
        });   
    });
}

var handle = {
    "get": handleGet,
    "getall": handleGetAll,
    "add": handleAdd,
    "delete": handleDelete,
    "removeCompleted": handleRemoveCompleted,
    "complete": handleComplete,
    "edit": handleEdit
};