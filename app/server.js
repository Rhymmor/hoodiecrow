"use strict";

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

require("babel-core/register");
require("babel-polyfill");
"use strict";

//TODO: investigate warnings
process.setMaxListeners(0);

var Stream = require("stream").Stream;
var util = require("util");
var net = require("net");
var tls = require("tls");
var fs = require("fs");
var imapHandler = require("imap-handler");
//var starttls = require("./starttls");

module.exports = function (options) {
    return new IMAPServer(options);
};

function IMAPServer(options) {
    Stream.call(this);

    this.options = options || {};
    this.options.credentials = this.options.credentials || {
        key: fs.readFileSync(__dirname + "/../cert/server.key"),
        cert: fs.readFileSync(__dirname + "/../cert/server.crt")
    };

    var client = this.createClient.bind(this);
    if (this.options.secureConnection) {
        this.server = tls.createServer(this.options.credentials, client);
        this.serverV6 = tls.createServer(this.options.credentials, client);
    } else {
        this.server = net.createServer(client);
        this.serverV6 = net.createServer(client);
    }

    this.connectionHandlers = [];
    this.outputHandlers = [];
    this.messageHandlers = [];
    this.fetchHandlers = {};
    this.fetchFilters = [];
    this.searchHandlers = {};
    this.storeHandlers = {};
    this.storeFilters = [];
    this.commandHandlers = {};
    this.capabilities = {};
    this.allowedStatus = ["MESSAGES", "RECENT", "UIDNEXT", "UIDVALIDITY", "UNSEEN"];
    this.literalPlus = false;
    this.referenceNamespace = false;

    this.users = this.options.users || {
        "testuser": {
            password: "testpass",
            xoauth2: {
                accessToken: "testtoken",
                sessionTimeout: 3600 * 1000
            }
        }
    };

    [].concat(this.options.plugins || []).forEach(function (plugin) {
        switch (typeof plugin === "undefined" ? "undefined" : _typeof(plugin)) {
            case "string":
                require("./plugins/" + plugin.toLowerCase())(this);
                break;
            case "function":
                plugin(this);
                break;
        }
    }.bind(this));

    this.systemFlags = [].concat(this.options.systemFlags || ["\\Answered", "\\Flagged", "\\Draft", "\\Deleted", "\\Seen"]);
    this.storage = this.options.storage || {
        "INBOX": {},
        "": {}
    };
    /*for (const msg of this.storage.INBOX.messages) {
        if (msg.file && !msg.raw) {
            const data = fs.readFileSync(msg.file, 'utf8');
            msg.raw = data;
        }
    }*/

    this.uidnextCache = {}; // keep nextuid values if mailbox gets deleted
    this.folderCache = {};
    this.indexFolders();
}
util.inherits(IMAPServer, Stream);

IMAPServer.prototype.listen = function () {
    var args = Array.prototype.slice.call(arguments);
    this.server.listen.apply(this.server, args);
};

IMAPServer.prototype.listenV6 = function () {
    var args = Array.prototype.slice.call(arguments);
    this.serverV6.listen.apply(this.serverV6, args);
};

IMAPServer.prototype.close = function (callback) {
    this.server.close(callback);
    this.serverV6.close(callback);
};

IMAPServer.prototype.createClient = function (socket) {
    var connection = new IMAPConnection(this, socket);
    this.connectionHandlers.forEach(function (handler) {
        handler(connection);
    }.bind(this));
};

IMAPServer.prototype.registerCapability = function (keyword, handler) {
    this.capabilities[keyword] = handler || function () {
        return true;
    };
};

IMAPServer.prototype.setCommandHandler = function (command, handler) {
    command = (command || "").toString().toUpperCase();
    this.commandHandlers[command] = handler;
};

/**
 * Returns a mailbox object from folderCache
 *
 * @param {String} path Pathname for the mailbox
 * @return {Object} mailbox object or undefined
 */
IMAPServer.prototype.getMailbox = function (path) {
    if (path.toUpperCase() === "INBOX") {
        return this.folderCache.INBOX;
    }
    return this.folderCache[path];
};

/**
 * Schedules a notifying message
 *
 * @param {Object} command An object of untagged response message
 * @param {Object|String} mailbox Mailbox the message is related to
 * @param {Object} ignoreConnection if set the selected connection ignores this notification
 */
IMAPServer.prototype.notify = function (command, mailbox, ignoreConnection) {
    command.notification = true;
    this.emit("notify", {
        command: command,
        mailbox: mailbox,
        ignoreConnection: ignoreConnection
    });
};

/**
 * Retrieves a function for an IMAP command. If the command is not cached
 * tries to load it from a file in the commands directory
 *
 * @param {String} command Command name
 * @return {Function} handler for the specified command
 */
IMAPServer.prototype.getCommandHandler = function (command) {
    command = (command || "").toString().toUpperCase();

    var handler;

    // try to autoload if not supported
    if (!this.commandHandlers[command]) {
        try {
            handler = require("./commands/" + command.toLowerCase());
            this.setCommandHandler(command, handler);
        } catch (E) {
            //console.log(E);
        }
    }

    return this.commandHandlers[command] || false;
};

/**
 * Returns some useful information about a mailbox that can be used with STATUS, SELECT and EXAMINE
 *
 * @param {Object|String} mailbox Mailbox object or path
 */
IMAPServer.prototype.getStatus = function (mailbox) {
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }
    if (!mailbox) {
        return false;
    }

    var flags = {},
        seen = 0,
        unseen = 0,
        permanentFlags = [].concat(mailbox.permanentFlags || []);

    mailbox.messages.forEach(function (message) {

        if (message.flags.indexOf("\\Seen") < 0) {
            unseen++;
        } else {
            seen++;
        }

        message.flags.forEach(function (flag) {
            if (!flags[flag]) {
                flags[flag] = 1;
            } else {
                flags[flag]++;
            }

            if (permanentFlags.indexOf(flag) < 0) {
                permanentFlags.push(flag);
            }
        }.bind(this));
    }.bind(this));

    return {
        flags: flags,
        seen: seen,
        unseen: unseen,
        permanentFlags: permanentFlags
    };
};

/**
 * Validates a date value. Useful for validating APPEND dates
 *
 * @param {String} date Date value to be validated
 * @return {Boolean} Returns true if the date string is in IMAP date-time format
 */
IMAPServer.prototype.validateInternalDate = function (date) {
    if (!date || typeof date !== "string") {
        return false;
    }
    return !!date.match(/^([ \d]\d)\-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([\-+])(\d{2})(\d{2})$/);
};

/**
 * Converts a date object to a valid date-time string format
 *
 * @param {Object} date Date object to be converted
 * @return {String} Returns a valid date-time formatted string
 */
IMAPServer.prototype.formatInternalDate = function (date) {
    var day = date.getDate(),
        month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()],
        year = date.getFullYear(),
        hour = date.getHours(),
        minute = date.getMinutes(),
        second = date.getSeconds(),
        tz = date.getTimezoneOffset(),
        tzHours = Math.abs(Math.floor(tz / 60)),
        tzMins = Math.abs(tz) - tzHours * 60;

    return (day < 10 ? "0" : "") + day + "-" + month + "-" + year + " " + (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") + minute + ":" + (second < 10 ? "0" : "") + second + " " + (tz > 0 ? "-" : "+") + (tzHours < 10 ? "0" : "") + tzHours + (tzMins < 10 ? "0" : "") + tzMins;
};

/**
 * Creates a mailbox with specified path
 *
 * @param {String} path Pathname for the mailbox
 * @param {Object} [defaultMailbox] use this object as the mailbox to add instead of empty'
 */
IMAPServer.prototype.createMailbox = function (path, defaultMailbox) {
    // Ensure case insensitive INBOX
    if (path.toUpperCase() === "INBOX") {
        throw new Error("INBOX can not be modified");
    }

    // detect namespace for the path
    var namespace = "",
        storage,
        folderPath;

    Object.keys(this.storage).forEach(function (key) {
        if (key === "INBOX") {
            // Ignore INBOX
            return;
        }
        var ns = key.length ? key.substr(0, key.length - this.storage[key].separator.length) : key;
        if (key.length && (path === ns || path.substr(0, key.length) === key)) {
            if (path === ns) {
                throw new Error("Used mailbox name is a namespace value");
            }
            namespace = key;
        } else if (!namespace && !key && this.storage[key].type === "personal") {
            namespace = key;
        }
    }.bind(this));

    if (!this.storage[namespace]) {
        throw new Error("Unknown namespace");
    } else {
        folderPath = path;
        storage = this.storage[namespace];

        if (storage.type !== "personal") {
            throw new Error("Permission denied");
        }

        if (folderPath.substr(-storage.separator.length) === storage.separator) {
            folderPath = folderPath.substr(0, folderPath.length - storage.separator.length);
        }

        if (this.folderCache[folderPath] && this.folderCache[folderPath].flags.indexOf("\\Noselect") < 0) {
            throw new Error("Mailbox already exists");
        }

        path = folderPath;
        folderPath = folderPath.substr(namespace.length).split(storage.separator);
    }

    var parent = storage,
        curPath = namespace;

    if (curPath) {
        curPath = curPath.substr(0, curPath.length - storage.separator.length);
    }

    folderPath.forEach(function (folderName) {
        curPath += (curPath.length ? storage.separator : "") + folderName;

        var folder = this.getMailbox(curPath) || false;

        if (folder && folder.flags && folder.flags.indexOf("\\NoInferiors") >= 0) {
            throw new Error("Can not create subfolders for " + folder.path);
        }

        if (curPath === path && defaultMailbox) {
            folder = defaultMailbox;
            this.processMailbox(curPath, folder, namespace);
            parent.folders = parent.folders || {};
            parent.folders[folderName] = folder;

            folder.uidnext = Math.max(folder.uidnext, this.uidnextCache[curPath] || 1);
            delete this.uidnextCache[curPath];
            this.folderCache[curPath] = folder;
        } else if (!folder) {
            folder = {
                subscribed: false
            };
            this.processMailbox(curPath, folder, namespace);
            parent.folders = parent.folders || {};
            parent.folders[folderName] = folder;

            delete this.uidnextCache[curPath];
            this.folderCache[curPath] = folder;
        }

        if (parent !== storage) {
            // Remove NoSelect if needed
            this.removeFlag(parent.flags, "\\Noselect");

            // Remove \HasNoChildren and add \\HasChildren from parent
            this.toggleFlags(parent.flags, ["\\HasNoChildren", "\\HasChildren"], 1);
        } else if (folder.namespace === this.referenceNamespace) {
            if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
                this.toggleFlags(this.storage.INBOX.flags, ["\\HasNoChildren", "\\HasChildren"], 1);
            }
        }

        parent = folder;
    }.bind(this));
};

/**
 * Deletes a mailbox with specified path
 *
 * @param {String} path Pathname for the mailbox
 * @param {boolean} keepContents If true do not delete messages
 */
IMAPServer.prototype.deleteMailbox = function (path, keepContents) {
    // Ensure case insensitive INBOX
    if (path.toUpperCase() === "INBOX") {
        throw new Error("INBOX can not be modified");
    }

    // detect namespace for the path
    var mailbox,
        storage,
        namespace = "",
        folderPath = path,
        folderName,
        parent,
        parentKey;

    Object.keys(this.storage).forEach(function (key) {
        if (key === "INBOX") {
            // Ignore INBOX
            return;
        }
        var ns = key.length ? key.substr(0, key.length - this.storage[key].separator.length) : key;
        if (key.length && (path === ns || path.substr(0, key.length) === key)) {
            if (path === ns) {
                throw new Error("Used mailbox name is a namespace value");
            }
            namespace = key;
        } else if (!namespace && !key && this.storage[key].type === "personal") {
            namespace = key;
        }
    }.bind(this));

    if (!this.storage[namespace]) {
        throw new Error("Unknown namespace");
    } else {
        parent = storage = this.storage[namespace];

        if (storage.type !== "personal") {
            throw new Error("Permission denied");
        }

        if (folderPath.substr(-storage.separator.length) === storage.separator) {
            folderPath = folderPath.substr(0, folderPath.length - storage.separator.length);
        }

        mailbox = this.folderCache[folderPath];

        if (!mailbox || mailbox.flags.indexOf("\\Noselect") >= 0 && Object.keys(mailbox.folders || {}).length) {
            throw new Error("Mailbox does not exist");
        }

        folderPath = folderPath.split(storage.separator);
        folderName = folderPath.pop();

        parentKey = folderPath.join(storage.separator);
        if (parentKey !== "INBOX") {
            parent = this.folderCache[folderPath.join(storage.separator)] || parent;
        }

        if (mailbox.folders && Object.keys(mailbox.folders).length && !keepContents) {
            // anyone who has this mailbox selected is going to stay with
            // `reference` object. any new select is going to go to `folder`
            var reference = mailbox,
                folder = {};

            Object.keys(reference).forEach(function (key) {
                if (key !== "messages") {
                    folder[key] = reference[key];
                } else {
                    folder[key] = [];
                }
            });

            this.ensureFlag(folder.flags, "\\Noselect");
            parent.folders[folderName] = folder;
        } else {
            delete this.folderCache[mailbox.path];
            this.uidnextCache[mailbox.path] = mailbox.uidnext;
            delete parent.folders[folderName];

            if (parent !== storage) {
                if (parent.flags.indexOf("\\Noselect") >= 0 && !Object.keys(parent.folders || {}).length) {
                    this.deleteMailbox(parent.path);
                } else {
                    this.toggleFlags(parent.flags, ["\\HasNoChildren", "\\HasChildren"], Object.keys(parent.folders || {}).length ? 1 : 0);
                }
            } else if (namespace === this.referenceNamespace) {
                if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
                    this.toggleFlags(this.storage.INBOX.flags, ["\\HasNoChildren", "\\HasChildren"], Object.keys(storage.folders || {}).length ? 1 : 0);
                }
            }
        }
    }
};

/**
 * INBOX has its own namespace
 */
IMAPServer.prototype.indexFolders = function () {
    var folders = {};

    var walkTree = function (path, separator, branch, namespace) {
        var keyObj = namespace === "INBOX" ? {
            INBOX: true
        } : branch;

        Object.keys(keyObj).forEach(function (key) {

            var curBranch = branch[key],
                curPath = (path ? path + (path.substr(-1) !== separator ? separator : "") : "") + key;

            folders[curPath] = curBranch;
            this.processMailbox(curPath, curBranch, namespace);

            // ensure uid, flags and internaldate for every message
            curBranch.messages.forEach(function (message, i) {

                // If the input was a raw message, convert it to an object
                if (typeof message === "string") {
                    curBranch.messages[i] = message = {
                        raw: message
                    };
                }

                this.processMessage(message, curBranch);
            }.bind(this));

            if (namespace !== "INBOX" && curBranch.folders && Object.keys(curBranch.folders).length) {
                walkTree(curPath, separator, curBranch.folders, namespace);
            }
        }.bind(this));
    }.bind(this);

    // Ensure INBOX namespace always exists
    if (!this.storage.INBOX) {
        this.storage.INBOX = {};
    }

    Object.keys(this.storage).forEach(function (key) {
        if (key === "INBOX") {
            walkTree("", "/", this.storage, "INBOX");
        } else {
            this.storage[key].folders = this.storage[key].folders || {};
            this.storage[key].separator = this.storage[key].separator || key.substr(-1) || "/";
            this.storage[key].type = this.storage[key].type || "personal";

            if (this.storage[key].type === "personal" && this.referenceNamespace === false) {
                this.referenceNamespace = key;
            }

            walkTree(key, this.storage[key].separator, this.storage[key].folders, key);
        }
    }.bind(this));

    if (!this.referenceNamespace) {
        this.storage[""] = this.storage[""] || {};
        this.storage[""].folders = this.storage[""].folders || {};
        this.storage[""].separator = this.storage[""].separator || "/";
        this.storage[""].type = "personal";
        this.referenceNamespace = "";
    }

    if (!this.storage.INBOX.separator && this.referenceNamespace !== false) {
        this.storage.INBOX.separator = this.storage[this.referenceNamespace].separator;
    }

    if (this.referenceNamespace.substr(0, this.referenceNamespace.length - this.storage[this.referenceNamespace].separator.length).toUpperCase === "INBOX") {
        this.toggleFlags(this.storage.INBOX.flags, ["\\HasChildren", "\\HasNoChildren"], this.storage[this.referenceNamespace].folders && Object.keys(this.storage[this.referenceNamespace].folders).length ? 0 : 1);
    }

    this.folderCache = folders;
};

IMAPServer.prototype.processMailbox = function (path, mailbox, namespace) {
    mailbox.path = path;

    mailbox.namespace = namespace;
    mailbox.uid = mailbox.uid || 1;
    mailbox.uidvalidity = mailbox.uidvalidity || this.uidnextCache[path] || 1;
    mailbox.flags = [].concat(mailbox.flags || []);
    mailbox.allowPermanentFlags = "allowPermanentFlags" in mailbox ? mailbox.allowPermanentFlags : true;
    mailbox.permanentFlags = [].concat(mailbox.permanentFlags || this.systemFlags);

    mailbox.subscribed = "subscribed" in mailbox ? !!mailbox.subscribed : true;

    // ensure message array
    mailbox.messages = [].concat(mailbox.messages || []);

    // ensure highest uidnext
    mailbox.uidnext = Math.max.apply(Math, [mailbox.uidnext || 1].concat(mailbox.messages.map(function (message) {
        return (message.uid || 0) + 1;
    })));

    this.toggleFlags(mailbox.flags, ["\\HasChildren", "\\HasNoChildren"], mailbox.folders && Object.keys(mailbox.folders).length ? 0 : 1);
};

/**
 * Toggles listed flags. Vlags with `value` index will be turned on,
 * other listed fields are removed from the array
 *
 * @param {Array} flags List of flags
 * @param {Array} checkFlags Flags to toggle
 * @param {Number} value Flag from checkFlags array with value index is toggled
 */
IMAPServer.prototype.toggleFlags = function (flags, checkFlags, value) {
    [].concat(checkFlags || []).forEach(function (flag, i) {
        if (i === value) {
            this.ensureFlag(flags, flag);
        } else {
            this.removeFlag(flags, flag);
        }
    }.bind(this));
};

/**
 * Ensures that a list of flags includes selected flag
 *
 * @param {Array} flags An array of flags to check
 * @param {String} flag If the flag is missing, add it
 */
IMAPServer.prototype.ensureFlag = function (flags, flag) {
    if (flags.indexOf(flag) < 0) {
        flags.push(flag);
    }
};

/**
 * Removes a flag from a list of flags
 *
 * @param {Array} flags An array of flags to check
 * @param {String} flag If the flag is in the list, remove it
 */
IMAPServer.prototype.removeFlag = function (flags, flag) {
    var i;
    if (flags.indexOf(flag) >= 0) {
        for (i = flags.length - 1; i >= 0; i--) {
            if (flags[i] === flag) {
                flags.splice(i, 1);
            }
        }
    }
};

IMAPServer.prototype.processMessage = function (message, mailbox) {
    // internaldate should always be a Date object
    message.internaldate = message.internaldate || new Date();
    if (Object.prototype.toString.call(message.internaldate) === "[object Date]") {
        message.internaldate = this.formatInternalDate(message.internaldate);
    }
    message.flags = [].concat(message.flags || []);
    message.uid = message.uid || mailbox.uidnext++;

    // Allow plugins to process messages
    this.messageHandlers.forEach(function (handler) {
        handler(this, message, mailbox);
    }.bind(this));
};

/**
 * Appends a message to a mailbox
 *
 * @param {Object|String} mailbox Mailbox to append to
 * @param {Array} flags Flags for the message
 * @param {String|Date} internaldate Receive date-time for the message
 * @param {String} raw Message source
 * @param {Object} [ignoreConnection] To not advertise new message to selected connection
 * @return An object of the form { mailbox, message }
 */
IMAPServer.prototype.appendMessage = function (mailbox, flags, internaldate, raw, ignoreConnection) {
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }

    var message = {
        flags: flags,
        internaldate: internaldate,
        raw: raw
    };

    mailbox.messages.push(message);
    this.processMessage(message, mailbox);

    this.notify({
        tag: "*",
        attributes: [mailbox.messages.length, {
            type: "ATOM",
            value: "EXISTS"
        }]
    }, mailbox, ignoreConnection);

    return { mailbox: mailbox, message: message };
};

IMAPServer.prototype.matchFolders = function (reference, match) {
    var includeINBOX = false;

    if (reference === "" && this.referenceNamespace !== false) {
        reference = this.referenceNamespace;
        includeINBOX = true;
    }

    if (!this.storage[reference]) {
        return [];
    }

    var namespace = this.storage[reference],
        lookup = (reference || "") + match,
        result = [];

    var query = new RegExp("^" + lookup.
    // escape regex symbols
    replace(/([\\^$+?!.():=\[\]|,\-])/g, "\\$1").replace(/[*]/g, ".*").replace(/[%]/g, "[^" + namespace.separator.replace(/([\\^$+*?!.():=\[\]|,\-])/g, "\\$1") + "]*") + "$", "");

    if (includeINBOX && ((reference ? reference + namespace.separator : "") + "INBOX").match(query)) {
        result.push(this.folderCache.INBOX);
    }

    if (reference === "" && this.referenceNamespace !== false) {
        reference = this.referenceNamespace;
    }

    Object.keys(this.folderCache).forEach(function (path) {
        if (path.match(query) && (this.folderCache[path].flags.indexOf("\\NonExistent") < 0 || this.folderCache[path].path === match) && this.folderCache[path].namespace === reference) {
            result.push(this.folderCache[path]);
        }
    }.bind(this));

    return result;
};

/**
 * Retrieves an array of messages that fit in the specified range criteria
 *
 * @param {Object|String} mailbox Mailbox to look for the messages
 * @param {String} range Message range (eg. "*:4,5,7:9")
 * @param {Boolean} isUid If true, use UID values, not sequence indexes for comparison
 * @return {Array} An array of messages in the form of [[seqIndex, message]]
 */
IMAPServer.prototype.getMessageRange = function (mailbox, range, isUid) {
    range = (range || "").toString();
    if (typeof mailbox === "string") {
        mailbox = this.getMailbox(mailbox);
    }

    var result = [],
        rangeParts = range.split(","),
        messages = Array.isArray(mailbox) ? mailbox : mailbox.messages,
        uid,
        totalMessages = messages.length,
        maxUid = 0,
        inRange = function inRange(nr, ranges, total) {
        var range, from, to;
        for (var i = 0, len = ranges.length; i < len; i++) {
            range = ranges[i];
            to = range.split(":");
            from = to.shift();
            if (from === "*") {
                from = total;
            }
            from = Number(from) || 1;
            to = to.pop() || from;
            to = Number(to === "*" && total || to) || from;

            if (nr >= Math.min(from, to) && nr <= Math.max(from, to)) {
                return true;
            }
        }
        return false;
    };

    messages.forEach(function (message) {
        if (message.uid > maxUid) {
            maxUid = message.uid;
        }
    });

    for (var i = 0, len = messages.length; i < len; i++) {
        uid = messages[i].uid || 1;
        if (inRange(isUid ? uid : i + 1, rangeParts, isUid ? maxUid : totalMessages)) {
            result.push([i + 1, messages[i]]);
        }
    }

    return result;
};

function IMAPConnection(server, socket) {
    this.server = server;
    this.socket = socket;
    this.options = this.server.options;

    this.state = "Not Authenticated";

    this.secureConnection = !!this.options.secureConnection;

    this._remainder = "";
    this._command = "";
    this._literalRemaining = 0;

    this.inputHandler = false;

    this._commandQueue = [];
    this._processing = false;

    if (this.options.debug) {
        this.socket.pipe(process.stdout);
    }

    this.socket.on("data", this.onData.bind(this));
    this.socket.on("close", this.onClose.bind(this));
    this.socket.on("error", this.onError.bind(this));

    if (this.server.notifiable) {
        this.directNotifications = false;
        this._notificationCallback = this.onNotify.bind(this);
        this.notificationQueue = [];
        this.server.on("notify", this._notificationCallback);
    }

    this.socket.write("* OK Hoodiecrow ready for rumble\r\n");
}

IMAPConnection.prototype.onClose = function () {
    this.socket.removeAllListeners();
    this.socket = null;
    try {
        this.socket.end();
    } catch (E) {}
    if (this.server.notifiable) {
        this.server.removeListener("notify", this._notificationCallback);
    }
};

IMAPConnection.prototype.onError = function (err) {
    if (this.options.debug) {
        console.log("Socket error event emitted, %s", Date());
        console.log(err);
    }
    try {
        this.socket.end();
    } catch (E) {}
};

IMAPConnection.prototype.onData = function (chunk) {
    var match, str;

    str = (chunk || "").toString("binary");

    if (this._literalRemaining) {
        if (this._literalRemaining > str.length) {
            this._literalRemaining -= str.length;
            this._command += str;
            return;
        }
        this._command += str.substr(0, this._literalRemaining);
        str = str.substr(this._literalRemaining);
        this._literalRemaining = 0;
    }

    this._remainder = str = this._remainder + str;
    while (match = str.match(/(\{(\d+)(\+)?\})?\r?\n/)) {
        if (!match[2]) {

            if (this.inputHandler) {
                this.inputHandler(this._command + str.substr(0, match.index));
            } else {
                this.scheduleCommand(this._command + str.substr(0, match.index));
            }

            this._remainder = str = str.substr(match.index + match[0].length);
            this._command = "";
            continue;
        }

        if (match[3] !== "+") {
            if (this.socket && !this.socket.destroyed) {
                this.socket.write("+ Go ahead\r\n");
            }
        }

        this._remainder = "";
        this._command += str.substr(0, match.index + match[0].length);
        this._literalRemaining = Number(match[2]);

        str = str.substr(match.index + match[0].length);

        if (this._literalRemaining > str.length) {
            this._command += str;
            this._literalRemaining -= str.length;
            return;
        } else {
            this._command += str.substr(0, this._literalRemaining);
            this._remainder = str = str.substr(this._literalRemaining);
            this._literalRemaining = 0;
        }
    }
};

IMAPConnection.prototype.onNotify = function (notification) {
    if (notification.ignoreConnection === this) {
        return;
    }
    if (!notification.mailbox || this.selectedMailbox && this.selectedMailbox === (typeof notification.mailbox === "string" && this.getMailbox(notification.mailbox) || notification.mailbox)) {
        this.notificationQueue.push(notification.command);
        if (this.directNotifications) {
            this.processNotifications();
        }
    }
};

IMAPConnection.prototype.upgradeConnection = function (callback) {
    this.upgrading = true;

    this.options.credentials.ciphers = this.options.credentials.ciphers || "ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+3DES:!aNULL:!MD5:!DSS";
    if (!("honorCipherOrder" in this.options.credentials)) {
        this.options.credentials.honorCipherOrder = true;
    }

    var secureContext = tls.createSecureContext(this.options.credentials);
    var socketOptions = {
        secureContext: secureContext,
        isServer: true,
        server: this.server.server,

        // throws if SNICallback is missing, so we set a default callback
        SNICallback: function SNICallback(servername, cb) {
            cb(null, secureContext);
        }
    };

    // remove all listeners from the original socket besides the error handler
    this.socket.removeAllListeners();
    this.socket.on("error", this.onError.bind(this));

    // upgrade connection
    var secureSocket = new tls.TLSSocket(this.socket, socketOptions);

    secureSocket.on("close", this.onClose.bind(this));
    secureSocket.on("error", this.onError.bind(this));
    secureSocket.on("clientError", this.onError.bind(this));

    secureSocket.on("secure", function () {
        this.secureConnection = true;
        this.socket = secureSocket;
        this.upgrading = false;
        this.socket.on("data", this.onData.bind(this));
        callback();
    }.bind(this));
};

IMAPConnection.prototype.processNotifications = function (data) {
    var notification;
    for (var i = 0; i < this.notificationQueue.length; i++) {
        notification = this.notificationQueue[i];

        if (data && ["FETCH", "STORE", "SEARCH"].indexOf((data.command || "").toUpperCase()) >= 0) {
            continue;
        }

        this.send(notification);
        this.notificationQueue.splice(i, 1);
        i--;
        continue;
    }
};

function readFile(filepath) {
    return new Promise(function (resolve, reject) {
        var data = '';
        var rs = fs.createReadStream(filepath, 'utf8');
        rs.on('data', function (chunk) {
            return data += chunk;
        });
        rs.on('end', function () {
            resolve(data);
            rs.close();
        });
        rs.on('error', function (e) {
            return reject(e);
        });
    });
}
/**
 * Compile a command object to a response string and write it to socket.
 * If the command object has a skipResponse property, the command is
 * ignored
 *
 * @param {Object} response Response IMAP command object to be compiled.
 * @param {String} description
 *   An upper-case string uniquely identifying the response for the benefit of
 *   output handlers that wish to augment/replace the given response.
 * @param {Object} parsed
 *   Original parsed IMAP command that this is in response to.
 * @param {String} data
 *   Original raw IMAP command as a binary string.
 * @param {Object} extra
 *   Response-specific payload, usually the subject of the response.  For
 *   example, the STORE command will pass the impacted message for each updated
 *   FETCH result.  (This may have other names when used, like "affected".)
 */
IMAPConnection.prototype.send = function (response, description, parsed) {
    var _this = this,
        _arguments = arguments;

    return new Promise(function () {
        var _ref = _asyncToGenerator(regeneratorRuntime.mark(function _callee(resolve, reject) {
            var args, compiled, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, file;

            return regeneratorRuntime.wrap(function _callee$(_context) {
                while (1) {
                    switch (_context.prev = _context.next) {
                        case 0:
                            if (!_this.socket || _this.socket.destroyed) {
                                resolve();
                            }

                            if (_this.server.notifiable && !response.notification && response.tag !== "*") {
                                // arguments[2] should be the original command
                                _this.processNotifications(parsed);
                            } else {
                                // override values etc.
                            }

                            args = Array.prototype.slice.call(_arguments);

                            _this.server.outputHandlers.forEach(function (handler) {
                                handler.apply(null, [this].concat(args));
                            }.bind(_this));

                            // No need to display this response to user
                            if (response.skipResponse) {
                                resolve();
                            }

                            compiled = imapHandler.compiler(response) || '';


                            if (_this.options.debug) {
                                console.log("SEND: %s", compiled);
                            }

                            if (!response.files) {
                                _context.next = 41;
                                break;
                            }

                            _iteratorNormalCompletion = true;
                            _didIteratorError = false;
                            _iteratorError = undefined;
                            _context.prev = 11;
                            _iterator = response.files[Symbol.iterator]();

                        case 13:
                            if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
                                _context.next = 27;
                                break;
                            }

                            file = _step.value;
                            _context.prev = 15;
                            _context.next = 18;
                            return readFile(file);

                        case 18:
                            compiled += _context.sent;
                            _context.next = 24;
                            break;

                        case 21:
                            _context.prev = 21;
                            _context.t0 = _context["catch"](15);

                            reject(_context.t0);

                        case 24:
                            _iteratorNormalCompletion = true;
                            _context.next = 13;
                            break;

                        case 27:
                            _context.next = 33;
                            break;

                        case 29:
                            _context.prev = 29;
                            _context.t1 = _context["catch"](11);
                            _didIteratorError = true;
                            _iteratorError = _context.t1;

                        case 33:
                            _context.prev = 33;
                            _context.prev = 34;

                            if (!_iteratorNormalCompletion && _iterator.return) {
                                _iterator.return();
                            }

                        case 36:
                            _context.prev = 36;

                            if (!_didIteratorError) {
                                _context.next = 39;
                                break;
                            }

                            throw _iteratorError;

                        case 39:
                            return _context.finish(36);

                        case 40:
                            return _context.finish(33);

                        case 41:
                            if (_this.socket && !_this.socket.destroyed) {
                                _this.socket.write(new Buffer(compiled + "\r\n", "binary"));
                                resolve();
                            }
                            reject();

                        case 43:
                        case "end":
                            return _context.stop();
                    }
                }
            }, _callee, _this, [[11, 29, 33, 41], [15, 21], [34,, 36, 40]]);
        }));

        return function (_x, _x2) {
            return _ref.apply(this, arguments);
        };
    }());
};

IMAPConnection.prototype.scheduleCommand = function () {
    var _ref2 = _asyncToGenerator(regeneratorRuntime.mark(function _callee2(data) {
        var parsed, tag;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
            while (1) {
                switch (_context2.prev = _context2.next) {
                    case 0:
                        tag = (data.match(/\s*([^\s]+)/) || [])[1] || "*";
                        _context2.prev = 1;

                        parsed = imapHandler.parser(data, {
                            literalPlus: this.server.literalPlus
                        });
                        _context2.next = 10;
                        break;

                    case 5:
                        _context2.prev = 5;
                        _context2.t0 = _context2["catch"](1);

                        this.send({
                            tag: "*",
                            command: "BAD",
                            attributes: [{
                                type: "SECTION",
                                section: [{
                                    type: "ATOM",
                                    value: "SYNTAX"
                                }]
                            }, {
                                type: "TEXT",
                                value: _context2.t0.message
                            }]
                        }, "ERROR MESSAGE", null, data, _context2.t0);

                        this.send({
                            tag: tag,
                            command: "BAD",
                            attributes: [{
                                type: "TEXT",
                                value: "Error parsing command"
                            }]
                        }, "ERROR RESPONSE", null, data, _context2.t0);

                        return _context2.abrupt("return");

                    case 10:
                        if (!this.server.getCommandHandler(parsed.command)) {
                            _context2.next = 16;
                            break;
                        }

                        this._commandQueue.push({
                            parsed: parsed,
                            data: data
                        });
                        _context2.next = 14;
                        return this.processQueue();

                    case 14:
                        _context2.next = 17;
                        break;

                    case 16:
                        this.send({
                            tag: parsed.tag,
                            command: "BAD",
                            attributes: [{
                                type: "TEXT",
                                value: "Invalid command " + parsed.command + ""
                            }]
                        }, "UNKNOWN COMMAND", parsed, data);

                    case 17:
                    case "end":
                        return _context2.stop();
                }
            }
        }, _callee2, this, [[1, 5]]);
    }));

    return function (_x3) {
        return _ref2.apply(this, arguments);
    };
}();

IMAPConnection.prototype.processQueue = function () {
    var _ref3 = _asyncToGenerator(regeneratorRuntime.mark(function _callee3(force) {
        var element;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
            while (1) {
                switch (_context3.prev = _context3.next) {
                    case 0:
                        if (!(!force && this._processing)) {
                            _context3.next = 2;
                            break;
                        }

                        return _context3.abrupt("return");

                    case 2:
                        if (this._commandQueue.length) {
                            _context3.next = 5;
                            break;
                        }

                        this._processing = false;
                        return _context3.abrupt("return");

                    case 5:

                        this._processing = true;

                        element = this._commandQueue.shift();
                        _context3.prev = 7;
                        _context3.next = 10;
                        return this.server.getCommandHandler(element.parsed.command)(this, element.parsed, element.data, function () {
                            if (!this._commandQueue.length) {
                                this._processing = false;
                            } else {
                                this.processQueue(true);
                            }
                        }.bind(this));

                    case 10:
                        _context3.next = 16;
                        break;

                    case 12:
                        _context3.prev = 12;
                        _context3.t0 = _context3["catch"](7);

                        console.error("Error processing command:", _context3.t0, "\n", _context3.t0.stack);
                        this.send({
                            tag: element.parsed.tag,
                            command: "NO",
                            attributes: [{
                                type: "TEXT",
                                value: "Server error: " + _context3.t0 + ""
                            }]
                        }, "SERVER ERROR", element.parsed, element.data);

                    case 16:
                    case "end":
                        return _context3.stop();
                }
            }
        }, _callee3, this, [[7, 12]]);
    }));

    return function (_x4) {
        return _ref3.apply(this, arguments);
    };
}();

/**
 * Removes messages with \Deleted flag
 *
 * @param {Object} mailbox Mailbox to check for
 * @param {Boolean} [ignoreSelf] If set to true, does not send any notices to itself
 * @param {Boolean} [ignoreSelf] If set to true, does not send EXISTS notice to itself
 */
IMAPConnection.prototype.expungeDeleted = function (mailbox, ignoreSelf, ignoreExists) {
    this.expungeSpecificMessages(mailbox, function (message) {
        return message.flags.indexOf("\\Deleted") >= 0;
    }, ignoreSelf, ignoreExists);
};

/**
 * Given a set of messages in a mailbox (possibly via getMessageRange), remove
 * them from the mailbox and generate EXPUNGE notifications.
 *
 * @param {Object} mailbox Mailbox to check for
 * @param {Function|Array} messagesOrFilterFunc An Array of messages in the
 *     folder that should be removed or a filtering function that indicates
 *     messages to be removed by returning true.
 * @param {Boolean} [ignoreSelf] If set to true, does not send any notices to itself
 * @param {Boolean} [ignoreSelf] If set to true, does not send EXISTS notice to itself
 */
IMAPConnection.prototype.expungeSpecificMessages = function (mailbox, messagesOrFilterFunc, ignoreSelf, ignoreExists) {
    var deleted = 0,

    // old copy is required for those sessions that run FETCH before
    // displaying the EXPUNGE notice
    mailboxCopy = [].concat(mailbox.messages);

    var filterFunc;
    if (Array.isArray(messagesOrFilterFunc)) {
        var messages = messagesOrFilterFunc;
        filterFunc = function filterFunc(message) {
            return messages.indexOf(message) >= 0;
        };
    } else {
        filterFunc = messagesOrFilterFunc;
    }

    for (var i = 0; i < mailbox.messages.length; i++) {
        var message = mailbox.messages[i];
        if (filterFunc(message)) {
            deleted++;
            mailbox.messages[i].ghost = true;
            mailbox.messages.splice(i, 1);
            this.server.notify({
                tag: "*",
                attributes: [i + 1, {
                    type: "ATOM",
                    value: "EXPUNGE"
                }]
            }, mailbox, ignoreSelf ? this : false);
            i--;
        }
    }

    if (deleted) {
        this.server.notify({
            tag: "*",
            attributes: [mailbox.messages.length, {
                type: "ATOM",
                value: "EXISTS"
            }],
            // distribute the old mailbox data with the notification
            mailboxCopy: mailboxCopy
        }, mailbox, ignoreSelf || ignoreExists ? this : false);
    }
};