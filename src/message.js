var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var logger = require('winston')
var osHomedir = require('os-homedir')
var argv = require('./arguments').argv
var messagesPath = path.dirname(argv.m || path.join(osHomedir(), '.teleirc', 'config.js'))
var messagesFile = path.join(messagesPath, 'messages.json')

/**
 * message.js
 **
 * An in-memory message list with unified(TODO) format.
 * So the application can lookup past messages for later use.
 **/
var ID_FORMAT = /\s\$([a-f0-9]{4})/
var NICK_FORMAT = /^<[^>]+>\s*/
var SAVE_INTERVAL = 30000

var messageMap;
try {
  messageMap = JSON.parse(fs.readFileSync(messagesFile))
  logger.info('message map loaded')
} catch (err) {
  messageMap = {}
}

function loop() {
  fs.writeFileSync(messagesFile, JSON.stringify(messageMap, null, 2))
  logger.info('message map saved')
  setTimeout(loop, SAVE_INTERVAL)
}
loop()

function getId(msg) {
  return crypto
    .createHash('md5')
    .update(JSON.stringify(msg))
    .digest('hex')
    .substr(0, 4)
}

function push(msg) {
  var tgId = msg && msg.original && msg.original.message_id

  if (msg && msg.id && tgId) {
    messageMap[msg.id] = tgId
  }
}

function list() {
  return messageMap
}

function get(id) {
  return messageMap[id]
}

module.exports = {
  ID_FORMAT: ID_FORMAT,
  NICK_FORMAT: NICK_FORMAT,
  getId: getId,
  push: push,
  list: list,
  get: get
}
