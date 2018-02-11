/**
 * message.js
 **
 * An in-memory message list with unified(TODO) format.
 * So the application can lookup past messages for later use.
 **/

var crypto = require('crypto')

var messages = []
var messageMap = {}

var ID_FORMAT = /\s#([a-f0-9]{4})/;

function getId(msg) {
  return crypto
    .createHash('md5')
    .update(JSON.stringify(msg))
    .digest('hex')
    .substr(0, 4)
}

function push(msg) {
  messages.push(msg)

  if (msg.id) {
    messageMap[msg.id] = msg
  }
}

function list() {
  return messages
}

function get(id) {
  return messageMap[id]
}

module.exports = {
  ID_FORMAT: ID_FORMAT,
  getId: getId,
  push: push,
  list: list,
  get: get
}
