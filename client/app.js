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

function handleGetAll(msg)
{
    app.$data.todos = msg.todos;
    for (var i = 0; i < app.$data.cmdToApply.length; ++i)
    {
        var msg = app.$data.cmdToApply[i];
        handle[msg.cmd](msg);
    }
    app.$data.cmdToApply = [];
}

function handleAdd(msg)
{
    if (app.$data.cemetery.indexOf(msg.todo.id) != -1) return;
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id) return;
    }
    app.$data.todos.push(msg.todo);
}

function handleDelete(msg)
{
    var newList = [];
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        if (msg.ids.indexOf(app.$data.todos[i].id) == -1)
            newList.push(app.$data.todos[i]);
        else
            app.$data.cemetery.push(app.$data.todos[i].id);
    }
    app.$data.todos = newList;
}

function handleComplete(msg)
{
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id)
        {
            if (todo.version >= msg) return;
            todo.completed = msg.todo.completed;
            todo.version = msg.todo.version;
            return;
        }
    }  
}

function handleEdit(msg)
{
    for (var i = 0; i < app.$data.todos.length; ++i)
    {
        var todo = app.$data.todos[i];
        if (todo.id == msg.todo.id)
        {
            if (todo.version >= msg.todo.version) return;
            todo.title = msg.todo.title;
            todo.version = msg.todo.version;
            return;
        }
    }
}

function handleError(msg)
{
    console.error(msg);
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
    
    if (app.$data.todos === undefined && msg.cmd != "getall")
        app.$data.cmdToApply.push(msg);
    else
        handle[msg.cmd](msg);
});

// mount
app.$mount('.todoapp')