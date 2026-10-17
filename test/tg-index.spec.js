'use strict';

var assert = require('assert');

require('./helpers/sandbox');

var config = require('../src/config');
var M = require('../src/message');

// A fake tgfancy. It models two rules of the Bot API, and no other rule. In
// html mode it rejects any '<' that does not start <b> or </b>; it does not
// check entities or other tags.
// rejectNext makes it reject one text in any mode. Only message 42 exists:
// a reply to another message is rejected, unless allow_sending_without_reply.
var sent = [];
var rejectNext = false;
var fakes = [];
var EventEmitter = require('events');
function FakeTelegram(token, options) {
    EventEmitter.call(this);
    this.options = options;
    fakes.push(this);
}
FakeTelegram.prototype = Object.create(EventEmitter.prototype);
FakeTelegram.prototype.processUpdate = function(update) {
    if (update.message) {
        this.emit('message', update.message);
    }
};
// getMe never resolves, so tg/index.js adds no listener, unless a test sets
// botUser. Then it resolves, and the listeners of the bridge are added.
var botUser = null;
FakeTelegram.prototype.getMe = function() {
    return botUser ? Promise.resolve(botUser) : new Promise(function() {});
};
FakeTelegram.prototype.sendMessage = function(chatId, text, options) {
    sent.push({text: text, options: options || {}});
    var html = options && options.parse_mode === 'html';
    var reply = options && options.reply_to_message_id;
    if (reply && reply !== 42 && !options.allow_sending_without_reply) {
        return Promise.reject(new Error('Bad Request: message to be replied not found'));
    }
    if (rejectNext || (html && /</.test(text.replace(/<\/?b>/g, '')))) {
        rejectNext = false;
        return Promise.reject(new Error('Bad Request: can not parse entities'));
    }
    return Promise.resolve({message_id: 100 + sent.length});
};
// src/tg/index.js must load after this line, so that it gets the fake. No
// spec that runs before this file loads src/tg/index.js or src/index.js.
require.cache[require.resolve('tgfancy')] = {
    id: require.resolve('tgfancy'),
    filename: require.resolve('tgfancy'),
    loaded: true,
    exports: FakeTelegram
};

var tgInit = require('../src/tg/index');

describe('tg/index send a reply (#9)', function() {
    var tg;
    var saved;
    var channel = {ircChan: '#chan', tgGroup: 'TestGroup', tgChatId: 1};

    before(function() {
        saved = {parseMode: config.parseMode, emNick: config.emNick, showMedia: config.showMedia};
        config.showMedia = false;
        tg = tgInit(function() {});
        M.push({id: 'abcd', original: {message_id: 42}});
        M.push({id: 'dead', original: {message_id: 7}});
    });

    beforeEach(function() {
        sent = [];
    });

    after(function() {
        config.parseMode = saved.parseMode;
        config.emNick = saved.emNick;
        config.showMedia = saved.showMedia;
        // A require inside a test or hook of a later spec gets the real
        // tgfancy. A top-level require in a later spec file still gets the
        // fake, because mocha loads every file before it runs any hook.
        delete require.cache[require.resolve('../src/tg/index')];
        delete require.cache[require.resolve('tgfancy')];
    });

    // send() returns the promise of the last sendMessage, the fallback too.
    function send(text) {
        return tg.send({channel: channel, user: 'Alvin', text: text, replyTo: 'abcd'});
    }

    it('escapes the IRC text in html mode', function() {
        config.parseMode = 'html';
        config.emNick = true;
        return send('13:39 < Alvin_Liang> test3 $abcd').then(function() {
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].text,
                               '&lt;<b>Alvin</b>&gt; 13:39 &lt; Alvin_Liang&gt; test3');
            assert.strictEqual(sent[0].options.reply_to_message_id, 42);
        });
    });

    it('escapes the nick in html mode without emNick', function() {
        config.parseMode = 'html';
        config.emNick = false;
        return send('a < b $abcd').then(function() {
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].text, '&lt;Alvin&gt; a &lt; b');
        });
    });

    it('escapes an action in html mode, with and without emNick', function() {
        var action = {
            channel: channel,
            type: 'action',
            user: null,
            original: {user: 'erin'},
            text: 'a < b & c'
        };
        config.parseMode = 'html';
        config.emNick = true;
        tg.send(action);
        config.emNick = false;
        tg.send(action);
        assert.deepStrictEqual(sent.map(function(s) { return s.text; }),
                               ['* <b>erin</b> a &lt; b &amp; c', '* erin a &lt; b &amp; c']);
        assert.strictEqual(action.text, 'a < b & c');
    });

    it('escapes a text with no user, such as a topic, in html mode', function() {
        config.parseMode = 'html';
        tg.send({channel: channel, text: 'Topic: a <b> c'});
        assert.deepStrictEqual(sent.map(function(s) { return s.text; }),
                               ['Topic: a &lt;b&gt; c']);
    });

    it('sends the text when the message of the reply is gone', function() {
        config.parseMode = 'html';
        var message = {channel: channel, user: 'Alvin', text: 'hi $dead', replyTo: 'dead'};
        return tg.send(message).then(function() {
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].options.reply_to_message_id, 7);
        });
    });

    it('keeps the reply when Telegram rejects the text', function() {
        config.parseMode = 'markdown';
        config.emNick = false;
        rejectNext = true;
        return send('test3 $abcd').then(function() {
            assert.strictEqual(sent.length, 2);
            assert.strictEqual(sent[1].text, '<Alvin> test3');
            assert.strictEqual(sent[1].options.parse_mode, undefined);
            assert.strictEqual(sent[1].options.reply_to_message_id, 42);
        });
    });
});

describe('tg/index reaction update (#10)', function() {
    var tg;

    before(function() {
        tgInit(function() {});
        tg = fakes[fakes.length - 1];
    });

    it('asks Telegram for reactions and emits them', function() {
        var allowed = JSON.parse(tg.options.polling.params.allowed_updates);
        assert.deepStrictEqual(allowed, ['message', 'edited_message', 'message_reaction']);

        var got = [];
        tg.on('message_reaction', function(r) { got.push(['reaction', r]); });
        tg.on('message', function(m) { got.push(['message', m]); });
        tg.processUpdate({update_id: 1, message_reaction: {message_id: 5}});
        tg.processUpdate({update_id: 2, message: {message_id: 6}});
        assert.deepStrictEqual(got, [['reaction', {message_id: 5}], ['message', {message_id: 6}]]);
    });
});

describe('tg/index remembers what it sent for IRC (#10)', function() {
    var tg;
    var channel = {ircChan: '#chan', tgGroup: 'TestGroup', tgChatId: 1};

    before(function() {
        tg = tgInit(function() {});
    });

    beforeEach(function() {
        sent = [];
    });

    it('stores the nick and the first words, without the reply id', function() {
        return tg.send({channel: channel, user: 'erin', text: 'hello world again',
                        replyTo: 'abcd'}).then(function() {
            assert.deepStrictEqual(M.sentOf(1, 101), {nick: 'erin', snippet: 'hello worl…'});
            var bold = '\x02hi\x02 $abcd';
            return tg.send({channel: channel, user: 'erin', text: bold, replyTo: 'abcd'});
        }).then(function() {
            assert.deepStrictEqual(M.sentOf(1, 102), {nick: 'erin', snippet: 'hi'});
        });
    });

    it('stores the text of the fallback, and the nick of an action', function() {
        rejectNext = true;
        return tg.send({channel: channel, type: 'action', original: {user: 'dave'}, text: 'waves'})
            .then(function() {
                assert.deepStrictEqual(M.sentOf(1, 102), {nick: 'dave', snippet: 'waves'});
            });
    });

    it('stores nothing for a message without a nick', function() {
        var other = {ircChan: '#other', tgGroup: 'Other', tgChatId: 5};
        return tg.send({channel: other, text: 'topic text'}).then(function() {
            assert.strictEqual(M.sentOf(5, 101), undefined);
        });
    });
});

describe('tg/index relays a reaction update to the bridge (#10)', function() {
    var tg;
    var relayed = [];
    var saved;

    before(function() {
        saved = {channels: config.channels, maxMsgAge: config.maxMsgAge};
        config.channels = [
            {ircChan: '#chan', tgGroup: 'TestGroup', tgChatId: 1},
            {ircChan: '#ro', tgGroup: 'ReadOnly', tgChatId: 4, tgGroupReadOnly: true}
        ];
        config.maxMsgAge = 60;
        M.push({id: 'feed', original: {message_id: 77}});
        botUser = {id: 9, username: 'bot'};
        tgInit(function(message) {
            relayed.push(message);
        });
        tg = fakes[fakes.length - 1];
        // The listeners are added in a then of getMe, so wait one turn.
        return Promise.resolve();
    });

    after(function() {
        botUser = null;
        config.channels = saved.channels;
        config.maxMsgAge = saved.maxMsgAge;
    });

    beforeEach(function() {
        relayed = [];
    });

    function update(chat, ageSeconds) {
        tg.processUpdate({update_id: 1, message_reaction: {
            chat: chat,
            message_id: 77,
            user: {id: 2, username: 'alice'},
            date: Math.floor(Date.now() / 1000) - ageSeconds,
            old_reaction: [],
            new_reaction: [{type: 'emoji', emoji: '👍'}]
        }});
    }

    it('sends a new reaction to the bridge as a tg message', function() {
        update({id: 1, type: 'supergroup', title: 'TestGroup'}, 0);
        assert.strictEqual(relayed.length, 1);
        assert.strictEqual(relayed[0].protocol, 'tg');
        assert.strictEqual(relayed[0].type, 'reaction');
        assert.strictEqual(relayed[0].original.message_id, 77);
        assert.ok(/reacted 👍 to \$feed$/.test(relayed[0].text), relayed[0].text);
    });

    it('drops a reaction in a read-only group, and an old reaction', function() {
        update({id: 4, type: 'supergroup', title: 'ReadOnly'}, 0);
        update({id: 1, type: 'supergroup', title: 'TestGroup'}, 120);
        assert.deepStrictEqual(relayed, []);
    });
});
