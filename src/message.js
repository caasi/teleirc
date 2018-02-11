/**
 * message.js
 **
 * An in-memory message list with unified(TODO) format.
 * So the application can lookup past messages for later use.
 **/

var crypto = require('crypto')

// A in memory message list.
var messages = []
var messageMap = {}

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
  getId: getId,
  push: push,
  list: list,
  get: get
}
