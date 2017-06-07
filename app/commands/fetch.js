"use strict";

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

var fetchHandlers = require("./handlers/fetch");

module.exports = function () {
    var _ref = _asyncToGenerator(regeneratorRuntime.mark(function _callee(connection, parsed, data, callback) {
        var messages, i, len, range, params, macros, flagsExist, forceSeen, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, rangeMessage, name, key, handler, response, files, value;

        return regeneratorRuntime.wrap(function _callee$(_context) {
            while (1) {
                switch (_context.prev = _context.next) {
                    case 0:
                        if (!(!parsed.attributes || parsed.attributes.length !== 2 || !parsed.attributes[0] || ["ATOM", "SEQUENCE"].indexOf(parsed.attributes[0].type) < 0 || !parsed.attributes[1] || ["ATOM"].indexOf(parsed.attributes[1].type) < 0 && !Array.isArray(parsed.attributes[1]))) {
                            _context.next = 3;
                            break;
                        }

                        connection.send({
                            tag: parsed.tag,
                            command: "BAD",
                            attributes: [{
                                type: "TEXT",
                                value: "FETCH expects sequence set and message item names"
                            }]
                        }, "INVALID COMMAND", parsed, data);
                        return _context.abrupt("return", callback());

                    case 3:
                        if (!(connection.state !== "Selected")) {
                            _context.next = 6;
                            break;
                        }

                        connection.send({
                            tag: parsed.tag,
                            command: "BAD",
                            attributes: [{
                                type: "TEXT",
                                value: "Select mailbox first"
                            }]
                        }, "FETCH FAILED", parsed, data);
                        return _context.abrupt("return", callback());

                    case 6:
                        messages = connection.selectedMailbox.messages;
                        i = 0, len = connection.notificationQueue.length;

                    case 8:
                        if (!(i < len)) {
                            _context.next = 15;
                            break;
                        }

                        if (!connection.notificationQueue[i].mailboxCopy) {
                            _context.next = 12;
                            break;
                        }

                        messages = connection.notificationQueue[i].mailboxCopy;
                        return _context.abrupt("break", 15);

                    case 12:
                        i++;
                        _context.next = 8;
                        break;

                    case 15:
                        range = connection.server.getMessageRange(messages, parsed.attributes[0].value, false), params = [].concat(parsed.attributes[1] || []), macros = {
                            "ALL": ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"],
                            "FAST": ["FLAGS", "INTERNALDATE", "RFC822.SIZE"],
                            "FULL": ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE", "BODY"]
                        };


                        if (parsed.attributes[1].type === "ATOM" && macros.hasOwnProperty(parsed.attributes[1].value.toUpperCase())) {
                            params = macros[parsed.attributes[1].value.toUpperCase()];
                        }

                        _context.prev = 17;
                        flagsExist = false, forceSeen = false;


                        params.forEach(function (param, i) {
                            if (!param || typeof param !== "string" && param.type !== "ATOM") {
                                throw new Error("Invalid FETCH argument #" + (i + 1));
                            }

                            if (typeof param === "string") {
                                param = params[i] = {
                                    type: "ATOM",
                                    value: param
                                };
                            }

                            if (param.value.toUpperCase() === "FLAGS") {
                                flagsExist = true;
                            }

                            if (!connection.readOnly) {
                                if (param.value.toUpperCase() === "BODY" && param.section) {
                                    forceSeen = true;
                                } else if (["RFC822", "RFC822.HEADER"].indexOf(param.value.toUpperCase()) >= 0) {
                                    forceSeen = true;
                                }
                            }
                        });

                        if (forceSeen && !flagsExist) {
                            params.push({
                                type: "ATOM",
                                value: "FLAGS"
                            });
                        }

                        _iteratorNormalCompletion = true;
                        _didIteratorError = false;
                        _iteratorError = undefined;
                        _context.prev = 24;
                        _iterator = range[Symbol.iterator]();

                    case 26:
                        if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
                            _context.next = 57;
                            break;
                        }

                        rangeMessage = _step.value;
                        response = [], files = [];
                        i = 0, len = connection.server.fetchFilters.length;

                    case 30:
                        if (!(i < len)) {
                            _context.next = 36;
                            break;
                        }

                        if (connection.server.fetchFilters[i](connection, rangeMessage[1], parsed, rangeMessage[0])) {
                            _context.next = 33;
                            break;
                        }

                        return _context.abrupt("return");

                    case 33:
                        i++;
                        _context.next = 30;
                        break;

                    case 36:

                        if (forceSeen && rangeMessage[1].flags.indexOf("\\Seen") < 0) {
                            rangeMessage[1].flags.push("\\Seen");
                        }

                        if (rangeMessage[1].file) {
                            files.push(rangeMessage[1].file);
                        }

                        i = 0, len = params.length;

                    case 39:
                        if (!(i < len)) {
                            _context.next = 52;
                            break;
                        }

                        key = (params[i].value || "").toUpperCase();

                        handler = connection.server.fetchHandlers[key] || fetchHandlers[key];

                        if (handler) {
                            _context.next = 44;
                            break;
                        }

                        throw new Error("Invalid FETCH argument " + (key ? " " + key : "#" + (i + 1)));

                    case 44:

                        value = handler(connection, rangeMessage[1], params[i]);

                        name = typeof params[i] === "string" ? {
                            type: "ATOM",
                            value: key
                        } : params[i];
                        name.value = name.value.replace(/\.PEEK\b/i, "");
                        response.push(name);
                        response.push(value);

                    case 49:
                        i++;
                        _context.next = 39;
                        break;

                    case 52:
                        _context.next = 54;
                        return connection.send({
                            files: files,
                            tag: "*",
                            attributes: [rangeMessage[0], {
                                type: "ATOM",
                                value: "FETCH"
                            }, response]
                        }, "FETCH", parsed, data);

                    case 54:
                        _iteratorNormalCompletion = true;
                        _context.next = 26;
                        break;

                    case 57:
                        _context.next = 63;
                        break;

                    case 59:
                        _context.prev = 59;
                        _context.t0 = _context["catch"](24);
                        _didIteratorError = true;
                        _iteratorError = _context.t0;

                    case 63:
                        _context.prev = 63;
                        _context.prev = 64;

                        if (!_iteratorNormalCompletion && _iterator.return) {
                            _iterator.return();
                        }

                    case 66:
                        _context.prev = 66;

                        if (!_didIteratorError) {
                            _context.next = 69;
                            break;
                        }

                        throw _iteratorError;

                    case 69:
                        return _context.finish(66);

                    case 70:
                        return _context.finish(63);

                    case 71:
                        _context.next = 77;
                        break;

                    case 73:
                        _context.prev = 73;
                        _context.t1 = _context["catch"](17);

                        connection.send({
                            tag: parsed.tag,
                            command: "BAD",
                            attributes: [{
                                type: "TEXT",
                                value: _context.t1.message
                            }]
                        }, "FETCH FAILED", parsed, data);
                        return _context.abrupt("return", callback());

                    case 77:

                        connection.send({
                            tag: parsed.tag,
                            command: "OK",
                            attributes: [{
                                type: "TEXT",
                                value: "FETCH Completed"
                            }]
                        }, "FETCH", parsed, data);
                        return _context.abrupt("return", callback());

                    case 79:
                    case "end":
                        return _context.stop();
                }
            }
        }, _callee, this, [[17, 73], [24, 59, 63, 71], [64,, 66, 70]]);
    }));

    return function (_x, _x2, _x3, _x4) {
        return _ref.apply(this, arguments);
    };
}();