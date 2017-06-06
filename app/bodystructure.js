"use strict";

var envelope = require("./envelope"),
    mimeParser = require("./mimeparser");

// Expose to the world
module.exports = createBodystructure;

/**
 * Generates an object out of parsed mime tree, that can be
 * serialized into a BODYSTRUCTURE string
 *
 * @param {Object} tree Parsed mime tree (see mimeparser.js for input)
 * @param {Object} [options] Optional options object
 * @param {Boolean} [options.contentLanguageString] If true, convert single element array to string for Content-Language
 * @param {Boolean} [options.upperCaseKeys] If true, use only upper case key names
 * @param {Boolean} [options.skipContentLocation] If true, do not include Content-Location in the output
 * @param {Boolean} [options.body] If true, skip extension fields (needed for BODY)
 * @param {Object} Object structure in the form of BODYSTRUCTURE
 */
function createBodystructure(tree, options) {
    options = options || {};

    var walker = function walker(node) {
        switch ((node.parsedHeader["content-type"] || {}).type) {
            case "multipart":
                return processMultipartNode(node, options);
            case "text":
                return processTextNode(node, options);
            case "message":
                if (!options.attachmentRFC822) {
                    return processRFC822Node(node, options);
                }
                return processAttachmentNode(node, options);
            default:
                return processAttachmentNode(node, options);
        }
    };
    return walker(tree);
}

/**
 * Generates a list of basic fields any non-multipart part should have
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} A list of basic fields
 */
function getBasicFields(node, options) {
    var bodyType = node.parsedHeader["content-type"] && node.parsedHeader["content-type"].type || null,
        bodySubtype = node.parsedHeader["content-type"] && node.parsedHeader["content-type"].subtype || null,
        contentTransfer = node.parsedHeader["content-transfer-encoding"] || "7bit";

    return [
    // body type
    options.upperCaseKeys ? bodyType && bodyType.toUpperCase() || null : bodyType,
    // body subtype
    options.upperCaseKeys ? bodySubtype && bodySubtype.toUpperCase() || null : bodySubtype,
    // body parameter parenthesized list
    node.parsedHeader["content-type"] && node.parsedHeader["content-type"].hasParams && flatten(Object.keys(node.parsedHeader["content-type"].params).map(function (key) {
        return [options.upperCaseKeys ? key.toUpperCase() : key, node.parsedHeader["content-type"].params[key]];
    })) || null,
    // body id
    node.parsedHeader["content-id"] || null,
    // body description
    node.parsedHeader["content-description"] || null,
    // body encoding
    options.upperCaseKeys ? contentTransfer && contentTransfer.toUpperCase() || "7bit" : contentTransfer,
    // body size
    node.size];
}

/**
 * Generates a list of extension fields any non-multipart part should have
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} A list of extension fields
 */
function getExtensionFields(node, options) {
    options = options || {};

    var languageString = node.parsedHeader["content-language"] && node.parsedHeader["content-language"].replace(/[ ,]+/g, ",").replace(/^,+|,+$/g, ""),
        language = languageString && languageString.split(",") || null,
        data;

    // if `contentLanguageString` is true, then use a string instead of single element array
    if (language && language.length === 1 && options.contentLanguageString) {
        language = language[0];
    }

    data = [
    // body MD5
    node.parsedHeader["content-md5"] || null,
    // body disposition
    node.parsedHeader["content-disposition"] && [options.upperCaseKeys ? node.parsedHeader["content-disposition"].value.toUpperCase() : node.parsedHeader["content-disposition"].value, node.parsedHeader["content-disposition"].params && node.parsedHeader["content-disposition"].hasParams && flatten(Object.keys(node.parsedHeader["content-disposition"].params).map(function (key) {
        return [options.upperCaseKeys ? key.toUpperCase() : key, node.parsedHeader["content-disposition"].params[key]];
    })) || null] || null,
    // body language
    language];

    // if `skipContentLocation` is true, do not include Content-Location in output
    //
    // NB! RFC3501 has an errata with content-location type, it is described as
    // "A string list" (eg. an array) in RFC but the errata page states
    // that it is a string (http://www.rfc-editor.org/errata_search.php?rfc=3501)
    // see note for "Section 7.4.2, page 75"
    if (!options.skipContentLocation) {
        // body location
        data.push(node.parsedHeader["content-location"] || null);
    }

    return data;
}

/**
 * Processes a node with content-type=multipart/*
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} BODYSTRUCTURE for a multipart part
 */
function processMultipartNode(node, options) {
    options = options || {};

    var data = (node.childNodes && node.childNodes.map(function (tree) {
        return createBodystructure(tree, options);
    }) || [[]]).concat([
    // body subtype
    options.upperCaseKeys ? node.multipart && node.multipart.toUpperCase() || null : node.multipart,
    // body parameter parenthesized list
    node.parsedHeader["content-type"] && node.parsedHeader["content-type"].hasParams && flatten(Object.keys(node.parsedHeader["content-type"].params).map(function (key) {
        return [options.upperCaseKeys ? key.toUpperCase() : key, node.parsedHeader["content-type"].params[key]];
    })) || null]);

    if (options.body) {
        return data;
    } else {
        return data.
        // skip body MD5 from extension fields
        concat(getExtensionFields(node, options).slice(1));
    }
}

/**
 * Processes a node with content-type=text/*
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} BODYSTRUCTURE for a text part
 */
function processTextNode(node, options) {
    options = options || {};

    var data = [].concat(getBasicFields(node, options)).concat([node.lineCount]);

    if (!options.body) {
        data = data.concat(getExtensionFields(node, options));
    }

    data.node = node;
    return data;
}

/**
 * Processes a non-text, non-multipart node
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} BODYSTRUCTURE for the part
 */
function processAttachmentNode(node, options) {
    options = options || {};

    var data = [].concat(getBasicFields(node, options));

    if (!options.body) {
        data = data.concat(getExtensionFields(node, options));
    }

    data.node = node;
    return data;
}

/**
 * Processes a node with content-type=message/rfc822
 *
 * @param {Object} node A tree node of the parsed mime tree
 * @param {Object} [options] Optional options object (see createBodystructure for details)
 * @return {Array} BODYSTRUCTURE for a text part
 */
function processRFC822Node(node, options) {
    options = options || {};
    var message = mimeParser(node.body || ""),
        data = [].concat(getBasicFields(node, options));

    data.push(envelope(message.parsedHeader));
    data.push(createBodystructure(message, options));
    data = data.concat(node.lineCount).concat(getExtensionFields(node, options));

    node.text = message.text;

    data.node = node;
    return data;
}

/**
 * Converts all sub-arrays into one level array
 * flatten([1,[2,3]]) -> [1,2,3]
 *
 * @param {Array} arr An array with possible sub-arrays
 * @return {Array} Flat array
 */
function flatten(arr) {
    var result = [];
    if (Array.isArray(arr)) {
        arr.forEach(function (elm) {
            if (Array.isArray(elm)) {
                result = result.concat(flatten(elm));
            } else {
                result.push(elm);
            }
        });
    } else {
        result.push(arr);
    }
    return result;
}