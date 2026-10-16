'use strict';

var assert = require('assert');
var fc = require('fast-check');

require('./helpers/sandbox');

var config = require('../src/config');
var tgUtil = require('../src/tg/util');

// The bot posts IRC messages to Telegram as "<nick> text". getIRCName reads
// a message of the bot back (for a reply or a forward): it returns the nick
// and leaves the text in msg.text.
function parse(text) {
    var msg = {text: text};
    var name = tgUtil.getIRCName(msg, config);
    return {name: name, text: msg.text};
}

// RFC 2812: a nick has no space and no '>'.
var nick = fc.stringMatching(/^[A-Za-z_\[\]\\`^{|}][A-Za-z0-9_\[\]\\`^{|}-]{0,15}$/);
// Text can hold anything, also '>', '<' and newlines.
var text = fc.string({
    unit: fc.constantFrom('a', 'b', ' ', '>', '<', '-', '\n', '中'),
    maxLength: 30
});

describe('tg/util getIRCName', function() {
    it('reads the nick when the text has "> " (issue #4)', function() {
        assert.deepStrictEqual(parse('<_13h> (a -> b) -> a -> b'),
                               {name: '_13h', text: '(a -> b) -> a -> b'});
    });

    it('keeps every line of a message with more than one line', function() {
        assert.deepStrictEqual(parse('<bob> line one\nline two'),
                               {name: 'bob', text: 'line one\nline two'});
    });

    it('uses the Telegram name when the text has no "<nick> " prefix', function() {
        // An action ("* nick ...") and other bot texts have no IRC nick.
        // Then getIRCName returns the Telegram name and keeps the text.
        var from = {first_name: 'bot', username: 'testbot'};
        ['* dave waves', '<> x', '<a b> x', '<a\nb> x', 'no prefix'].forEach(function(input) {
            var msg = {text: input, from: from};
            assert.strictEqual(tgUtil.getIRCName(msg, config), tgUtil.getName(from, config), input);
            assert.strictEqual(msg.text, input, input);
        });
    });

    it('returns the nick and the text that the bot wrote', function() {
        fc.assert(fc.property(nick, text, function(n, t) {
            assert.deepStrictEqual(parse('<' + n + '> ' + t), {name: n, text: t});
        }), {numRuns: 2000});
    });
});

describe('message NICK_FORMAT', function() {
    var M = require('../src/message');

    it('removes the nick prefix of a bot message', function() {
        assert.strictEqual('<_13h> a > b'.replace(M.NICK_FORMAT, ''), 'a > b');
    });

    it('keeps a prefix that is not a nick', function() {
        assert.strictEqual('<a b> c'.replace(M.NICK_FORMAT, ''), '<a b> c');
    });
});

describe('tg/util parseMsg media caption (#8)', function() {
    var saved;

    before(function() {
        saved = {
            channels: config.channels,
            showMedia: config.showMedia,
            serveFile: tgUtil.serveFile
        };
        config.channels = [{ircChan: '#chan', tgGroup: 'TestGroup', tgChatId: 1}];
        config.showMedia = true;
        tgUtil.serveFile = function(fileId, mimetype, config, tg, callback) {
            callback('http://files/' + fileId);
        };
    });

    after(function() {
        config.channels = saved.channels;
        config.showMedia = saved.showMedia;
        tgUtil.serveFile = saved.serveFile;
    });

    function relay(media) {
        var msg = {
            chat: {id: 1, type: 'group', title: 'TestGroup'},
            from: {id: 2, username: 'alice'},
            date: Math.floor(Date.now() / 1000),
            caption: 'look'
        };
        Object.keys(media).forEach(function(key) {
            msg[key] = media[key];
        });
        var text;
        tgUtil.parseMsg(msg, {}, null, function(message) {
            text = tgUtil.stripIrcCodes(message.text);
        });
        return text;
    }

    it('adds the caption to audio, document and voice', function() {
        assert.strictEqual(relay({audio: {file_id: 'a', duration: 3}}),
                           '<alice> (Audio, 3s) http://files/a look');
        assert.strictEqual(relay({document: {file_id: 'd'}}),
                           '<alice> (Document) http://files/d look');
        assert.strictEqual(relay({voice: {file_id: 'v', duration: 5}}),
                           '<alice> (Voice, 5s) http://files/v look');
    });
});
