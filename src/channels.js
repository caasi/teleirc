exports.findByGroup = function(channels, name) {
  return channels.filter(function(channel) {
    return channel.tgGroup === name;
  })[0];
}

exports.findByChannel = function(channels, name) {
  return channels.filter(function(channel) {
    return channel.ircChan === name;
  })[0];
}
