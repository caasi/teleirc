/**
 * message.js
 **
 * An in-memory message list with unified(TODO) format.
 * So the application can lookup past messages for later use.
 **/

// A in memory message list.
var messages = []
var messageMap = {}

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
  push: push,
  list: list,
  get: get
}
