var emitterKey = "9SN1Xg1DjvmeiSdpnS0WdKkrxlz0koBH";
var channel = "todo";

function publish(msg)
{
    emitter.publish({
        key: emitterKey,
        channel: channel + "/cmd",
        message: JSON.stringify(msg)
    });
}

var emitter = emitter.connect({
    secure: true
}); 

// visibility filters
var filters = {
  all: function (todos) {
    return todos;
  },
  active: function (todos) {
    return todos.filter(function (todo) {
      return !todo.completed;
    })
  },
  completed: function (todos) {
    return todos.filter(function (todo) {
      return todo.completed;
    })
  }
}

var app = new Vue({
    data: {
        newTodo: '',
        editedTodo: null,
        visibility: 'all',
        todos: [],
        cmdToApply: [],
        cemetery: []
    },
    
    // computed properties
    // http://vuejs.org/guide/computed.html
    computed: {
        filteredTodos: function () {
            return filters[this.visibility](this.todos);
        },
        remaining: function () {
            return filters.active(this.todos).length;
        },
        allDone: {
            get: function () {
                return this.remaining === 0;
            },
            set: function (value) {
                this.todos.forEach(function (todo) {
                    todo.completed = value;
                });
            }
        }
    },    
    
    filters: {
        pluralize: function (n) {
            return n === 1 ? 'item' : 'items';
        }
    },
    
    methods: {
        
        addTodo: function() {
            var value = this.newTodo && this.newTodo.trim();
            if (!value) return;
            publish({cmd: "add", title: value});
            this.newTodo = '';
        },

        removeTodo: function(todo) {
            publish({cmd: "delete", id: todo.id});
        },

        editTodo: function(todo) {
            this.beforeEditCache = todo.title;
            this.editedTodo = todo;
        },

        doneEdit: function(todo) {
            console.log("done edit");
            this.editedTodo = null;
            publish({cmd: "edit", id: todo.id, title: todo.title});
        },

        cancelEdit: function(todo) {
            this.editedTodo = null;
            todo.title = this.beforeEditCache;
        },

        removeCompleted: function() {
            publish({cmd: "removeCompleted"});
        },
        
        completeChanged: function(todo) {
            publish({cmd: "complete", id: todo.id, completed: todo.completed})
        }
    },
    
    // a custom directive to wait for the DOM to be updated
    // before focusing on the input field.
    // http://vuejs.org/guide/custom-directive.html
    directives: {
        'todo-focus': function (el, value) {
            if (value) {
                el.focus();
            }
        }
    }
});

// handle routing
function onHashChange ()
{
    var visibility = window.location.hash.replace(/#\/?/, '')
    if (filters[visibility])
    {
        app.visibility = visibility;
    }
    else
    {
        window.location.hash = '';
        app.visibility = 'all';
    }
}

window.addEventListener('hashchange', onHashChange);
onHashChange();

emitter.on('connect', function(){
    console.log('emitter: connected');
    emitter.subscribe({
        key: emitterKey,
        channel: channel + "/" + getPersistentVisitorId()
    });
    
    emitter.subscribe({
        key: emitterKey,
        channel: channel + "/broadcast"
    });
    
    emitter.publish({
        key: emitterKey,
        channel: channel + "/cmd",
        message: JSON.stringify({sender: getPersistentVisitorId(), cmd: "getall"})
    });
});

/*
    Browse the cemetery and return whether the todo passed in the message was already buried.
*/
function isBuried(id)
{
    return app.$data.cemetery.indexOf(id) == -1 ? false : true;
}

/*
    Browse the list of messages that couldn't be applied at the reception time
    and see whether they can be applied now.
*/
function delayedApply()
{
    var remainingCommandsToApply = [];
    for (var i = 0; i < app.$data.cmdToApply.length; ++i)
    {
        var msg = app.$data.cmdToApply[i];
        var treated = handle[msg.cmd](msg);
        if (!treated)
            remainingCommandsToApply.push(msg);
    }
    app.$data.cmdToApply = remainingCommandsToApply;    
}

/*
    The first thing a client does is sending a request for the full todo list to the server.
    Meanwhile, the client may receive updates which cannot be applied just yet and are therefore,
    stored in an array. That's why, once the full todo list is finally received, we make a call
    to the delayedApply function. See above.
*/
function handleGetAll(msg)
{
    app.$data.todos = msg.todos;
    delayedApply();
}

/*
    Returns whether the command could be processed. This return value is useful to the delayedApply function.
    The add command always succeeds.
*/
function handleAdd(msg)
{
    // Let's check whether this todo was already deleted.
    if (isBuried(msg.todo.id)) return true;
        
    // Let's check whether, for whatever reason, this todo already was inserted.
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id) return true;
    }
    // Insert the todo...
    app.$data.todos.push(msg.todo);
    // ...and apply the stored potential updates related to this todo. 
    delayedApply();
    return true;
}

/*
    Returns whether the command could be processed. This return value is useful to the delayedApply function.
    Remove the todo from the list and push the id into the cemetery array.
    If the todo is not found, this may be because of a late "add" message. This delete command is therefore added
    to the cmdToApply array to be applied later.
*/
function handleDelete(msg)
{
    var cleanTodoList = [];
    var deletedIds = [];
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var indexFound = msg.ids.indexOf(app.$data.todos[i].id);
        if (indexFound == -1)
            // This item is not to be deleted.
            cleanTodoList.push(app.$data.todos[i]);
        else
        {
            // This item is to be deleted.
            var id = app.$data.todos[i].id;
            // Let's delte it if it's not buried.
            if (!isBuried(id))
                deletedIds.push(id);
        }
    }

    // If the command was fully processed.
    if (deletedIds.length == msg.ids.length)
    {
        // merge cemetery with deleted
        app.$data.cemetery.push(id);
        
        app.$data.todos = cleanTodoList;
        return true;
    }
    else
        return false;
}

/*
    Returns whether the command could be processed. This return value is useful to the delayedApply function.
*/
function handleComplete(msg)
{
    // Let's check whether this todo was already deleted.
    if (isBuried(msg.todo.id)) return true;
    
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id)
        {
            if (todo.version >= msg) return;
            todo.completed = msg.todo.completed;
            todo.version = msg.todo.version;
            return true;
        }
    }
    /* 
        At this point, to todo item corresponding to the id passed in the message was found.
        This could be a case of late 
    */
    app.$data.cmdToApply.push(msg);
    return false;
}

/*
    Returns whether the command could be processed. This return value is useful to the delayedApply function.
*/
function handleEdit(msg)
{
    // Let's check whether this todo was already deleted.
    if (isBuried(msg.todo.id)) return true;

    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id)
        {
            if (todo.version >= msg.todo.version) return true;
            todo.title = msg.todo.title;
            todo.version = msg.todo.version;
            return true;
        }
    }
    app.$data.cmdToApply.push(msg);
    return false;
}

/*
    Returns whether the command could be processed. This return value is useful to the delayedApply function.
*/
function handleError(msg)
{
    console.error(msg);
    return true;
}

var handle = {
    "getall": handleGetAll,
    "add": handleAdd,
    "delete": handleDelete,
    "complete": handleComplete,
    "edit": handleEdit,
    "err": handleError
};

emitter.on('message', function(msg){
    console.log('emitter: received ' + msg.asString() );
    msg = msg.asObject();
    
    // If this is the init phase, we need to stack any update received before the answer to the getall command.
    if (app.$data.todos === undefined && msg.cmd != "getall")
        app.$data.cmdToApply.push(msg);
    else
        handle[msg.cmd](msg);
});

// mount
app.$mount('.todoapp')