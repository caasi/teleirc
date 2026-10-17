var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var logger = require('winston');
var osHomedir = require('os-homedir');
var argv = require('./arguments').argv;
var messagesPath = path.dirname(argv.m || path.join(osHomedir(), '.teleirc', 'config.js'));
var messagesFile = path.join(messagesPath, 'messages.json');

/**
 * message.js
 **
 * An in-memory message list with unified(TODO) format.
 * So the application can lookup past messages for later use.
 **/
var ID_FORMAT = /\s\$([a-f0-9]{4})/;
// Same nick grammar as getIRCName in tg/util.js: no '>' and no white space.
var NICK_FORMAT = /^<[^>\s]+>\s*/;
var SAVE_INTERVAL = 30000;

var messageMap;
try {
    messageMap = JSON.parse(fs.readFileSync(messagesFile));
    logger.info('message map loaded');
} catch (err) {
    messageMap = {};
}

function loop() {
    fs.writeFileSync(messagesFile, JSON.stringify(messageMap, null, 2));
    logger.info('message map saved');
    setTimeout(loop, SAVE_INTERVAL);
}
loop();

function getId(msg) {
    return crypto
      .createHash('md5')
      .update(JSON.stringify(msg))
      .digest('hex')
      .substr(0, 4);
}

function push(msg) {
    var tgId = msg && msg.original && msg.original.message_id;

    // A reaction gives the id of the message that it reacts to. IRC never
    // sees the id of the reaction, so idOf must not find it.
    if (msg && msg.id && tgId && msg.type !== 'reaction') {
        messageMap[msg.id] = tgId;
    }
}

// ponytail: a linear scan, and the map has no chat id, so a message id of
// one group can match a message of another group. On 2026-10-17 the map had
// 28409 ids and no message id twice. Store the chat id when a wrong id shows.
function idOf(tgId) {
    return Object.keys(messageMap).filter(function(id) {
        return messageMap[id] === tgId;
    })[0];
}

function list() {
    return messageMap;
}

function get(id) {
    return messageMap[id];
}

module.exports = {
    ID_FORMAT: ID_FORMAT,
    NICK_FORMAT: NICK_FORMAT,
    getId: getId,
    push: push,
    idOf: idOf,
    list: list,
    get: get
};
