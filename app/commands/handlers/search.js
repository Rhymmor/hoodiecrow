"use strict";

var mimeParser = require("../../mimeparser");

module.exports = function (connection, messageSource, params) {
    var totalResults = [],
        nrCache = {},
        query,
        charset,
        queryParams = {
        "BCC": ["VALUE"],
        "BEFORE": ["VALUE"],
        "BODY": ["VALUE"],
        "CC": ["VALUE"],
        "FROM": ["VALUE"],
        "HEADER": ["VALUE", "VALUE"],
        "KEYWORD": ["VALUE"],
        "LARGER": ["VALUE"],
        "NOT": ["COMMAND"],
        "ON": ["VALUE"],
        "OR": ["COMMAND", "COMMAND"],
        "SENTBEFORE": ["VALUE"],
        "SENTON": ["VALUE"],
        "SENTSINCE": ["VALUE"],
        "SINCE": ["VALUE"],
        "SMALLER": ["VALUE"],
        "SUBJECT": ["VALUE"],
        "TEXT": ["VALUE"],
        "TO": ["VALUE"],
        "UID": ["VALUE"],
        "UNKEYWORD": ["VALUE"]
    },
        composeQuery = function composeQuery(params) {
        params = [].concat(params || []);

        var pos = 0,
            param,
            returnParams = [];

        var getParam = function getParam(level) {
            level = level || 0;
            if (pos >= params.length) {
                return undefined;
            }

            var param = params[pos++],
                paramTypes = queryParams[param.toUpperCase()] || [],
                paramCount = paramTypes.length,
                curParams = [param.toUpperCase()];

            if (paramCount) {
                for (var i = 0, len = paramCount; i < len; i++) {
                    switch (paramTypes[i]) {
                        case "VALUE":
                            curParams.push(params[pos++]);
                            break;
                        case "COMMAND":
                            curParams.push(getParam(level + 1));
                            break;
                    }
                }
            }
            return curParams;
        };

        while (typeof (param = getParam()) !== "undefined") {
            returnParams.push(param);
        }

        return returnParams;
    },
        searchFlags = function searchFlags(flag, flagExists) {
        var results = [];
        messageSource.forEach(function (message, i) {
            if (flagExists && message.flags.indexOf(flag) >= 0 || !flagExists && message.flags.indexOf(flag) < 0) {
                nrCache[message.uid] = i + 1;
                results.push(message);
            }
        });
        return results;
    },
        searchHeaders = function searchHeaders(key, value, includeEmpty) {
        var results = [];
        key = (key || "").toString().toLowerCase();
        value = (value || "").toString();
        if (!value && !includeEmpty) {
            return [];
        }

        messageSource.forEach(function (message, i) {
            if (!message.parsed) {
                message.parsed = mimeParser(message.raw || "");
            }
            var headers = message.parsed.header || [],
                parts,
                lineKey,
                lineValue;

            for (var j = 0, len = headers.length; j < len; j++) {
                parts = headers[j].split(":");
                lineKey = (parts.shift() || "").trim().toLowerCase();
                lineValue = parts.join(":") || "";

                if (lineKey === key && (!value || lineValue.toLowerCase().indexOf(value.toLowerCase()) >= 0)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                    return;
                }
            }
        });
        return results;
    },
        queryHandlers = {
        "_SEQ": function _SEQ(sequence) {
            return connection.server.getMessageRange(messageSource, sequence).map(function (item) {
                nrCache[item[1].uid] = item[0];
                return item[1];
            });
        },
        "ALL": function ALL() {
            return messageSource.map(function (message, i) {
                nrCache[message.uid] = i + 1;
                return message;
            });
        },
        "ANSWERED": function ANSWERED() {
            return searchFlags("\\Answered", true);
        },
        "BCC": function BCC(value) {
            return searchHeaders("BCC", value);
        },
        "BEFORE": function BEFORE(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (new Date(message.internaldate.substr(0, 11)).toISOString().substr(0, 10) < new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "BODY": function BODY(value) {
            var results = [];
            value = (value || "").toString();
            if (!value) {
                return [];
            }

            messageSource.forEach(function (message, i) {
                if (!message.parsed) {
                    message.parsed = mimeParser(message.raw || "");
                }
                if ((message.parsed.text || "").toLowerCase().indexOf(value.toLowerCase()) >= 0) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "CC": function CC(value) {
            return searchHeaders("CC", value);
        },
        "DELETED": function DELETED() {
            return searchFlags("\\Deleted", true);
        },
        "DRAFT": function DRAFT() {
            return searchFlags("\\Draft", true);
        },
        "FLAGGED": function FLAGGED() {
            return searchFlags("\\Flagged", true);
        },
        "FROM": function FROM(value) {
            return searchHeaders("FROM", value);
        },
        "HEADER": function HEADER(key, value) {
            return searchHeaders(key, value, true);
        },
        "KEYWORD": function KEYWORD(flag) {
            return searchFlags(flag, true);
        },
        "LARGER": function LARGER(size) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if ((message.raw || "").length >= Number(size)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "NEW": function NEW() {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (message.flags.indexOf("\\Recent") >= 0 && message.flags.indexOf("\\Seen") < 0) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "NOT": function NOT(q) {
            if (!queryHandlers[q[0]] && q[0].match(/^[\d\,\:\*]+$/)) {
                q.unshift("_SEQ");
            } else if (!queryHandlers[q[0]]) {
                throw new Error("NO Invalid query element: " + q[0] + " (Failure)");
            }

            var notResults = queryHandlers[q.shift()].apply(connection, q),
                results = [];

            messageSource.forEach(function (message, i) {
                if (notResults.indexOf(message) < 0) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "OLD": function OLD() {
            return searchFlags("\\Recent", false);
        },
        "ON": function ON(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (new Date(message.internaldate.substr(0, 11)).toISOString().substr(0, 10) === new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "OR": function OR(left, right) {
            var jointResult = [],
                leftResults,
                rightResults;

            if (!queryHandlers[left[0]] && left[0].match(/^[\d\,\:\*]+$/)) {
                left.unshift("_SEQ");
            } else if (!queryHandlers[left[0]]) {
                throw new Error("NO Invalid query element: " + left[0] + " (Failure)");
            }

            if (!queryHandlers[right[0]] && right[0].match(/^[\d\,\:\*]+$/)) {
                right.unshift("_SEQ");
            } else if (!queryHandlers[right[0]]) {
                throw new Error("NO Invalid query element: " + right[0] + " (Failure)");
            }

            leftResults = queryHandlers[left.shift()].apply(connection, left);
            rightResults = queryHandlers[right.shift()].apply(connection, right);

            jointResult = jointResult.concat(leftResults);
            rightResults.forEach(function (message) {
                if (jointResult.indexOf(message) < 0) {
                    jointResult.push(message);
                }
            });

            return jointResult;
        },
        "RECENT": function RECENT() {
            return searchFlags("\\Recent", true);
        },
        "SEEN": function SEEN() {
            return searchFlags("\\Seen", true);
        },
        "SENTBEFORE": function SENTBEFORE(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (!message.parsed) {
                    message.parsed = mimeParser(message.raw || "");
                }
                var messageDate = message.parsed.parsedHeader.date || message.internaldate;
                if (Object.prototype.toString.call(messageDate) !== "[object Date]") {
                    messageDate = new Date(messageDate.substr(0, 11));
                }
                if (messageDate.toISOString().substr(0, 10) < new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "SENTON": function SENTON(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (!message.parsed) {
                    message.parsed = mimeParser(message.raw || "");
                }
                var messageDate = message.parsed.parsedHeader.date || message.internaldate;
                if (Object.prototype.toString.call(messageDate) !== "[object Date]") {
                    messageDate = new Date(messageDate.substr(0, 11));
                }
                if (messageDate.toISOString().substr(0, 10) === new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "SENTSINCE": function SENTSINCE(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (!message.parsed) {
                    message.parsed = mimeParser(message.raw || "");
                }
                var messageDate = message.parsed.parsedHeader.date || message.internaldate;
                if (Object.prototype.toString.call(messageDate) !== "[object Date]") {
                    messageDate = new Date(messageDate.substr(0, 11));
                }
                if (messageDate.toISOString().substr(0, 10) >= new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "SINCE": function SINCE(date) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if (new Date(message.internaldate.substr(0, 11)).toISOString().substr(0, 10) >= new Date(date).toISOString().substr(0, 10)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "SMALLER": function SMALLER(size) {
            var results = [];
            messageSource.forEach(function (message, i) {
                if ((message.raw || "").length < Number(size)) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "SUBJECT": function SUBJECT(value) {
            return searchHeaders("SUBJECT", value);
        },
        "TEXT": function TEXT(value) {
            var results = [];
            value = (value || "").toString();
            if (!value) {
                return [];
            }

            messageSource.forEach(function (message, i) {
                if ((message.raw || "").toString().toLowerCase().indexOf(value.toLowerCase()) >= 0) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        },
        "TO": function TO(value) {
            return searchHeaders("TO", value);
        },
        "UID": function UID(sequence) {
            return connection.server.getMessageRange(messageSource, sequence, true).map(function (item) {
                nrCache[item[1].uid] = item[0];
                return item[1];
            });
        },
        "UNANSWERED": function UNANSWERED() {
            return searchFlags("\\Answered", false);
        },
        "UNDELETED": function UNDELETED() {
            return searchFlags("\\Deleted", false);
        },
        "UNDRAFT": function UNDRAFT() {
            return searchFlags("\\Draft", false);
        },
        "UNFLAGGED": function UNFLAGGED() {
            return searchFlags("\\Flagged", false);
        },
        "UNKEYWORD": function UNKEYWORD(flag) {
            return searchFlags(flag, false);
        },
        "UNSEEN": function UNSEEN() {
            return searchFlags("\\Seen", false);
        }
    };

    Object.keys(connection.server.searchHandlers).forEach(function (key) {

        // if handler takes more than 3 params (mailbox, message, i), use the remaining as value params
        if (!(key in queryParams) && connection.server.searchHandlers[key].length > 3) {
            queryParams[key] = [];
            for (var i = 0, len = connection.server.searchHandlers[key].length - 3; i < len; i++) {
                queryParams[key].push("VALUE");
            }
        }

        queryHandlers[key] = function () {
            var args = Array.prototype.slice.call(arguments),
                results = [];

            // check all messages against the user defined function
            messageSource.forEach(function (message, i) {
                if (connection.server.searchHandlers[key].apply(null, [connection, message, i + 1].concat(args))) {
                    nrCache[message.uid] = i + 1;
                    results.push(message);
                }
            });
            return results;
        };
    });

    // FIXME: charset is currently ignored
    if ((params[0] || "").toString().toUpperCase() === "CHARSET") {
        params.shift(); // CHARSET
        charset = params.shift(); // value
    }

    query = composeQuery(params);
    query.forEach(function (q, i) {

        if (!queryHandlers[q[0]] && q[0].match(/^[\d\,\:\*]+$/)) {
            q.unshift("_SEQ");
        } else if (!queryHandlers[q[0]]) {
            throw new Error("NO Invalid query element: " + q[0] + " (Failure)");
        }

        var key = q.shift(),
            handler = queryHandlers[key],
            currentResult = handler && handler.apply(connection, q) || [];

        if (!i) {
            totalResults = [].concat(currentResult || []);
        } else {
            for (var j = totalResults.length - 1; j >= 0; j--) {
                if (currentResult.indexOf(totalResults[j]) < 0) {
                    totalResults.splice(j, 1);
                }
            }
        }
    });
    return {
        list: totalResults,
        numbers: nrCache
    };
};