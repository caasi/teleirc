var url = require('url');
var qs = require('qs');
var config = require('../config');
var logger = require('winston');
var M = require('../message');

exports.lookupChannel = function(chanName, channels) {
    return channels.filter(function(channel) {
        return channel.ircChan.toLowerCase() === chanName.toLowerCase();
    })[0];
};

// generates channel list for ircOptions
exports.getChannels = function(arr) {
    var result = [];

    for (var i = 0; i < arr.length; i++) {
        var chanName = arr[i].chanPwd ?
                       arr[i].ircChan + ' ' + arr[i].chanPwd :
                       arr[i].ircChan;
        result.push(chanName);
    }

    return result;
};

exports.parseMsg = function(chanName, text) {
    var channel = exports.lookupChannel(chanName, config.channels);
    var r;

    if (!channel) {
        logger.error('channel ' + chanName + ' not found in config!');
        return;
    }

    text = text.trim();
    // get reply id
    r = text.match(M.ID_FORMAT);

    return {
        channel: channel,
        text: text,
        replyTo: (r && r[1]) || undefined
    };
};

exports.topicFormat = function(channel, topic, user) {
    if (!topic) {
        return 'No topic for channel ' +
            (channel.chanAlias || channel.ircChan);
    }

    return 'Topic for channel ' + (channel.chanAlias || channel.ircChan) +
           ':\n | ' + topic.split(' | ').join('\n | ') +
           '\n * set by ' + user.split('!')[0];

};

exports.parseTopic = function(chanName, topic, user) {
    var channel = exports.lookupChannel(chanName, config.channels);
    if (!channel) {
        return;
    }

    // ignore first topic event when joining channel
    // (doesn't handle rejoins yet)
    if (!channel.firstTopicRcvd) {
        channel.firstTopicRcvd = true;
        return;
    }

    return {
        channel: channel,
        text: exports.topicFormat(channel, topic, user)
    };
};

function buildUrl(protocol, auth, host, pathname, query, hash) {
  var r = protocol + '//';
  if (auth) r += auth + '@';
  r += host + pathname;
  if (query) r += '?' + query;
  if (hash) r += hash;
  return r;
}

// parse and simplify URLs
exports.parseUrl = function(str) {
  var match, user, id, query, stripped, k;
  var myUrl = url.parse(str);

  // remove utm terms
  query = qs.parse(myUrl.query);
  stripped = {};
  for (k in query) {
      if (k.match(/^utm_/)) continue;
      stripped[k] = query[k];
  }
  query = stripped;

  if (myUrl.hostname.indexOf('facebook') !== -1) {
      host = myUrl.host.replace('www.facebook', 'fb');

      // pattern: /<fb-id>/photos/<set>/<photo-id>
      match = /\/([^\/]*)\/photos\/[^\/]*\/([^\/]*)/.exec(myUrl.pathname);
      if (match) {
          user = match[1] || '';
          id = match[2] || '';
          return {
              type: 'fb-photo',
              url: buildUrl(myUrl.protocol, '', host, '/' + user + '/photos/' + id)
          };
      }

      // pattern: story.php?story_fbid=<story_fbid>&id=<id>
      if (myUrl.pathname.match(/story\.php/)) {
          stripped = {
              story_fbid: query.story_fbid,
              id: query.id
          };
          return {
              type: 'fb-story',
              url: buildUrl(myUrl.protocol, '', host, '/story.php', qs.stringify(stripped))
          };
      }

      // pattern: photo.php?fbid=<fbid>&set=<set>
      if (myUrl.pathname.match(/photo\.php/)) {
          stripped = {
              fbid: query.fbid,
              set: query.set
          };
          return {
              type: 'fb-photo-set',
              url: buildUrl(myUrl.protocol, '', host, '/photo.php', qs.stringify(stripped))
          };
      }
  }

  return {
      type: 'url',
      url: buildUrl(myUrl.protocol, myUrl.auth, myUrl.host, myUrl.pathname, qs.stringify(query), myUrl.hash)
  };
}

// returns list of names from given channel
exports.getNames = function(nodeIrcChannel) {
    if (!nodeIrcChannel) {
        return;
    }

    // nodeIrcChannel.users is a node-irc internal object containing
    // {nickname: prefix} key-value pairs
    var names = Object.keys(nodeIrcChannel.users);

    names.forEach(function(name, i) {
        var prefix = nodeIrcChannel.users[name];

        if (prefix) {
            names[i] = '(' + prefix + ')' + names[i];
        }
    });

    return names;
};

// returns topic for given channel
exports.getTopic = function(nodeIrcChannel) {
    if (!nodeIrcChannel || !nodeIrcChannel.topic) {
        return;
    }

    return {
        text: nodeIrcChannel.topic,
        topicBy: nodeIrcChannel.topicBy
    };
};
