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

    it('cuts a snippet between characters, not inside an emoji', function() {
        assert.strictEqual(M.snippet('hi 😀😀😀😀😀😀😀😀', 10, '…'), 'hi 😀😀😀😀😀😀😀…');
        assert.strictEqual(M.snippet('😀😀', 1, ' …'), '😀 …');
    });

    it('adds the ellipsis only when the cut removes characters', function() {
        assert.strictEqual(M.snippet('hi        ', 10, '…'), 'hi');
        assert.strictEqual(M.snippet('hi', 10, '…'), 'hi');
        assert.strictEqual(M.snippet('hello world', 10, '…'), 'hello worl…');
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

    it('gives the nick prefix as a field, the same as the start of the text', function() {
        var msg = {chat: {id: 1, type: 'group', title: 'TestGroup'},
            from: {id: 2, first_name: 'Ann', last_name: 'Lee'},
            date: Math.floor(Date.now() / 1000), text: 'one\ntwo'};
        var got;
        tgUtil.parseMsg(msg, {}, null, function(message) {
            got = message;
        });
        assert.strictEqual(tgUtil.stripIrcCodes(got.prefix), '<Ann Lee> ');
        assert.strictEqual(got.text.indexOf(got.prefix), 0);
    });

    it('gives as content only what the sender wrote', function() {
        var contentOf = function(fields) {
            var msg = {chat: {id: 1, type: 'group', title: 'TestGroup'},
                from: {id: 2, username: 'alice'}, date: Math.floor(Date.now() / 1000)};
            Object.assign(msg, fields);
            var got;
            tgUtil.parseMsg(msg, {username: 'bot'}, null, function(message) {
                got = message;
            });
            return got.content;
        };
        assert.strictEqual(contentOf({text: 'one\ntwo'}), 'one\ntwo');
        assert.strictEqual(contentOf({text: '/me waves\nagain'}), 'waves\nagain');
        assert.strictEqual(contentOf({text: 'one', edit_date: Math.floor(Date.now() / 1000)}),
            'one');
        assert.strictEqual(contentOf({text: 'one', reply_to_message: {text: 'secret',
            from: {id: 3, username: 'carol'}}}), 'one');
        assert.strictEqual(contentOf({text: 'one', forward_from: {id: 4, username: 'dave'}}),
            'one');
        assert.strictEqual(contentOf({document: {file_id: 'd'}, caption: 'look'}), 'look');
        // A hidden link keeps its URL, in the same form as on IRC.
        // Two links: the second must move by the length of what the first added.
        var two = [{type: 'text_link', offset: 0, length: 1, url: 'https://a.example/'},
            {type: 'text_link', offset: 2, length: 1, url: 'https://b.example/'},
            {type: 'code', offset: 4, length: 1}];
        assert.strictEqual(contentOf({text: 'a b c', entities: two}),
            '[a](https://a.example/) [b](https://b.example/) `c`');
        var link = {type: 'text_link', offset: 4, length: 4, url: 'https://x.example/p'};
        assert.strictEqual(contentOf({text: 'see here', entities: [link]}),
            'see [here](https://x.example/p)');
    });

    it('gives no prefix where the text does not start with the nick', function() {
        var prefixOf = function(fields) {
            var msg = {chat: {id: 1, type: 'group', title: 'TestGroup'},
                from: {id: 2, username: 'alice'}, date: Math.floor(Date.now() / 1000)};
            Object.assign(msg, fields);
            var got;
            tgUtil.parseMsg(msg, {}, null, function(message) {
                got = message;
            });
            return got.prefix;
        };
        assert.strictEqual(prefixOf({text: '/me waves'}), '');
        assert.strictEqual(prefixOf({text: '/say #chan <alice> one\ntwo'}), '');
        assert.strictEqual(prefixOf({new_chat_participant: {id: 3, username: 'bob'}}), '');
    });
});

describe('tg/util parseReaction (#10)', function() {
    var M = require('../src/message');
    var saved;

    before(function() {
        saved = {channels: config.channels, soloUse: config.soloUse};
        config.channels = [{ircChan: '#chan', tgGroup: 'TestGroup', tgChatId: 1}];
        config.soloUse = false;
        M.push({id: 'beef', original: {message_id: 900}});
    });

    after(function() {
        config.channels = saved.channels;
        config.soloUse = saved.soloUse;
    });

    function emoji(e) {
        return {type: 'emoji', emoji: e};
    }

    function relay(fields) {
        var reaction = {
            chat: {id: 1, type: 'supergroup', title: 'TestGroup'},
            message_id: 900,
            user: {id: 2, username: 'alice'},
            date: Math.floor(Date.now() / 1000),
            old_reaction: [],
            new_reaction: [emoji('👍')]
        };
        Object.keys(fields || {}).forEach(function(key) {
            reaction[key] = fields[key];
        });
        var result = 'no callback';
        tgUtil.parseReaction(reaction, function(message) {
            result = message && tgUtil.stripIrcCodes(message.text);
        });
        return result;
    }

    it('relays an added emoji with the id of the message', function() {
        assert.strictEqual(relay(), '<alice> reacted 👍 to $beef');
    });

    it('relays only the emoji that the update adds', function() {
        var update = {old_reaction: [emoji('👍')], new_reaction: [emoji('👍'), emoji('🔥')]};
        assert.strictEqual(relay(update), '<alice> reacted 🔥 to $beef');
    });

    it('drops a removed reaction, a custom emoji and a paid reaction', function() {
        assert.strictEqual(relay({old_reaction: [emoji('👍')], new_reaction: []}), undefined);
        assert.strictEqual(relay({new_reaction: [{type: 'custom_emoji', custom_emoji_id: '1'}]}),
                           undefined);
        assert.strictEqual(relay({new_reaction: [{type: 'paid'}]}), undefined);
    });

    it('drops a reaction to a message without an id, or in another group', function() {
        assert.strictEqual(relay({message_id: 901}), undefined);
        assert.strictEqual(relay({chat: {id: 3, type: 'supergroup', title: 'Other'}}), undefined);
    });

    it('prefers the message from IRC of this chat to a $id of any group', function() {
        // messages.json has no chat id: 'abba' is message 960 of some group.
        M.push({id: 'abba', original: {message_id: 960}});
        M.pushSent(1, 960, 'erin', 'hi there');
        assert.strictEqual(relay({message_id: 960}), '<alice> reacted 👍 to erin: hi there');
    });

    it('names the nick and the first words of a message from IRC', function() {
        M.pushSent(1, 950, 'erin', 'hi there');
        assert.strictEqual(relay({message_id: 950}), '<alice> reacted 👍 to erin: hi there');
        assert.strictEqual(relay({message_id: 950, chat: {id: 3, title: 'TestGroup'}}), undefined);
    });

    it('forgets the oldest message from IRC after 1000', function() {
        M.pushSent(2, 1, 'old', 'x');
        for (var i = 2; i <= 1000; i++) {
            M.pushSent(2, i, 'n', 'x');
        }
        assert.ok(M.sentOf(2, 1));
        M.pushSent(2, 1001, 'n', 'x');
        assert.strictEqual(M.sentOf(2, 1), undefined);
    });

    it('names the chat for an anonymous reaction', function() {
        assert.strictEqual(relay({user: undefined, actor_chat: {id: 1, title: 'TestGroup'}}),
                           '<TestGroup> reacted 👍 to $beef');
    });

    it('does not give the id of a reaction to the next reaction', function() {
        // Object.keys lists an id of digits first, so only such an id shows it.
        M.push({id: '1234', type: 'reaction', original: {message_id: 900}});
        assert.strictEqual(M.idOf(900), 'beef');
        assert.strictEqual(M.get('1234'), undefined);
    });
});

describe('tg/util pasteLongText', function() {
    var fs = require('fs');
    var path = require('path');
    var home = require('./helpers/sandbox');
    var opts = {showMedia: true, pasteMaxLines: 3, pasteMaxBytes: 16384,
        mediaRandomLength: 8, httpLocation: 'https://files.example', replaceNewlines: '\n'};

    // The IRC line of a paste, or null.
    // A message as parseMsg gives it: the text for IRC starts with the nick,
    // and the content is the rest.
    function message(text) {
        var nick = text.match(/^<[^>]+> /);
        var prefix = nick ? nick[0] : '';
        return {text: text, prefix: prefix, content: text.slice(prefix.length)};
    }

    function paste(text, options) {
        var result = tgUtil.pasteLongText(message(text), options);
        return result && result.line;
    }

    function readPaste(line) {
        var name = line.split('https://files.example/')[1];
        return fs.readFileSync(path.join(home, '.teleirc', 'files', name), 'utf8');
    }

    it('keeps a text of at most pasteMaxLines non-empty lines', function() {
        assert.strictEqual(paste('<a> 1\n\n2\n3', opts), null);
        assert.strictEqual(paste('<a> 1\n2\n3\n4',
            Object.assign({}, opts, {showMedia: false})), null);
    });

    it('links a longer text, saved with a BOM', function() {
        var line = paste('<a> 1\n2\n3\n4', opts);
        assert.match(line, /^<a> 1 … \(4 lines\) https:\/\/files\.example\/paste_\w{8}\.txt$/);
        // The nick stays on the IRC line, not in the file.
        assert.strictEqual(readPaste(line), '\uFEFF1\n2\n3\n4');
    });

    it('counts a long line as the IRC lines that it becomes', function() {
        // '<a> ' and 600 時 are 1804 bytes: 6 IRC lines of at most 350 bytes.
        var line = paste('<a> ' + '時'.repeat(600), opts);
        assert.match(line, /… \(6 lines\) https:/);
        assert.ok(Buffer.byteLength(line) < 400, Buffer.byteLength(line));
    });

    it('counts the blocks of the joined text when lines are joined', function() {
        // Joined with ' … ', three lines of 300 bytes are 900+ bytes: 3 blocks.
        var line300 = 'a'.repeat(300);
        var text = [line300, line300, line300].join('\n');
        assert.strictEqual(paste(text, opts), null);
        var joined = Object.assign({}, opts, {replaceNewlines: ' … ', pasteMaxLines: 2});
        assert.match(paste(text, joined), /\(3 lines\)/);
        assert.strictEqual(paste('1\n2\n3\n4', joined), null);
    });

    it('counts the nick that send() adds to each line', function() {
        // Each line is 349 bytes; with '<alice> ' on every line, IRC gets
        // 3 lines of 357 bytes: 6 blocks, not 3.
        var a349 = 'a'.repeat(349);
        var line = paste('<alice> ' + [a349, a349, a349].join('\n'), opts);
        assert.match(line, /\(6 lines\)/);
    });

    it('does not count the nick prefix as a line', function() {
        assert.strictEqual(paste('<a> \n1\n2\n3', opts), null);
        var line = paste('<a> \n1\n2\n3\n4', opts);
        assert.match(line, /^<a> 1 … \(4 lines\) /);
    });

    it('returns null when the file cannot be written', function() {
        var write = fs.writeFileSync;
        fs.writeFileSync = function() {
            throw new Error('ENOSPC');
        };
        try {
            assert.strictEqual(paste('<a> 1\n2\n3\n4', opts), null);
        } finally {
            fs.writeFileSync = write;
        }
    });

    it('cuts the file at pasteMaxBytes, between characters', function() {
        // The BOM (3 bytes) leaves 23 bytes of the 26 for the text. 時 is
        // 3 bytes, so the cut at 23 falls inside one: 7 are kept.
        var line = paste('時時時時時時時時\n2\n3\n4',
            Object.assign({}, opts, {pasteMaxBytes: 26}));
        assert.strictEqual(readPaste(line), '\uFEFF時時時時時時時');
        assert.ok(Buffer.byteLength(readPaste(line)) <= 26);
        var options = Object.assign({}, opts, {pasteMaxBytes: 26});
        assert.strictEqual(tgUtil.pasteLongText(message('時時時時時時時時\n2\n3\n4'), options)
            .truncated, true);
        assert.strictEqual(tgUtil.pasteLongText(message('<a> 1\n2\n3\n4'), options).truncated,
            false);
    });
});

describe('tg/util initHttpServer', function() {
    it('does not serve the message map at /messages', function(done) {
        var saved = {port: config.httpPort, host: config.httpHost, ext: config.externalWebServer};
        config.httpPort = 0;
        config.httpHost = '127.0.0.1';
        config.externalWebServer = false;
        var server;
        try {
            server = tgUtil.initHttpServer();
        } finally {
            // Also when initHttpServer throws: later specs share this config.
            config.httpPort = saved.port;
            config.httpHost = saved.host;
            config.externalWebServer = saved.ext;
        }
        var get = function(urlPath, callback) {
            require('http').get({host: '127.0.0.1', port: server.address().port,
                path: urlPath}, function(res) {
                res.resume();
                callback(res.statusCode);
            });
        };
        server.on('listening', function() {
            var line = tgUtil.pasteLongText({text: '<a> 1\n2\n3\n4', prefix: '<a> ',
                content: '1\n2\n3\n4'},
                {showMedia: true, pasteMaxLines: 3, pasteMaxBytes: 99, httpLocation: '',
                    replaceNewlines: '\n'});
            get('/messages', function(status) {
                assert.strictEqual(status, 404);
                // A file in the folder is still served.
                get(line.line.split(' ').pop(), function(fileStatus) {
                    server.close();
                    assert.strictEqual(fileStatus, 200);
                    done();
                });
            });
        });
    });
});

describe('message splitBytes', function() {
    var M = require('../src/message');

    it('cuts between characters and keeps every character', function() {
        var text = fc.string({unit: 'grapheme', maxLength: 200});
        fc.assert(fc.property(text, fc.integer({min: 4, max: 50}),
            function(text, max) {
                var blocks = M.splitBytes(text, max);
                assert.strictEqual(blocks.join(''), text);
                blocks.forEach(function(block) {
                    assert.ok(Buffer.byteLength(block) <= max || Array.from(block).length === 1);
                });
            }));
    });
});
